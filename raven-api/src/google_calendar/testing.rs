//! In-process fake Google Calendar + OAuth for tests (never contacts Google).
//!
//! Sync tokens are `tok-<seq>`; [`FakeGoogle::expire_sync_tokens`] makes every issued
//! token answer 410. Failures can be injected per operation.

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use time::OffsetDateTime;

use super::client::{
    CalendarApi, EventPage, GCalendar, GCalendarListEntry, GFuture, GoogleApiError, ListRequest,
};
use super::mapping::{EventTime, GEvent, GEventStatus, GEventWrite};
use super::oauth::{AccessGrant, AccessToken, OAuthApi, OAuthClient, SCOPES, TokenGrant};
use super::runtime::{GoogleCalendar, GoogleCalendarBuilder};
use super::secret::Secret;

#[derive(Debug, Clone)]
struct Stored {
    calendar_id: String,
    event: GEvent,
    seq: u64,
}

#[derive(Debug, Default)]
pub struct FakeState {
    pub calendars: Vec<GCalendarListEntry>,
    events: BTreeMap<(String, String), Stored>,
    seq: u64,
    min_token_seq: u64,
    failures: VecDeque<(&'static str, GoogleApiError)>,
    crashes: VecDeque<&'static str>,
    /// Every call, e.g. `insert_event`.
    pub calls: Vec<&'static str>,
    pub refresh_invalid: bool,
    pub refreshes: u32,
    pub revoked: u32,
    pub exchanged_redirect_uris: Vec<String>,
    pub page_size: usize,
}

/// Fake Google Calendar API and OAuth endpoints sharing one state.
#[derive(Debug, Clone, Default)]
pub struct FakeGoogle {
    pub state: Arc<Mutex<FakeState>>,
}

impl FakeGoogle {
    /// One writable primary calendar `primary@example.test`.
    pub fn new() -> Self {
        let fake = Self::default();
        {
            let mut state = fake.lock();
            state.page_size = 250;
            state.calendars.push(GCalendarListEntry {
                id: "primary@example.test".into(),
                summary: Some("Primary".into()),
                primary: true,
                access_role: "owner".into(),
                time_zone: Some("Asia/Seoul".into()),
            });
            state.calendars.push(GCalendarListEntry {
                id: "readonly@example.test".into(),
                summary: Some("Holidays".into()),
                primary: false,
                access_role: "reader".into(),
                time_zone: None,
            });
        }
        fake
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, FakeState> {
        self.state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    /// Builder wired to this fake (Google clients injected, kill switch off).
    pub fn builder(
        &self,
        home: impl Into<std::path::PathBuf>,
        todo_db: impl Into<std::path::PathBuf>,
    ) -> GoogleCalendarBuilder {
        GoogleCalendar::builder(home, todo_db, time::UtcOffset::from_hms(9, 0, 0).unwrap())
            .api(Arc::new(self.clone()))
            .oauth(Arc::new(self.clone()))
            .env_disabled(false)
            .oauth_client_env(None)
            .sleeper(Arc::new(|_| Box::pin(async {})))
    }

    /// Next call of `operation` fails with `error` (FIFO across operations).
    pub fn fail_next(&self, operation: &'static str, error: GoogleApiError) {
        self.lock().failures.push_back((operation, error));
    }

    /// Next call of `operation` is applied, then answers `Network` (lost response).
    pub fn crash_after_next(&self, operation: &'static str) {
        self.lock().crashes.push_back(operation);
    }

    pub fn expire_sync_tokens(&self) {
        let mut state = self.lock();
        state.min_token_seq = state.seq + 1;
    }

    /// Creates or replaces an event as a Google user would (new etag/updated).
    pub fn put_event(&self, calendar_id: &str, mut event: GEvent) {
        let mut state = self.lock();
        state.seq += 1;
        let seq = state.seq;
        event.etag = Some(format!("\"e{seq}\""));
        event.updated = Some(OffsetDateTime::now_utc());
        state.events.insert(
            (calendar_id.to_owned(), event.id.clone()),
            Stored {
                calendar_id: calendar_id.to_owned(),
                event,
                seq,
            },
        );
    }

    /// Edits an existing event as a Google user would.
    pub fn edit_event(&self, calendar_id: &str, id: &str, edit: impl FnOnce(&mut GEvent)) {
        let mut event = self.event(calendar_id, id).expect("event exists");
        edit(&mut event);
        self.put_event(calendar_id, event);
    }

    /// Deletes an event as a Google user would (it turns `cancelled`).
    pub fn delete_event_as_user(&self, calendar_id: &str, id: &str) {
        self.edit_event(calendar_id, id, |event| {
            event.status = GEventStatus::Cancelled;
        });
    }

    pub fn event(&self, calendar_id: &str, id: &str) -> Option<GEvent> {
        self.lock()
            .events
            .get(&(calendar_id.to_owned(), id.to_owned()))
            .map(|stored| stored.event.clone())
    }

    /// Non-cancelled events of a calendar.
    pub fn live_events(&self, calendar_id: &str) -> Vec<GEvent> {
        self.lock()
            .events
            .values()
            .filter(|stored| {
                stored.calendar_id == calendar_id && stored.event.status != GEventStatus::Cancelled
            })
            .map(|stored| stored.event.clone())
            .collect()
    }

    /// Number of insert/patch/delete calls so far.
    pub fn writes(&self) -> usize {
        self.lock()
            .calls
            .iter()
            .filter(|call| matches!(**call, "insert_event" | "patch_event" | "delete_event"))
            .count()
    }

    fn begin(&self, operation: &'static str) -> Result<bool, GoogleApiError> {
        let mut state = self.lock();
        state.calls.push(operation);
        if let Some(position) = state.failures.iter().position(|(op, _)| *op == operation) {
            let (_, error) = state.failures.remove(position).expect("position exists");
            return Err(error);
        }
        if let Some(position) = state.crashes.iter().position(|op| *op == operation) {
            state.crashes.remove(position);
            return Ok(true);
        }
        Ok(false)
    }
}

fn apply_write(event: &mut GEvent, write: &GEventWrite) {
    let text = |value: &Option<String>, slot: &mut Option<String>| {
        if let Some(value) = value {
            *slot = (!value.is_empty()).then(|| value.clone());
        }
    };
    text(&write.summary, &mut event.summary);
    text(&write.description, &mut event.description);
    text(&write.location, &mut event.location);
    if let Some(start) = &write.start {
        event.start = Some(start.clone());
    }
    if let Some(end) = &write.end {
        event.end = Some(end.clone());
    }
    if let Some(status) = write.status {
        event.status = status;
    }
    if let Some(id) = &write.raven_item_id {
        event.raven_item_id = Some(id.clone());
    }
}

fn start_day(event: &GEvent) -> Option<time::Date> {
    match event.start.as_ref()? {
        EventTime::Date(date) => Some(*date),
        EventTime::DateTime { at, .. } => Some(at.to_offset(time::UtcOffset::UTC).date()),
    }
}

impl FakeGoogle {
    fn list(
        &self,
        calendar_id: &str,
        request: &ListRequest<'_>,
    ) -> Result<EventPage, GoogleApiError> {
        let state = self.lock();
        let since = match request.sync_token {
            Some(token) => {
                let seq = token
                    .strip_prefix("tok-")
                    .and_then(|seq| seq.parse::<u64>().ok())
                    .ok_or(GoogleApiError::Gone)?;
                if seq < state.min_token_seq {
                    return Err(GoogleApiError::Gone);
                }
                Some(seq)
            }
            None => None,
        };
        let time_min = request
            .time_min
            .and_then(|text| {
                OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339).ok()
            })
            .map(|at| at.to_offset(time::UtcOffset::UTC).date());
        let mut items: Vec<&Stored> = state
            .events
            .values()
            .filter(|stored| stored.calendar_id == calendar_id)
            .filter(|stored| match since {
                Some(seq) => stored.seq > seq,
                None => {
                    stored.event.status != GEventStatus::Cancelled
                        && time_min
                            .is_none_or(|min| start_day(&stored.event).is_none_or(|day| day >= min))
                }
            })
            .collect();
        items.sort_by_key(|stored| stored.seq);
        let offset = request
            .page_token
            .and_then(|token| token.parse::<usize>().ok())
            .unwrap_or(0);
        let size = state.page_size.max(1);
        let page: Vec<GEvent> = items
            .iter()
            .skip(offset)
            .take(size)
            .map(|stored| stored.event.clone())
            .collect();
        let more = offset + size < items.len();
        Ok(EventPage {
            items: page,
            next_page_token: more.then(|| (offset + size).to_string()),
            next_sync_token: (!more).then(|| format!("tok-{}", state.seq)),
        })
    }

    fn store_write(&self, calendar_id: &str, id: &str, apply: impl FnOnce(&mut GEvent)) -> GEvent {
        let mut state = self.lock();
        state.seq += 1;
        let seq = state.seq;
        let key = (calendar_id.to_owned(), id.to_owned());
        let mut event = state
            .events
            .get(&key)
            .map(|stored| stored.event.clone())
            .unwrap_or_else(|| GEvent::new(id));
        apply(&mut event);
        event.etag = Some(format!("\"e{seq}\""));
        event.updated = Some(OffsetDateTime::now_utc());
        state.events.insert(
            key,
            Stored {
                calendar_id: calendar_id.to_owned(),
                event: event.clone(),
                seq,
            },
        );
        event
    }
}

impl CalendarApi for FakeGoogle {
    fn list_events<'a>(
        &'a self,
        _at: &'a AccessToken,
        cal: &'a str,
        req: ListRequest<'a>,
    ) -> GFuture<'a, EventPage> {
        Box::pin(async move {
            self.begin("list_events")?;
            self.list(cal, &req)
        })
    }

    fn get_event<'a>(
        &'a self,
        _at: &'a AccessToken,
        cal: &'a str,
        id: &'a str,
    ) -> GFuture<'a, Option<GEvent>> {
        Box::pin(async move {
            self.begin("get_event")?;
            Ok(self.event(cal, id))
        })
    }

    fn insert_event<'a>(
        &'a self,
        _at: &'a AccessToken,
        cal: &'a str,
        ev: &'a GEventWrite,
    ) -> GFuture<'a, GEvent> {
        Box::pin(async move {
            let crash = self.begin("insert_event")?;
            let id = match &ev.id {
                Some(id) => id.clone(),
                None => format!("g{}", self.lock().seq + 1),
            };
            if self.event(cal, &id).is_some() {
                return Err(GoogleApiError::Conflict);
            }
            let stored = self.store_write(cal, &id, |event| {
                event.status = GEventStatus::Confirmed;
                apply_write(event, ev);
            });
            if crash {
                return Err(GoogleApiError::Network);
            }
            Ok(stored)
        })
    }

    fn patch_event<'a>(
        &'a self,
        _at: &'a AccessToken,
        cal: &'a str,
        id: &'a str,
        if_match: &'a str,
        ev: &'a GEventWrite,
    ) -> GFuture<'a, GEvent> {
        Box::pin(async move {
            let crash = self.begin("patch_event")?;
            let current = self.event(cal, id).ok_or(GoogleApiError::NotFound)?;
            if if_match != "*" && current.etag.as_deref() != Some(if_match) {
                return Err(GoogleApiError::PreconditionFailed);
            }
            let stored = self.store_write(cal, id, |event| apply_write(event, ev));
            if crash {
                return Err(GoogleApiError::Network);
            }
            Ok(stored)
        })
    }

    fn delete_event<'a>(
        &'a self,
        _at: &'a AccessToken,
        cal: &'a str,
        id: &'a str,
    ) -> GFuture<'a, ()> {
        Box::pin(async move {
            let crash = self.begin("delete_event")?;
            match self.event(cal, id) {
                None => return Err(GoogleApiError::NotFound),
                Some(event) if event.status == GEventStatus::Cancelled => {
                    return Err(GoogleApiError::Gone);
                }
                Some(_) => {}
            }
            self.store_write(cal, id, |event| event.status = GEventStatus::Cancelled);
            if crash {
                return Err(GoogleApiError::Network);
            }
            Ok(())
        })
    }

    fn insert_calendar<'a>(
        &'a self,
        _at: &'a AccessToken,
        summary: &'a str,
        tz: &'a str,
    ) -> GFuture<'a, GCalendar> {
        Box::pin(async move {
            self.begin("insert_calendar")?;
            let mut state = self.lock();
            let id = format!("cal{}@group.example.test", state.calendars.len() + 1);
            state.calendars.push(GCalendarListEntry {
                id: id.clone(),
                summary: Some(summary.to_owned()),
                primary: false,
                access_role: "owner".into(),
                time_zone: Some(tz.to_owned()),
            });
            Ok(GCalendar {
                id,
                summary: Some(summary.to_owned()),
                time_zone: Some(tz.to_owned()),
            })
        })
    }

    fn list_calendars<'a>(&'a self, _at: &'a AccessToken) -> GFuture<'a, Vec<GCalendarListEntry>> {
        Box::pin(async move {
            self.begin("list_calendars")?;
            Ok(self.lock().calendars.clone())
        })
    }
}

fn access(n: u32) -> AccessGrant {
    AccessGrant {
        access_token: AccessToken::new(Secret::new(format!("fake-access-{n}"))),
        expires_in: Duration::from_secs(3600),
        scopes: SCOPES.map(str::to_owned).to_vec(),
    }
}

impl OAuthApi for FakeGoogle {
    fn exchange_code<'a>(
        &'a self,
        _c: &'a OAuthClient,
        code: &'a Secret,
        _verifier: &'a Secret,
        redirect_uri: &'a str,
    ) -> GFuture<'a, TokenGrant> {
        Box::pin(async move {
            self.begin("exchange_code")?;
            if code.expose() == "bad-code" {
                return Err(GoogleApiError::InvalidGrant);
            }
            self.lock()
                .exchanged_redirect_uris
                .push(redirect_uri.to_owned());
            Ok(TokenGrant {
                access: access(0),
                refresh_token: Secret::new("fake-refresh-token"),
            })
        })
    }

    fn refresh<'a>(
        &'a self,
        _c: &'a OAuthClient,
        _refresh: &'a Secret,
    ) -> GFuture<'a, AccessGrant> {
        Box::pin(async move {
            self.begin("refresh")?;
            let mut state = self.lock();
            if state.refresh_invalid {
                return Err(GoogleApiError::InvalidGrant);
            }
            state.refreshes += 1;
            Ok(access(state.refreshes))
        })
    }

    fn revoke<'a>(&'a self, _token: &'a Secret) -> GFuture<'a, ()> {
        Box::pin(async move {
            self.begin("revoke")?;
            self.lock().revoked += 1;
            Ok(())
        })
    }
}

/// A Desktop-app client file body for tests.
pub const TEST_CLIENT_JSON: &str = r#"{"installed":{"client_id":"test-client.apps.googleusercontent.com","client_secret":"test-client-secret"}}"#;
