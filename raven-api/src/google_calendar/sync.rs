//! One sync pass: pull Google changes, read Raven events, reconcile, execute the plan
//! (at most [`MAX_WRITES_PER_PASS`] writes) and record the outcome.
//!
//! Links are stored only after their writes succeed. The sync token advances only
//! when every inbound change was applied or parked in `pending_inbound`, so a crash or
//! an aborted pass re-reads the same changes and reconcile re-adopts anything already
//! written (deterministic ids, `external_source`), never duplicating events.

use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;

use time::{Date, OffsetDateTime};
use todo_engine::application::error::TodoError;
use todo_engine::application::ports::ListFilter;
use todo_engine::application::service::TodoService;
use todo_engine::domain::{Actor, ItemType, TodoItem};
use todo_engine::infrastructure::sqlite::{
    SqliteTodoRepository, connect, connect_read_only, user_version,
};

use super::client::{GoogleApiError, ListRequest};
use super::mapping::{GEvent, GEventStatus, GEventWrite, MapConfig, NewRavenEvent, format_date};
use super::reconcile::{
    Action, DELETED_REASON, GChange, GooglePatch, GuardTrip, Link, LinkState, RavenChange,
    SYNC_REASON, SyncConfig, SyncCounts, reconcile,
};
use super::runtime::{
    GoogleCalendar, GoogleCalendarError, LOG_TARGET, SyncOptions, SyncPreview, SyncReport, Trigger,
    format_instant, parse_instant,
};
use super::storage::{
    self, ConnectionState, GoogleCalendarSettings, LastSync, PendingInbound, SyncDb,
};

/// Google + Raven writes allowed in one pass; the rest waits for the next pass.
pub const MAX_WRITES_PER_PASS: usize = 250;
const MAX_LIST_PAGES: usize = 200;
/// A link turns `error` after this many failed writes.
const LINK_ERROR_AFTER: i64 = 3;
const PENDING_RETRY_DELAY: time::Duration = time::Duration::minutes(2);

struct Pulled {
    changes: Vec<GChange>,
    next_token: Option<String>,
    full: bool,
}

/// Result of one pass before it is recorded.
struct PassResult {
    counts: SyncCounts,
    outcome: &'static str,
    error_kind: Option<String>,
    guard: Option<GuardTrip>,
}

impl PassResult {
    fn failed(error: &GoogleCalendarError) -> Self {
        let outcome = if *error == GoogleCalendarError::ReauthRequired {
            "reauth_required"
        } else {
            "failed"
        };
        Self {
            counts: SyncCounts::default(),
            outcome,
            error_kind: Some(error_kind(error).to_owned()),
            guard: None,
        }
    }
}

fn error_kind(error: &GoogleCalendarError) -> &'static str {
    match error {
        GoogleCalendarError::Upstream(error) => error.kind(),
        other => other.kind(),
    }
}

/// Failures that stop the pass (the rest are specific to one event).
fn is_fatal(error: &GoogleCalendarError) -> bool {
    match error {
        GoogleCalendarError::Upstream(error) => matches!(
            error,
            GoogleApiError::Network
                | GoogleApiError::Server
                | GoogleApiError::RateLimited { .. }
                | GoogleApiError::Unauthorized
                | GoogleApiError::InvalidGrant
        ),
        GoogleCalendarError::Validation { .. } => false,
        _ => true,
    }
}

/// A Raven write failure.
enum RavenFail {
    /// Store unavailable: stops the pass.
    Fatal,
    /// Item changed since read: retried next pass.
    Conflict,
    /// Rejected by policy/validation, or gone.
    Rejected,
}

impl RavenFail {
    fn kind(&self) -> &'static str {
        match self {
            Self::Fatal => "todo_unavailable",
            Self::Conflict => "raven_conflict",
            Self::Rejected => "raven_rejected",
        }
    }
}

impl From<TodoError> for RavenFail {
    fn from(error: TodoError) -> Self {
        match error {
            TodoError::Conflict(_) => Self::Conflict,
            TodoError::Storage(_) | TodoError::Migration(_) | TodoError::Internal(_) => Self::Fatal,
            _ => Self::Rejected,
        }
    }
}

fn open_todo(path: &Path, write: bool) -> Result<TodoService, RavenFail> {
    if !std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file()) {
        return Err(RavenFail::Fatal);
    }
    let path = path.to_str().ok_or(RavenFail::Fatal)?;
    let conn = if write {
        let conn = connect(path).map_err(|_| RavenFail::Fatal)?;
        if user_version(&conn).map_err(|_| RavenFail::Fatal)? != 1 {
            return Err(RavenFail::Fatal);
        }
        conn
    } else {
        connect_read_only(path).map_err(|_| RavenFail::Fatal)?
    };
    Ok(TodoService::persistent(SqliteTodoRepository::new(conn)))
}

fn raven_events(path: &Path) -> Result<Vec<TodoItem>, RavenFail> {
    let mut service = open_todo(path, false)?;
    Ok(service.list_items(ListFilter {
        item_type: Some(ItemType::Event),
        include_archived: true,
        ..ListFilter::default()
    })?)
}

fn raven_create(path: &Path, event: NewRavenEvent) -> Result<TodoItem, RavenFail> {
    Ok(open_todo(path, true)?
        .propose_event_with_reason(event.into_propose_event(), Some(SYNC_REASON))?)
}

fn raven_update(path: &Path, id: &str, change: RavenChange) -> Result<TodoItem, RavenFail> {
    Ok(open_todo(path, true)?.update_item_if_current_as(
        id,
        change.update.into_update_item(SYNC_REASON),
        Some(change.expected_updated_at),
        Actor::System,
    )?)
}

/// `Ok(None)` when the item changed since it was read (no If-Match on archive).
fn raven_archive(
    path: &Path,
    id: &str,
    expected: OffsetDateTime,
) -> Result<Option<TodoItem>, RavenFail> {
    let mut service = open_todo(path, true)?;
    match service.get(id) {
        Ok(item) if item.updated_at != expected => return Ok(None),
        Ok(_) => {}
        Err(TodoError::NotFound(_)) => return Err(RavenFail::Rejected),
        Err(error) => return Err(error.into()),
    }
    Ok(Some(service.archive_as(
        id,
        Actor::System,
        Some(DELETED_REASON),
    )?))
}

fn window_time_min(window: Date, offset: time::UtcOffset) -> String {
    format_instant(window.midnight().assume_offset(offset))
}

impl GoogleCalendar {
    fn map_config(&self, settings: &GoogleCalendarSettings) -> MapConfig {
        MapConfig {
            time_zone: settings.time_zone.clone(),
            offset: self.inner.local_offset,
            default_duration_minutes: settings.default_duration_minutes,
            sync_note: settings.sync_note,
        }
    }

    /// Preconditions shared by manual syncs and previews.
    fn sync_ready(&self) -> Result<(GoogleCalendarSettings, String), GoogleCalendarError> {
        let settings = self.settings()?;
        if self.oauth_client()?.is_none() {
            return Err(GoogleCalendarError::NotConfigured);
        }
        match self.connection_state()? {
            ConnectionState::Disconnected => return Err(GoogleCalendarError::NotConnected),
            ConnectionState::ReauthRequired => return Err(GoogleCalendarError::ReauthRequired),
            ConnectionState::Connected => {}
        }
        let calendar_id = settings
            .calendar_id
            .clone()
            .ok_or(GoogleCalendarError::CalendarNotSelected)?;
        Ok((settings, calendar_id))
    }

    /// Dry run: planned counts; writes nothing (no lock, no `sync.sqlite`).
    pub async fn preview(&self) -> Result<SyncPreview, GoogleCalendarError> {
        let (settings, calendar_id) = self.sync_ready()?;
        let first_sync = storage::load_state(self.paths())?
            .first_sync_completed_at
            .is_none();
        let (plan_counts, guard) = self.plan_only(&settings, &calendar_id, false).await?;
        Ok(SyncPreview {
            counts: plan_counts,
            guard_tripped: guard.is_some(),
            first_sync,
        })
    }

    /// Manual (`api`/`cli`) or scheduled sync. A manual sync is also the "Start
    /// syncing" confirmation that completes the first sync.
    pub async fn sync(
        &self,
        trigger: Trigger,
        options: SyncOptions,
    ) -> Result<SyncReport, GoogleCalendarError> {
        let (settings, calendar_id) = self.sync_ready()?;
        if options.dry_run {
            let (counts, guard) = self
                .plan_only(&settings, &calendar_id, options.allow_mass_delete)
                .await?;
            let now = format_instant(self.now());
            return Ok(SyncReport {
                dry_run: true,
                last_sync: Some(LastSync {
                    run_id: uuid::Uuid::new_v4().to_string(),
                    trigger: trigger.as_str().to_owned(),
                    started_at: now.clone(),
                    finished_at: now,
                    outcome: if guard.is_some() {
                        "guard_tripped"
                    } else {
                        "ok"
                    }
                    .to_owned(),
                    counts,
                    error_kind: None,
                }),
            });
        }
        let Some(_lock) = storage::try_lock(self.paths())? else {
            log_skipped("locked");
            return Err(GoogleCalendarError::SyncInProgress);
        };
        self.run_locked(trigger, options, settings, calendar_id)
            .await
    }

    async fn plan_only(
        &self,
        settings: &GoogleCalendarSettings,
        calendar_id: &str,
        allow_mass_delete: bool,
    ) -> Result<(SyncCounts, Option<GuardTrip>), GoogleCalendarError> {
        let now = self.now();
        let (sync_token, links, pending) = match SyncDb::open_existing(self.paths())? {
            Some(db) => {
                let repo = db.repo();
                (
                    repo.calendar(calendar_id)?.and_then(|row| row.sync_token),
                    repo.links(calendar_id)?,
                    repo.due_pending(calendar_id, now)?,
                )
            }
            None => (None, Vec::new(), Vec::new()),
        };
        let cfg = SyncConfig {
            calendar_id: calendar_id.to_owned(),
            map: self.map_config(settings),
            push_since: settings.push_since_date(),
            allow_mass_delete,
        };
        let pulled = self
            .pull(
                calendar_id,
                sync_token,
                cfg.window_start(now),
                &links,
                &pending,
            )
            .await?;
        let raven =
            raven_events(&self.inner.todo_db).map_err(|_| GoogleCalendarError::TodoUnavailable)?;
        let plan = reconcile(&raven, &pulled.changes, &links, &cfg, now);
        Ok((plan.counts, plan.guard))
    }

    /// One recorded pass; the caller holds the sync lock.
    pub(crate) async fn run_locked(
        &self,
        trigger: Trigger,
        options: SyncOptions,
        settings: GoogleCalendarSettings,
        calendar_id: String,
    ) -> Result<SyncReport, GoogleCalendarError> {
        let state = storage::load_state(self.paths())?;
        let now = self.now();
        if state
            .last_sync
            .as_ref()
            .and_then(|last| parse_instant(&last.started_at))
            .is_some_and(|last| now < last)
        {
            log_skipped("clock_regressed");
            return Ok(SyncReport {
                dry_run: false,
                last_sync: state.last_sync,
            });
        }
        if !std::fs::symlink_metadata(&self.inner.todo_db).is_ok_and(|meta| meta.is_file()) {
            log_skipped("todo_unavailable");
            return Err(GoogleCalendarError::TodoUnavailable);
        }
        let run_id = uuid::Uuid::new_v4().to_string();
        tracing::info!(
            target: LOG_TARGET,
            event = "google_calendar_sync_started",
            run_id = %run_id,
            trigger = trigger.as_str(),
            "google calendar sync started"
        );
        let started = Instant::now();
        let cfg = SyncConfig {
            calendar_id: calendar_id.clone(),
            map: self.map_config(&settings),
            push_since: settings.push_since_date(),
            allow_mass_delete: options.allow_mass_delete,
        };
        let window = cfg.window_start(now);
        let result = match self.pass(&cfg, now).await {
            Ok(result) => result,
            Err(error) => PassResult::failed(&error),
        };
        let finished = self.now();
        let last_sync = LastSync {
            run_id: run_id.clone(),
            trigger: trigger.as_str().to_owned(),
            started_at: format_instant(now),
            finished_at: format_instant(finished.max(now)),
            outcome: result.outcome.to_owned(),
            counts: result.counts,
            error_kind: result.error_kind.clone(),
        };
        let mut state = storage::load_state(self.paths())?;
        state.last_sync = Some(last_sync.clone());
        let completes_first_sync = state.first_sync_completed_at.is_none()
            && matches!(result.outcome, "ok" | "partial" | "nothing_to_do");
        if completes_first_sync {
            state.first_sync_completed_at = Some(format_instant(finished.max(now)));
            let mut settings = self.settings()?;
            if settings.calendar_id.as_deref() == Some(calendar_id.as_str())
                && settings.push_since.is_none()
            {
                settings.push_since = Some(format_date(window));
                storage::save_settings(self.paths(), &settings)?;
            }
        }
        storage::save_state(self.paths(), &state)?;
        let counts = serde_json::to_string(&result.counts).unwrap_or_default();
        if let Some(guard) = result.guard {
            tracing::warn!(
                target: LOG_TARGET,
                event = "google_calendar_guard_tripped",
                run_id = %run_id,
                counts = %serde_json::to_string(&guard).unwrap_or_default(),
                "google calendar mass-change guard tripped"
            );
        }
        tracing::info!(
            target: LOG_TARGET,
            event = "google_calendar_sync_completed",
            run_id = %run_id,
            outcome = result.outcome,
            counts = %counts,
            error_kind = result.error_kind.as_deref().unwrap_or(""),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "google calendar sync completed"
        );
        Ok(SyncReport {
            dry_run: false,
            last_sync: Some(last_sync),
        })
    }

    async fn pass(
        &self,
        cfg: &SyncConfig,
        now: OffsetDateTime,
    ) -> Result<PassResult, GoogleCalendarError> {
        let calendar_id = cfg.calendar_id.as_str();
        let db = SyncDb::open(self.paths())?;
        let (sync_token, links, pending) = {
            let repo = db.repo();
            (
                repo.calendar(calendar_id)?.and_then(|row| row.sync_token),
                repo.links(calendar_id)?,
                repo.due_pending(calendar_id, now)?,
            )
        };
        let had_token = sync_token.is_some();
        let pulled = self
            .pull(
                calendar_id,
                sync_token,
                cfg.window_start(now),
                &links,
                &pending,
            )
            .await?;
        if had_token && pulled.full {
            db.repo().clear_sync_token(calendar_id, now)?;
        }
        let raven =
            raven_events(&self.inner.todo_db).map_err(|_| GoogleCalendarError::TodoUnavailable)?;
        let plan = reconcile(&raven, &pulled.changes, &links, cfg, now);

        let mut exec = Exec {
            rt: self,
            db,
            calendar_id: calendar_id.to_owned(),
            now,
            writes: 0,
            counts: SyncCounts {
                conflicts: plan.counts.conflicts,
                skipped_recurring: plan.counts.skipped_recurring,
                skipped_terminal: plan.counts.skipped_terminal,
                ..SyncCounts::default()
            },
            abort: None,
            budget_exhausted: false,
            failed_inbound: HashSet::new(),
        };
        for action in plan.actions {
            if exec.abort.is_some() {
                break;
            }
            exec.run(action).await;
        }

        let Exec {
            db,
            counts,
            abort,
            budget_exhausted,
            failed_inbound,
            writes,
            ..
        } = exec;
        if abort.is_none() {
            let complete =
                !budget_exhausted && plan.guard.is_none_or(|guard| guard.raven_archives == 0);
            let mut db = db;
            db.transaction(|repo| {
                if complete && let Some(token) = pulled.next_token.as_deref() {
                    repo.set_sync_token(calendar_id, Some(token), pulled.full, now)?;
                }
                for row in &pending {
                    if !failed_inbound.contains(&row.google_event_id) {
                        repo.clear_pending(calendar_id, &row.google_event_id)?;
                    }
                }
                Ok(())
            })?;
        }

        let applied = counts.google_created
            + counts.google_updated
            + counts.google_deleted
            + counts.raven_created
            + counts.raven_updated
            + counts.raven_archived;
        let outcome = if plan.guard.is_some() {
            "guard_tripped"
        } else if let Some(error) = &abort {
            if *error == GoogleCalendarError::ReauthRequired {
                "reauth_required"
            } else if applied == 0 {
                "failed"
            } else {
                "partial"
            }
        } else if counts.failed > 0 || budget_exhausted {
            "partial"
        } else if writes == 0 && applied == 0 {
            "nothing_to_do"
        } else {
            "ok"
        };
        Ok(PassResult {
            counts,
            outcome,
            error_kind: abort
                .as_ref()
                .map(|error| error_kind(error).to_owned())
                .or_else(|| budget_exhausted.then(|| "write_budget_exhausted".to_owned())),
            guard: plan.guard,
        })
    }

    /// Lists every page of one `events.list` mode.
    async fn list_all(
        &self,
        calendar_id: &str,
        sync_token: Option<&str>,
        time_min: Option<&str>,
    ) -> Result<(Vec<GEvent>, Option<String>), GoogleCalendarError> {
        let mut events = Vec::new();
        let mut page_token: Option<String> = None;
        for _ in 0..MAX_LIST_PAGES {
            let request = ListRequest {
                sync_token,
                page_token: page_token.as_deref(),
                time_min,
                ..ListRequest::default()
            };
            let page = google_call!(self, "list_events", |api, at| api.list_events(
                at,
                calendar_id,
                request
            ))?;
            events.extend(page.items);
            match page.next_page_token.filter(|token| !token.is_empty()) {
                Some(token) => page_token = Some(token),
                None => return Ok((events, page.next_sync_token)),
            }
        }
        Err(GoogleCalendarError::Upstream(
            GoogleApiError::InvalidResponse,
        ))
    }

    async fn pull(
        &self,
        calendar_id: &str,
        sync_token: Option<String>,
        window: Date,
        links: &[Link],
        pending: &[PendingInbound],
    ) -> Result<Pulled, GoogleCalendarError> {
        let mut resync = false;
        let mut listed = None;
        if let Some(token) = sync_token.as_deref() {
            match self.list_all(calendar_id, Some(token), None).await {
                Ok(result) => listed = Some(result),
                Err(GoogleCalendarError::Upstream(GoogleApiError::Gone)) => {
                    tracing::info!(
                        target: LOG_TARGET,
                        event = "google_calendar_full_resync",
                        reason = "sync_token_expired",
                        "google calendar full resync"
                    );
                    resync = true;
                }
                Err(error) => return Err(error),
            }
        }
        let full = listed.is_none();
        let (events, next_token) = match listed {
            Some(result) => result,
            None => {
                let time_min = window_time_min(window, self.inner.local_offset);
                self.list_all(calendar_id, None, Some(&time_min)).await?
            }
        };
        let mut seen: HashSet<String> = HashSet::new();
        let mut changes = Vec::new();
        for event in events.into_iter().rev() {
            if seen.insert(event.id.clone()) {
                changes.push(GChange::event(event));
            }
        }
        changes.reverse();
        // After a 410, a linked event missing from the listing counts as deleted only
        // once events.get confirms it (404 or cancelled).
        let mut confirm: Vec<&str> = Vec::new();
        if resync {
            confirm.extend(
                links
                    .iter()
                    .filter(|link| {
                        matches!(
                            link.state,
                            LinkState::Active | LinkState::Frozen | LinkState::Error
                        )
                    })
                    .map(|link| link.google_event_id.as_str()),
            );
        }
        confirm.extend(pending.iter().map(|row| row.google_event_id.as_str()));
        for id in confirm {
            if seen.contains(id) {
                continue;
            }
            match google_call!(self, "get_event", |api, at| api.get_event(
                at,
                calendar_id,
                id
            )) {
                Ok(Some(event)) => changes.push(GChange::event(event)),
                Ok(None) => changes.push(GChange::deleted(id)),
                Err(error) if is_fatal(&error) => return Err(error),
                // Unconfirmed: keep the link as is.
                Err(_) => continue,
            }
            seen.insert(id.to_owned());
        }
        Ok(Pulled {
            changes,
            next_token,
            full,
        })
    }
}

fn log_skipped(reason: &'static str) {
    tracing::info!(
        target: LOG_TARGET,
        event = "google_calendar_sync_skipped",
        reason,
        "google calendar sync skipped"
    );
}

pub(crate) fn log_skipped_reason(reason: &'static str) {
    log_skipped(reason);
}

struct Exec<'r> {
    rt: &'r GoogleCalendar,
    db: SyncDb,
    calendar_id: String,
    now: OffsetDateTime,
    writes: usize,
    counts: SyncCounts,
    abort: Option<GoogleCalendarError>,
    budget_exhausted: bool,
    failed_inbound: HashSet<String>,
}

impl Exec<'_> {
    fn budget(&mut self, needed: usize) -> bool {
        if self.writes + needed > MAX_WRITES_PER_PASS {
            self.budget_exhausted = true;
            return false;
        }
        true
    }

    async fn run(&mut self, action: Action) {
        match action {
            Action::InsertGoogle { event, link, .. } => self.insert_google(event, link).await,
            Action::Update {
                raven_item_id,
                google,
                raven,
                link,
                ..
            } => self.update(&raven_item_id, google, raven, link).await,
            Action::DeleteGoogle { link, .. } => self.delete_google(link).await,
            Action::CreateRaven { event, link, .. } => self.create_raven(event, link),
            Action::ArchiveRaven {
                raven_item_id,
                expected_updated_at,
                link,
                ..
            } => self.archive_raven(&raven_item_id, expected_updated_at, link),
            Action::SaveLink(link) => self.save(&link),
            Action::DeleteLink {
                calendar_id,
                google_event_id,
            } => {
                if let Err(error) = self.db.repo().delete_link(&calendar_id, &google_event_id) {
                    self.abort = Some(error.into());
                }
            }
        }
    }

    fn save(&mut self, link: &Link) {
        if let Err(error) = self.db.repo().upsert_link(link) {
            self.abort = Some(error.into());
        }
    }

    /// An inbound change that could not be applied: retried via `events.get`.
    fn park_inbound(&mut self, google_event_id: &str, kind: &str) {
        self.failed_inbound.insert(google_event_id.to_owned());
        let next = self.now + PENDING_RETRY_DELAY;
        if let Err(error) =
            self.db
                .repo()
                .record_pending_failure(&self.calendar_id, google_event_id, kind, next)
        {
            self.abort = Some(error.into());
        }
    }

    fn link_failed(&mut self, google_event_id: &str, error: &GoogleCalendarError) {
        self.counts.failed += 1;
        let result = self.db.repo().record_link_error(
            &self.calendar_id,
            google_event_id,
            error_kind(error),
            LINK_ERROR_AFTER,
        );
        if let Err(storage) = result {
            self.abort = Some(storage.into());
        } else if is_fatal(error) {
            self.abort = Some(error.clone());
        }
    }

    fn raven_failed(&mut self, google_event_id: &str, fail: RavenFail) {
        if !matches!(fail, RavenFail::Conflict) {
            self.counts.failed += 1;
        }
        self.park_inbound(google_event_id, fail.kind());
        if matches!(fail, RavenFail::Fatal) {
            self.abort = Some(GoogleCalendarError::TodoUnavailable);
        }
    }

    async fn insert_google(&mut self, event: GEventWrite, mut link: Link) {
        if !self.budget(1) {
            return;
        }
        let calendar_id = self.calendar_id.clone();
        let rt = self.rt;
        self.writes += 1;
        let inserted = google_call!(rt, "insert_event", |api, at| api.insert_event(
            at,
            &calendar_id,
            &event
        ));
        let stored = match inserted {
            Ok(stored) => stored,
            // Already there (earlier crash or a re-link): adopt it.
            Err(GoogleCalendarError::Upstream(GoogleApiError::Conflict)) => {
                let id = link.google_event_id.clone();
                match google_call!(rt, "get_event", |api, at| api.get_event(
                    at,
                    &calendar_id,
                    &id
                )) {
                    Ok(Some(existing)) if existing.status == GEventStatus::Cancelled => {
                        let mut restore = event.clone();
                        restore.id = None;
                        restore.status = Some(restore.status.unwrap_or(GEventStatus::Confirmed));
                        let if_match = existing.etag.clone().unwrap_or_else(|| "*".to_owned());
                        match google_call!(rt, "patch_event", |api, at| api.patch_event(
                            at,
                            &calendar_id,
                            &id,
                            &if_match,
                            &restore
                        )) {
                            Ok(stored) => stored,
                            Err(error) => return self.insert_failed(&error),
                        }
                    }
                    Ok(Some(existing)) => existing,
                    Ok(None) => {
                        return self.insert_failed(&GoogleCalendarError::Upstream(
                            GoogleApiError::Conflict,
                        ));
                    }
                    Err(error) => return self.insert_failed(&error),
                }
            }
            Err(error) => return self.insert_failed(&error),
        };
        link.google_etag = stored.etag.or(link.google_etag);
        link.google_updated = stored.updated.or(link.google_updated);
        self.counts.google_created += 1;
        self.save(&link);
    }

    fn insert_failed(&mut self, error: &GoogleCalendarError) {
        self.counts.failed += 1;
        if is_fatal(error) {
            self.abort = Some(error.clone());
        }
    }

    async fn update(
        &mut self,
        raven_item_id: &str,
        google: Option<GooglePatch>,
        raven: Option<RavenChange>,
        mut link: Link,
    ) {
        let needed = usize::from(google.is_some()) + usize::from(raven.is_some());
        if !self.budget(needed) {
            return;
        }
        let google_event_id = link.google_event_id.clone();
        let pulled = raven.is_some();
        if let Some(change) = raven {
            self.writes += 1;
            match raven_update(&self.rt.inner.todo_db, raven_item_id, change) {
                Ok(item) => {
                    link.raven_updated_at = item.updated_at;
                    self.counts.raven_updated += 1;
                }
                Err(fail) => return self.raven_failed(&google_event_id, fail),
            }
        }
        if let Some(patch) = google {
            self.writes += 1;
            let calendar_id = self.calendar_id.clone();
            let rt = self.rt;
            let if_match = patch.if_match.clone().unwrap_or_else(|| "*".to_owned());
            let result = google_call!(rt, "patch_event", |api, at| api.patch_event(
                at,
                &calendar_id,
                &google_event_id,
                &if_match,
                &patch.event
            ));
            match result {
                Ok(stored) => {
                    link.google_etag = stored.etag.or(link.google_etag);
                    link.google_updated = stored.updated.or(link.google_updated);
                    self.counts.google_updated += 1;
                }
                Err(error) => {
                    if matches!(
                        error,
                        GoogleCalendarError::Upstream(
                            GoogleApiError::PreconditionFailed
                                | GoogleApiError::NotFound
                                | GoogleApiError::Gone
                        )
                    ) {
                        // Refetch the event next pass.
                        self.park_inbound(&google_event_id, error_kind(&error));
                    }
                    if pulled {
                        // Keep the applied Raven change; the pushed fields stay pending.
                        self.save_reverted(&mut link, &patch.event);
                    }
                    return self.link_failed(&google_event_id, &error);
                }
            }
        }
        self.save(&link);
    }

    /// Stores `link` with the pushed fields' base (and Google etag) reverted to the
    /// stored link, so the next pass pushes them again.
    fn save_reverted(&mut self, link: &mut Link, pushed: &GEventWrite) {
        let old = self
            .db
            .repo()
            .link_by_google(&self.calendar_id, &link.google_event_id)
            .ok()
            .flatten();
        let base = old
            .as_ref()
            .map(|old| old.base_hashes.clone())
            .unwrap_or_default();
        if pushed.summary.is_some() {
            link.base_hashes.title = base.title.clone();
        }
        if pushed.start.is_some() {
            link.base_hashes.start = base.start.clone();
        }
        if pushed.description.is_some() {
            link.base_hashes.note = base.note.clone();
        }
        if pushed.location.is_some() {
            link.base_hashes.location = base.location.clone();
        }
        if pushed.status.is_some() {
            link.base_hashes.status = base.status.clone();
        }
        link.google_etag = old.as_ref().and_then(|old| old.google_etag.clone());
        link.google_updated = old.as_ref().and_then(|old| old.google_updated);
        let link = link.clone();
        self.save(&link);
    }

    async fn delete_google(&mut self, link: Link) {
        if !self.budget(1) {
            return;
        }
        self.writes += 1;
        let calendar_id = self.calendar_id.clone();
        let id = link.google_event_id.clone();
        let rt = self.rt;
        match google_call!(rt, "delete_event", |api, at| api.delete_event(
            at,
            &calendar_id,
            &id
        )) {
            Ok(())
            | Err(GoogleCalendarError::Upstream(GoogleApiError::NotFound | GoogleApiError::Gone)) =>
            {
                self.counts.google_deleted += 1;
                self.save(&link);
            }
            Err(error) => self.link_failed(&id, &error),
        }
    }

    fn create_raven(&mut self, event: NewRavenEvent, mut link: Link) {
        if !self.budget(1) {
            return;
        }
        self.writes += 1;
        match raven_create(&self.rt.inner.todo_db, event) {
            Ok(item) => {
                link.raven_item_id = item.id;
                link.raven_updated_at = item.updated_at;
                self.counts.raven_created += 1;
                self.save(&link);
            }
            Err(fail) => {
                let id = link.google_event_id.clone();
                self.raven_failed(&id, fail);
            }
        }
    }

    fn archive_raven(&mut self, raven_item_id: &str, expected: OffsetDateTime, mut link: Link) {
        if !self.budget(1) {
            return;
        }
        self.writes += 1;
        let id = link.google_event_id.clone();
        match raven_archive(&self.rt.inner.todo_db, raven_item_id, expected) {
            Ok(Some(item)) => {
                link.raven_updated_at = item.updated_at;
                self.counts.raven_archived += 1;
                self.save(&link);
            }
            // Edited since read: confirm the deletion again next pass.
            Ok(None) => self.raven_failed(&id, RavenFail::Conflict),
            Err(fail) => self.raven_failed(&id, fail),
        }
    }
}
