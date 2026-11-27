//! Google Calendar v3 REST client.
//!
//! Endpoints are hard-coded; the only override is a test-only plain-http loopback base
//! (see [`loopback_base`]). Errors are mapped to [`GoogleApiError`] kinds and never carry
//! URLs, response bodies or tokens.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use reqwest::header::{self, HeaderMap};
use reqwest::{Method, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::mapping::{GEvent, GEventWrite};
use super::oauth::AccessToken;

pub const CALENDAR_API_BASE: &str = "https://www.googleapis.com/calendar/v3";
/// Test-only override: plain `http://` loopback base serving `/calendar/v3`, `/token`
/// and `/revoke`. Any other value is ignored.
pub const GOOGLE_API_URL_ENV: &str = "RAVEN_GOOGLE_API_URL";

pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_LIST_BYTES: usize = 16 * 1024 * 1024;
const MAX_ITEM_BYTES: usize = 2 * 1024 * 1024;
const MAX_ERROR_BYTES: usize = 64 * 1024;
const MAX_RETRY_AFTER: Duration = Duration::from_secs(60 * 60);
const MAX_CALENDAR_PAGES: usize = 20;
const DEFAULT_MAX_RESULTS: u32 = 250;

const EVENT_FIELDS: &str = "id,status,summary,description,location,start,end,updated,etag,\
recurrence,recurringEventId,eventType,extendedProperties";
const CALENDAR_LIST_FIELDS: &str = "nextPageToken,items(id,summary,primary,accessRole,timeZone)";
const CALENDAR_FIELDS: &str = "id,summary,timeZone";

pub type GFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, GoogleApiError>> + Send + 'a>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum GoogleApiError {
    #[error("google access token rejected")]
    Unauthorized,
    #[error("google authorization grant is invalid or revoked")]
    InvalidGrant,
    #[error("google request forbidden")]
    Forbidden,
    #[error("google resource not found")]
    NotFound,
    #[error("google resource gone")]
    Gone,
    #[error("google resource already exists")]
    Conflict,
    #[error("google resource changed since last read")]
    PreconditionFailed,
    #[error("google rate limit exceeded")]
    RateLimited { retry_after: Option<Duration> },
    #[error("google server error")]
    Server,
    #[error("google unreachable")]
    Network,
    #[error("google response invalid")]
    InvalidResponse,
}

impl GoogleApiError {
    /// Stable snake_case kind for logs and status JSON.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Unauthorized => "unauthorized",
            Self::InvalidGrant => "invalid_grant",
            Self::Forbidden => "forbidden",
            Self::NotFound => "not_found",
            Self::Gone => "gone",
            Self::Conflict => "conflict",
            Self::PreconditionFailed => "precondition_failed",
            Self::RateLimited { .. } => "rate_limited",
            Self::Server => "server",
            Self::Network => "network",
            Self::InvalidResponse => "invalid_response",
        }
    }
}

pub trait CalendarApi: Send + Sync {
    fn list_events<'a>(
        &'a self,
        at: &'a AccessToken,
        cal: &'a str,
        req: ListRequest<'a>,
    ) -> GFuture<'a, EventPage>;
    /// `Ok(None)` when Google answers 404.
    fn get_event<'a>(
        &'a self,
        at: &'a AccessToken,
        cal: &'a str,
        id: &'a str,
    ) -> GFuture<'a, Option<GEvent>>;
    fn insert_event<'a>(
        &'a self,
        at: &'a AccessToken,
        cal: &'a str,
        ev: &'a GEventWrite,
    ) -> GFuture<'a, GEvent>;
    fn patch_event<'a>(
        &'a self,
        at: &'a AccessToken,
        cal: &'a str,
        id: &'a str,
        if_match: &'a str,
        ev: &'a GEventWrite,
    ) -> GFuture<'a, GEvent>;
    fn delete_event<'a>(
        &'a self,
        at: &'a AccessToken,
        cal: &'a str,
        id: &'a str,
    ) -> GFuture<'a, ()>;
    fn insert_calendar<'a>(
        &'a self,
        at: &'a AccessToken,
        summary: &'a str,
        tz: &'a str,
    ) -> GFuture<'a, GCalendar>;
    /// All pages of the calendar list, filtered to `writer`/`owner` access.
    fn list_calendars<'a>(&'a self, at: &'a AccessToken) -> GFuture<'a, Vec<GCalendarListEntry>>;
}

// ---------------------------------------------------------------------------
// Wire types

// Events use the single model in [`super::mapping`]: [`GEvent::from_json`] reads a
// Google `Event` resource and [`GEventWrite::to_json`] builds insert/PATCH bodies.

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EventPage {
    pub items: Vec<GEvent>,
    pub next_page_token: Option<String>,
    pub next_sync_token: Option<String>,
}

/// One `events.list` page request. `singleEvents=false` is always sent. When
/// `sync_token` is set, `time_min` is not sent (Google rejects the combination).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ListRequest<'a> {
    pub sync_token: Option<&'a str>,
    pub page_token: Option<&'a str>,
    /// RFC3339 lower bound for a full sync.
    pub time_min: Option<&'a str>,
    pub show_deleted: bool,
    /// Clamped to `1..=2500`.
    pub max_results: u32,
}

impl Default for ListRequest<'_> {
    fn default() -> Self {
        Self {
            sync_token: None,
            page_token: None,
            time_min: None,
            show_deleted: false,
            max_results: DEFAULT_MAX_RESULTS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GCalendar {
    pub id: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub time_zone: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GCalendarListEntry {
    pub id: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub primary: bool,
    pub access_role: String,
    #[serde(default)]
    pub time_zone: Option<String>,
}

impl GCalendarListEntry {
    pub fn writable(&self) -> bool {
        matches!(self.access_role.as_str(), "writer" | "owner")
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventListBody {
    #[serde(default)]
    items: Vec<serde_json::Value>,
    #[serde(default)]
    next_page_token: Option<String>,
    #[serde(default)]
    next_sync_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarListBody {
    #[serde(default)]
    items: Vec<GCalendarListEntry>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CalendarInsertBody<'a> {
    summary: &'a str,
    time_zone: &'a str,
}

// ---------------------------------------------------------------------------
// Shared HTTP plumbing (also used by `oauth`)

/// Validates a test-only override: `http://` loopback, no credentials/query/fragment.
/// Returns the base without a trailing slash.
pub(crate) fn loopback_base(base: &str) -> Option<String> {
    let url = Url::parse(base).ok()?;
    let host = url.host_str()?;
    let loopback = host == "localhost"
        || host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if url.scheme() != "http"
        || !loopback
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    Some(url.as_str().trim_end_matches('/').to_owned())
}

pub(crate) fn http_client(timeout: Duration) -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT.min(timeout))
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("raven")
        .build()?)
}

/// Sends a request and returns the success body (capped) or a mapped error.
pub(crate) async fn execute(
    request: reqwest::RequestBuilder,
    cap: usize,
) -> Result<(StatusCode, Vec<u8>), GoogleApiError> {
    let response = request.send().await.map_err(|_| GoogleApiError::Network)?;
    let status = response.status();
    if status.is_success() {
        let body = read_capped(response, cap)
            .await?
            .ok_or(GoogleApiError::InvalidResponse)?;
        return Ok((status, body));
    }
    let headers = response.headers().clone();
    let body = read_capped(response, MAX_ERROR_BYTES)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    Err(map_error(status, &headers, &body))
}

/// `Ok(None)` when the body exceeds `cap`.
async fn read_capped(
    mut response: reqwest::Response,
    cap: usize,
) -> Result<Option<Vec<u8>>, GoogleApiError> {
    if response
        .content_length()
        .is_some_and(|length| length > cap as u64)
    {
        return Ok(None);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| GoogleApiError::Network)?
    {
        if body.len() + chunk.len() > cap {
            return Ok(None);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(Some(body))
}

#[derive(Deserialize)]
struct ErrorEnvelope {
    #[serde(default)]
    error: Option<ErrorValue>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ErrorValue {
    /// OAuth endpoints: `{"error":"invalid_grant"}`.
    Code(String),
    /// Calendar API: `{"error":{"errors":[{"reason":".."}],"status":".."}}`.
    Detail {
        #[serde(default)]
        errors: Vec<ErrorReason>,
    },
}

#[derive(Deserialize)]
struct ErrorReason {
    #[serde(default)]
    reason: Option<String>,
}

fn error_codes(body: &[u8]) -> Vec<String> {
    match serde_json::from_slice::<ErrorEnvelope>(body) {
        Ok(ErrorEnvelope {
            error: Some(ErrorValue::Code(code)),
        }) => vec![code],
        Ok(ErrorEnvelope {
            error: Some(ErrorValue::Detail { errors }),
        }) => errors
            .into_iter()
            .filter_map(|error| error.reason)
            .collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn map_error(status: StatusCode, headers: &HeaderMap, body: &[u8]) -> GoogleApiError {
    let retry_after = || retry_after(headers);
    match status.as_u16() {
        400 if error_codes(body).iter().any(|code| code == "invalid_grant") => {
            GoogleApiError::InvalidGrant
        }
        401 => GoogleApiError::Unauthorized,
        403 if error_codes(body)
            .iter()
            .any(|code| code == "rateLimitExceeded" || code == "userRateLimitExceeded") =>
        {
            GoogleApiError::RateLimited {
                retry_after: retry_after(),
            }
        }
        403 => GoogleApiError::Forbidden,
        404 => GoogleApiError::NotFound,
        409 => GoogleApiError::Conflict,
        410 => GoogleApiError::Gone,
        412 => GoogleApiError::PreconditionFailed,
        429 => GoogleApiError::RateLimited {
            retry_after: retry_after(),
        },
        500..=599 => GoogleApiError::Server,
        _ => GoogleApiError::InvalidResponse,
    }
}

/// Delay-seconds form only; HTTP-date values are ignored. Capped at one hour.
fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    let seconds = headers
        .get(header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()?;
    Some(Duration::from_secs(seconds).min(MAX_RETRY_AFTER))
}

pub(crate) fn parse_json<T: DeserializeOwned>(body: &[u8]) -> Result<T, GoogleApiError> {
    serde_json::from_slice(body).map_err(|_| GoogleApiError::InvalidResponse)
}

fn to_json<T: Serialize>(value: &T) -> Result<Vec<u8>, GoogleApiError> {
    serde_json::to_vec(value).map_err(|_| GoogleApiError::InvalidResponse)
}

fn event_body(event: &GEventWrite) -> Result<Vec<u8>, GoogleApiError> {
    to_json(&event.to_json())
}

fn parse_event(body: &[u8]) -> Result<GEvent, GoogleApiError> {
    let value: serde_json::Value = parse_json(body)?;
    GEvent::from_json(&value).ok_or(GoogleApiError::InvalidResponse)
}

// ---------------------------------------------------------------------------
// reqwest implementation

/// Real Google Calendar client.
pub struct GoogleCalendarHttp {
    client: reqwest::Client,
    base: Url,
    list_cap: usize,
    item_cap: usize,
}

impl GoogleCalendarHttp {
    pub fn new() -> anyhow::Result<Self> {
        Self::with_base(CALENDAR_API_BASE, REQUEST_TIMEOUT)
    }

    /// Like [`GoogleCalendarHttp::new`] but honors a valid loopback override value of
    /// [`GOOGLE_API_URL_ENV`] (serving `<base>/calendar/v3`). Other values are ignored.
    pub fn from_env(api_url: Option<String>) -> anyhow::Result<Self> {
        match api_url.as_deref().and_then(loopback_base) {
            Some(base) => Self::with_base(&format!("{base}/calendar/v3"), REQUEST_TIMEOUT),
            None => Self::new(),
        }
    }

    pub(crate) fn with_base(base: &str, timeout: Duration) -> anyhow::Result<Self> {
        Ok(Self {
            client: http_client(timeout)?,
            base: Url::parse(base.trim_end_matches('/'))?,
            list_cap: MAX_LIST_BYTES,
            item_cap: MAX_ITEM_BYTES,
        })
    }

    #[cfg(test)]
    fn with_caps(mut self, list_cap: usize, item_cap: usize) -> Self {
        self.list_cap = list_cap;
        self.item_cap = item_cap;
        self
    }

    fn url(&self, segments: &[&str], query: &[(&str, &str)]) -> Result<Url, GoogleApiError> {
        if segments.iter().any(|segment| segment.is_empty()) {
            return Err(GoogleApiError::NotFound);
        }
        let mut url = self.base.clone();
        url.path_segments_mut()
            .map_err(|_| GoogleApiError::InvalidResponse)?
            .pop_if_empty()
            .extend(segments);
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query);
        }
        Ok(url)
    }

    fn request(&self, method: Method, url: Url, at: &AccessToken) -> reqwest::RequestBuilder {
        self.client
            .request(method, url)
            .bearer_auth(at.secret().expose())
            .header(header::ACCEPT, "application/json")
    }

    fn with_json(request: reqwest::RequestBuilder, body: Vec<u8>) -> reqwest::RequestBuilder {
        request
            .header(header::CONTENT_TYPE, "application/json")
            .body(body)
    }

    async fn list_events_impl(
        &self,
        at: &AccessToken,
        cal: &str,
        req: ListRequest<'_>,
    ) -> Result<EventPage, GoogleApiError> {
        let max_results = req.max_results.clamp(1, 2500).to_string();
        let fields = format!("nextPageToken,nextSyncToken,items({EVENT_FIELDS})");
        let mut query: Vec<(&str, &str)> = vec![
            ("maxResults", &max_results),
            ("singleEvents", "false"),
            ("fields", &fields),
        ];
        if req.show_deleted {
            query.push(("showDeleted", "true"));
        }
        if let Some(token) = req.sync_token {
            query.push(("syncToken", token));
        } else if let Some(time_min) = req.time_min {
            query.push(("timeMin", time_min));
        }
        if let Some(token) = req.page_token {
            query.push(("pageToken", token));
        }
        let url = self.url(&["calendars", cal, "events"], &query)?;
        let (_, body) = execute(self.request(Method::GET, url, at), self.list_cap).await?;
        let body: EventListBody = parse_json(&body)?;
        Ok(EventPage {
            // Items without an id cannot be synced; skip them instead of failing the page.
            items: body.items.iter().filter_map(GEvent::from_json).collect(),
            next_page_token: body.next_page_token,
            next_sync_token: body.next_sync_token,
        })
    }

    async fn get_event_impl(
        &self,
        at: &AccessToken,
        cal: &str,
        id: &str,
    ) -> Result<Option<GEvent>, GoogleApiError> {
        let url = self.url(
            &["calendars", cal, "events", id],
            &[("fields", EVENT_FIELDS)],
        )?;
        match execute(self.request(Method::GET, url, at), self.item_cap).await {
            Ok((_, body)) => parse_event(&body).map(Some),
            Err(GoogleApiError::NotFound) => Ok(None),
            Err(error) => Err(error),
        }
    }

    async fn insert_event_impl(
        &self,
        at: &AccessToken,
        cal: &str,
        ev: &GEventWrite,
    ) -> Result<GEvent, GoogleApiError> {
        let url = self.url(
            &["calendars", cal, "events"],
            &[("sendUpdates", "none"), ("fields", EVENT_FIELDS)],
        )?;
        let request = Self::with_json(self.request(Method::POST, url, at), event_body(ev)?);
        let (_, body) = execute(request, self.item_cap).await?;
        parse_event(&body)
    }

    async fn patch_event_impl(
        &self,
        at: &AccessToken,
        cal: &str,
        id: &str,
        if_match: &str,
        ev: &GEventWrite,
    ) -> Result<GEvent, GoogleApiError> {
        let url = self.url(
            &["calendars", cal, "events", id],
            &[("sendUpdates", "none"), ("fields", EVENT_FIELDS)],
        )?;
        let request = self
            .request(Method::PATCH, url, at)
            .header(header::IF_MATCH, if_match);
        let (_, body) = execute(Self::with_json(request, event_body(ev)?), self.item_cap).await?;
        parse_event(&body)
    }

    async fn delete_event_impl(
        &self,
        at: &AccessToken,
        cal: &str,
        id: &str,
    ) -> Result<(), GoogleApiError> {
        let url = self.url(
            &["calendars", cal, "events", id],
            &[("sendUpdates", "none")],
        )?;
        execute(self.request(Method::DELETE, url, at), self.item_cap).await?;
        Ok(())
    }

    async fn insert_calendar_impl(
        &self,
        at: &AccessToken,
        summary: &str,
        tz: &str,
    ) -> Result<GCalendar, GoogleApiError> {
        let url = self.url(&["calendars"], &[("fields", CALENDAR_FIELDS)])?;
        let body = to_json(&CalendarInsertBody {
            summary,
            time_zone: tz,
        })?;
        let request = Self::with_json(self.request(Method::POST, url, at), body);
        let (_, body) = execute(request, self.item_cap).await?;
        parse_json(&body)
    }

    async fn list_calendars_impl(
        &self,
        at: &AccessToken,
    ) -> Result<Vec<GCalendarListEntry>, GoogleApiError> {
        let mut calendars = Vec::new();
        let mut page_token: Option<String> = None;
        for _ in 0..MAX_CALENDAR_PAGES {
            let mut query = vec![
                ("minAccessRole", "writer"),
                ("maxResults", "250"),
                ("fields", CALENDAR_LIST_FIELDS),
            ];
            if let Some(token) = page_token.as_deref() {
                query.push(("pageToken", token));
            }
            let url = self.url(&["users", "me", "calendarList"], &query)?;
            let (_, body) = execute(self.request(Method::GET, url, at), self.list_cap).await?;
            let body: CalendarListBody = parse_json(&body)?;
            calendars.extend(body.items.into_iter().filter(GCalendarListEntry::writable));
            match body.next_page_token {
                Some(token) if !token.is_empty() => page_token = Some(token),
                _ => return Ok(calendars),
            }
        }
        Err(GoogleApiError::InvalidResponse)
    }
}

impl CalendarApi for GoogleCalendarHttp {
    fn list_events<'a>(
        &'a self,
        at: &'a AccessToken,
        cal: &'a str,
        req: ListRequest<'a>,
    ) -> GFuture<'a, EventPage> {
        Box::pin(self.list_events_impl(at, cal, req))
    }

    fn get_event<'a>(
        &'a self,
        at: &'a AccessToken,
        cal: &'a str,
        id: &'a str,
    ) -> GFuture<'a, Option<GEvent>> {
        Box::pin(self.get_event_impl(at, cal, id))
    }

    fn insert_event<'a>(
        &'a self,
        at: &'a AccessToken,
        cal: &'a str,
        ev: &'a GEventWrite,
    ) -> GFuture<'a, GEvent> {
        Box::pin(self.insert_event_impl(at, cal, ev))
    }

    fn patch_event<'a>(
        &'a self,
        at: &'a AccessToken,
        cal: &'a str,
        id: &'a str,
        if_match: &'a str,
        ev: &'a GEventWrite,
    ) -> GFuture<'a, GEvent> {
        Box::pin(self.patch_event_impl(at, cal, id, if_match, ev))
    }

    fn delete_event<'a>(
        &'a self,
        at: &'a AccessToken,
        cal: &'a str,
        id: &'a str,
    ) -> GFuture<'a, ()> {
        Box::pin(self.delete_event_impl(at, cal, id))
    }

    fn insert_calendar<'a>(
        &'a self,
        at: &'a AccessToken,
        summary: &'a str,
        tz: &'a str,
    ) -> GFuture<'a, GCalendar> {
        Box::pin(self.insert_calendar_impl(at, summary, tz))
    }

    fn list_calendars<'a>(&'a self, at: &'a AccessToken) -> GFuture<'a, Vec<GCalendarListEntry>> {
        Box::pin(self.list_calendars_impl(at))
    }
}

#[cfg(test)]
pub(crate) mod fake {
    //! Loopback-only fake HTTP server: one canned response per connection.

    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    pub(crate) struct Recorded {
        /// Request line + headers, as sent.
        pub head: String,
        pub body: String,
    }

    impl Recorded {
        pub(crate) fn request_line(&self) -> &str {
            self.head.lines().next().unwrap_or_default()
        }

        pub(crate) fn header(&self, name: &str) -> Option<&str> {
            self.head.lines().skip(1).find_map(|line| {
                let (key, value) = line.split_once(':')?;
                key.eq_ignore_ascii_case(name).then(|| value.trim())
            })
        }
    }

    pub(crate) type Served = tokio::task::JoinHandle<Vec<Recorded>>;

    pub(crate) fn response(status: &str, headers: &[(&str, &str)], body: &str) -> String {
        let mut out = format!("HTTP/1.1 {status}\r\n");
        for (name, value) in headers {
            out.push_str(&format!("{name}: {value}\r\n"));
        }
        out.push_str(&format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ));
        out
    }

    pub(crate) fn ok(body: &str) -> String {
        response("200 OK", &[], body)
    }

    pub(crate) async fn serve(responses: Vec<String>) -> (String, Served) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let mut recorded = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buffer = [0_u8; 8192];
                let head_end = loop {
                    if let Some(at) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                        break at + 4;
                    }
                    let read = stream.read(&mut buffer).await.unwrap();
                    assert!(read > 0, "client closed before headers");
                    request.extend_from_slice(&buffer[..read]);
                };
                let head = String::from_utf8_lossy(&request[..head_end]).into_owned();
                let length = head
                    .lines()
                    .filter_map(|line| line.split_once(':'))
                    .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
                    .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                while request.len() < head_end + length {
                    let read = stream.read(&mut buffer).await.unwrap();
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                }
                let body = String::from_utf8_lossy(&request[head_end..]).into_owned();
                stream.write_all(response.as_bytes()).await.ok();
                stream.shutdown().await.ok();
                recorded.push(Recorded { head, body });
            }
            recorded
        });
        (base, handle)
    }
}

#[cfg(test)]
mod tests {
    use super::fake::{ok, response, serve};
    use super::*;
    use crate::google_calendar::mapping::{EventTime, GEventStatus};
    use crate::google_calendar::secret::Secret;

    const EVENT: &str = r#"{"id":"raven0123","status":"confirmed","summary":"S","etag":"\"e2\"","updated":"2026-11-20T01:00:00.000Z","start":{"dateTime":"2026-11-21T09:00:00+09:00","timeZone":"Asia/Seoul"},"end":{"dateTime":"2026-11-21T10:00:00+09:00"},"extendedProperties":{"private":{"raven_item_id":"abc"}}}"#;

    fn token() -> AccessToken {
        AccessToken::new(Secret::new("ya29.test-access"))
    }

    async fn client(responses: Vec<String>) -> (GoogleCalendarHttp, super::fake::Served) {
        let (base, handle) = serve(responses).await;
        let client =
            GoogleCalendarHttp::with_base(&format!("{base}/calendar/v3"), Duration::from_secs(5))
                .unwrap();
        (client, handle)
    }

    fn query_pairs(line: &str) -> Vec<(String, String)> {
        let target = line.split(' ').nth(1).unwrap();
        Url::parse(&format!("http://x{target}"))
            .unwrap()
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect()
    }

    fn has(pairs: &[(String, String)], key: &str, value: &str) -> bool {
        pairs.iter().any(|(k, v)| k == key && v == value)
    }

    fn keys(pairs: &[(String, String)]) -> Vec<&str> {
        pairs.iter().map(|(k, _)| k.as_str()).collect()
    }

    #[tokio::test]
    async fn list_events_sends_sync_token_page_token_and_fields() {
        let page = format!(r#"{{"items":[{EVENT}],"nextPageToken":"p2","nextSyncToken":null}}"#);
        let (client, handle) = client(vec![ok(&page)]).await;
        let request = ListRequest {
            sync_token: Some("sync-1"),
            page_token: Some("p1"),
            time_min: Some("2026-11-13T00:00:00+09:00"),
            show_deleted: true,
            ..ListRequest::default()
        };

        let result = client
            .list_events(&token(), "team#cal@group.calendar.google.com", request)
            .await
            .unwrap();

        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].id, "raven0123");
        assert_eq!(result.items[0].raven_item_id.as_deref(), Some("abc"));
        assert_eq!(result.next_page_token.as_deref(), Some("p2"));
        assert_eq!(result.next_sync_token, None);
        let recorded = handle.await.unwrap().remove(0);
        let line = recorded.request_line();
        assert!(
            line.starts_with(
                "GET /calendar/v3/calendars/team%23cal@group.calendar.google.com/events?"
            ),
            "{line}"
        );
        let pairs = query_pairs(line);
        assert!(has(&pairs, "syncToken", "sync-1"));
        assert!(has(&pairs, "pageToken", "p1"));
        assert!(has(&pairs, "maxResults", "250"));
        assert!(has(&pairs, "singleEvents", "false"));
        assert!(has(&pairs, "showDeleted", "true"));
        assert!(!keys(&pairs).contains(&"timeMin"), "timeMin with syncToken");
        let fields = &pairs.iter().find(|(k, _)| k == "fields").unwrap().1;
        assert!(
            fields.starts_with("nextPageToken,nextSyncToken,items(id,"),
            "{fields}"
        );
        assert_eq!(
            recorded.header("authorization"),
            Some("Bearer ya29.test-access")
        );
    }

    #[tokio::test]
    async fn list_events_full_sync_sends_time_min_and_returns_sync_token() {
        let (client, handle) = client(vec![ok(r#"{"items":[],"nextSyncToken":"sync-2"}"#)]).await;

        let result = client
            .list_events(
                &token(),
                "primary",
                ListRequest {
                    time_min: Some("2026-11-13T00:00:00+09:00"),
                    max_results: 99_999,
                    ..ListRequest::default()
                },
            )
            .await
            .unwrap();

        assert_eq!(result.next_sync_token.as_deref(), Some("sync-2"));
        assert!(result.items.is_empty());
        let recorded = handle.await.unwrap().remove(0);
        let pairs = query_pairs(recorded.request_line());
        assert!(has(&pairs, "timeMin", "2026-11-13T00:00:00+09:00"));
        assert!(has(&pairs, "maxResults", "2500"));
        assert!(!keys(&pairs).contains(&"syncToken"));
        assert!(!keys(&pairs).contains(&"pageToken"));
        assert!(!keys(&pairs).contains(&"showDeleted"));
    }

    #[tokio::test]
    async fn insert_sends_send_updates_none_and_json_body() {
        let (client, handle) = client(vec![ok(EVENT)]).await;
        let write = GEventWrite {
            id: Some("raven0123".into()),
            summary: Some("S".into()),
            start: Some(EventTime::Date(time::macros::date!(2026 - 11 - 21))),
            raven_item_id: Some("abc".into()),
            ..GEventWrite::default()
        };

        let event = client
            .insert_event(&token(), "primary", &write)
            .await
            .unwrap();

        assert_eq!(event.etag.as_deref(), Some("\"e2\""));
        let recorded = handle.await.unwrap().remove(0);
        assert!(
            recorded
                .request_line()
                .starts_with("POST /calendar/v3/calendars/primary/events?"),
            "{}",
            recorded.request_line()
        );
        assert!(has(
            &query_pairs(recorded.request_line()),
            "sendUpdates",
            "none"
        ));
        assert_eq!(recorded.header("content-type"), Some("application/json"));
        let body: serde_json::Value = serde_json::from_str(&recorded.body).unwrap();
        assert_eq!(
            body,
            serde_json::json!({
                "id": "raven0123",
                "summary": "S",
                "start": {"date": "2026-11-21", "dateTime": null, "timeZone": null},
                "extendedProperties": {"private": {"raven_item_id": "abc"}}
            })
        );
    }

    #[tokio::test]
    async fn patch_sends_if_match_send_updates_none_and_only_set_fields() {
        let (client, handle) = client(vec![ok(EVENT)]).await;
        let write = GEventWrite {
            status: Some(GEventStatus::Tentative),
            description: Some(String::new()),
            ..GEventWrite::default()
        };

        client
            .patch_event(&token(), "primary", "raven0123", "\"e1\"", &write)
            .await
            .unwrap();

        let recorded = handle.await.unwrap().remove(0);
        assert!(
            recorded
                .request_line()
                .starts_with("PATCH /calendar/v3/calendars/primary/events/raven0123?")
        );
        assert!(has(
            &query_pairs(recorded.request_line()),
            "sendUpdates",
            "none"
        ));
        assert_eq!(recorded.header("if-match"), Some("\"e1\""));
        let body: serde_json::Value = serde_json::from_str(&recorded.body).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"description": "", "status": "tentative"})
        );
    }

    #[tokio::test]
    async fn delete_sends_send_updates_none() {
        let (client, handle) = client(vec![response("204 No Content", &[], "")]).await;

        client
            .delete_event(&token(), "primary", "raven0123")
            .await
            .unwrap();

        let recorded = handle.await.unwrap().remove(0);
        assert!(
            recorded
                .request_line()
                .starts_with("DELETE /calendar/v3/calendars/primary/events/raven0123?")
        );
        assert!(has(
            &query_pairs(recorded.request_line()),
            "sendUpdates",
            "none"
        ));
    }

    #[tokio::test]
    async fn get_event_maps_404_to_none_and_reads_cancelled() {
        let (client, handle) = client(vec![
            response(
                "404 Not Found",
                &[],
                r#"{"error":{"code":404,"errors":[{"reason":"notFound"}]}}"#,
            ),
            ok(r#"{"id":"x","status":"cancelled"}"#),
        ])
        .await;

        assert_eq!(
            client.get_event(&token(), "primary", "x").await.unwrap(),
            None
        );
        let event = client
            .get_event(&token(), "primary", "x")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(event.status, GEventStatus::Cancelled);
        let recorded = handle.await.unwrap();
        assert!(has(
            &query_pairs(recorded[1].request_line()),
            "fields",
            EVENT_FIELDS
        ));
    }

    #[tokio::test]
    async fn list_calendars_follows_pages_and_keeps_only_writable() {
        let (client, handle) = client(vec![
            ok(r#"{"items":[{"id":"me@x","summary":"Me","primary":true,"accessRole":"owner","timeZone":"Asia/Seoul"},{"id":"ro","accessRole":"reader"}],"nextPageToken":"n2"}"#),
            ok(r#"{"items":[{"id":"team","summary":"Team","accessRole":"writer"}]}"#),
        ])
        .await;

        let calendars = client.list_calendars(&token()).await.unwrap();

        assert_eq!(
            calendars.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["me@x", "team"]
        );
        assert!(calendars[0].primary);
        assert_eq!(calendars[0].time_zone.as_deref(), Some("Asia/Seoul"));
        let recorded = handle.await.unwrap();
        let first = query_pairs(recorded[0].request_line());
        assert!(
            recorded[0]
                .request_line()
                .starts_with("GET /calendar/v3/users/me/calendarList?")
        );
        assert!(has(&first, "minAccessRole", "writer"));
        assert!(has(&first, "fields", CALENDAR_LIST_FIELDS));
        assert!(!keys(&first).contains(&"pageToken"));
        assert!(has(
            &query_pairs(recorded[1].request_line()),
            "pageToken",
            "n2"
        ));
    }

    #[tokio::test]
    async fn insert_calendar_posts_summary_and_time_zone() {
        let (client, handle) = client(vec![ok(
            r#"{"id":"c1@group","summary":"Raven","timeZone":"Asia/Seoul"}"#,
        )])
        .await;

        let calendar = client
            .insert_calendar(&token(), "Raven", "Asia/Seoul")
            .await
            .unwrap();

        assert_eq!(calendar.id, "c1@group");
        let recorded = handle.await.unwrap().remove(0);
        assert!(
            recorded
                .request_line()
                .starts_with("POST /calendar/v3/calendars?")
        );
        let body: serde_json::Value = serde_json::from_str(&recorded.body).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"summary":"Raven","timeZone":"Asia/Seoul"})
        );
    }

    async fn status_error(status: &str, headers: &[(&str, &str)], body: &str) -> GoogleApiError {
        let (client, _handle) = client(vec![response(status, headers, body)]).await;
        client
            .patch_event(&token(), "primary", "e", "\"1\"", &GEventWrite::default())
            .await
            .unwrap_err()
    }

    type Case<'a> = (&'a str, Vec<(&'a str, &'a str)>, &'a str, GoogleApiError);

    #[tokio::test]
    async fn http_statuses_map_to_error_kinds() {
        let rate = r#"{"error":{"code":403,"errors":[{"reason":"rateLimitExceeded"}]}}"#;
        let user_rate = r#"{"error":{"code":403,"errors":[{"reason":"userRateLimitExceeded"}]}}"#;
        let forbidden = r#"{"error":{"code":403,"errors":[{"reason":"forbidden"}]}}"#;
        let cases: Vec<Case> = vec![
            (
                "401 Unauthorized",
                vec![],
                "{}",
                GoogleApiError::Unauthorized,
            ),
            (
                "400 Bad Request",
                vec![],
                r#"{"error":"invalid_grant"}"#,
                GoogleApiError::InvalidGrant,
            ),
            (
                "400 Bad Request",
                vec![],
                r#"{"error":{"code":400}}"#,
                GoogleApiError::InvalidResponse,
            ),
            (
                "403 Forbidden",
                vec![("Retry-After", "7")],
                rate,
                GoogleApiError::RateLimited {
                    retry_after: Some(Duration::from_secs(7)),
                },
            ),
            (
                "403 Forbidden",
                vec![],
                user_rate,
                GoogleApiError::RateLimited { retry_after: None },
            ),
            (
                "403 Forbidden",
                vec![],
                forbidden,
                GoogleApiError::Forbidden,
            ),
            ("404 Not Found", vec![], "{}", GoogleApiError::NotFound),
            ("409 Conflict", vec![], "{}", GoogleApiError::Conflict),
            ("410 Gone", vec![], "{}", GoogleApiError::Gone),
            (
                "412 Precondition Failed",
                vec![],
                "{}",
                GoogleApiError::PreconditionFailed,
            ),
            (
                "429 Too Many Requests",
                vec![("Retry-After", "30")],
                "{}",
                GoogleApiError::RateLimited {
                    retry_after: Some(Duration::from_secs(30)),
                },
            ),
            (
                "429 Too Many Requests",
                vec![("Retry-After", "999999")],
                "{}",
                GoogleApiError::RateLimited {
                    retry_after: Some(MAX_RETRY_AFTER),
                },
            ),
            (
                "429 Too Many Requests",
                vec![("Retry-After", "Wed, 21 Oct 2026 07:28:00 GMT")],
                "{}",
                GoogleApiError::RateLimited { retry_after: None },
            ),
            (
                "500 Internal Server Error",
                vec![],
                "",
                GoogleApiError::Server,
            ),
            (
                "503 Service Unavailable",
                vec![],
                "not json",
                GoogleApiError::Server,
            ),
            (
                "302 Found",
                vec![("Location", "http://127.0.0.1:1/x")],
                "",
                GoogleApiError::InvalidResponse,
            ),
        ];
        for (status, headers, body, expected) in cases {
            assert_eq!(
                status_error(status, &headers, body).await,
                expected,
                "{status} {body}"
            );
        }
    }

    #[tokio::test]
    async fn gone_sync_token_maps_to_gone_on_list() {
        let (client, _handle) = client(vec![response(
            "410 Gone",
            &[],
            r#"{"error":{"code":410,"errors":[{"reason":"fullSyncRequired"}]}}"#,
        )])
        .await;

        let error = client
            .list_events(
                &token(),
                "primary",
                ListRequest {
                    sync_token: Some("old"),
                    ..ListRequest::default()
                },
            )
            .await
            .unwrap_err();

        assert_eq!(error, GoogleApiError::Gone);
    }

    #[tokio::test]
    async fn invalid_json_and_oversized_bodies_are_invalid_responses() {
        let big = format!(r#"{{"items":[],"pad":"{}"}}"#, "x".repeat(4096));
        let (base, _handle) = serve(vec![ok("{not json"), ok(&big)]).await;
        let client =
            GoogleCalendarHttp::with_base(&format!("{base}/calendar/v3"), Duration::from_secs(5))
                .unwrap()
                .with_caps(1024, 1024);

        assert_eq!(
            client
                .get_event(&token(), "primary", "x")
                .await
                .unwrap_err(),
            GoogleApiError::InvalidResponse
        );
        assert_eq!(
            client
                .list_events(&token(), "primary", ListRequest::default())
                .await
                .unwrap_err(),
            GoogleApiError::InvalidResponse
        );
    }

    #[tokio::test]
    async fn network_failure_maps_to_network() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/calendar/v3", listener.local_addr().unwrap());
        drop(listener);
        let client = GoogleCalendarHttp::with_base(&base, Duration::from_secs(5)).unwrap();

        let error = client
            .delete_event(&token(), "primary", "x")
            .await
            .unwrap_err();

        assert_eq!(error, GoogleApiError::Network);
    }

    #[test]
    fn errors_render_without_urls_bodies_or_tokens() {
        for error in [
            GoogleApiError::Unauthorized,
            GoogleApiError::RateLimited {
                retry_after: Some(Duration::from_secs(3)),
            },
            GoogleApiError::Network,
            GoogleApiError::InvalidResponse,
        ] {
            let text = format!("{error} {error:?}");
            assert!(!text.contains("http"), "{text}");
            assert!(!text.contains("ya29"), "{text}");
        }
        assert_eq!(
            GoogleApiError::PreconditionFailed.kind(),
            "precondition_failed"
        );
    }

    #[test]
    fn loopback_override_accepts_only_plain_http_loopback() {
        assert_eq!(
            loopback_base("http://127.0.0.1:9999/").as_deref(),
            Some("http://127.0.0.1:9999")
        );
        assert!(loopback_base("http://localhost:1").is_some());
        assert!(loopback_base("http://[::1]:1").is_some());
        for rejected in [
            "https://127.0.0.1:1",
            "http://example.com",
            "http://10.0.0.1",
            "http://u:p@127.0.0.1:1",
            "http://127.0.0.1:1/?q=1",
            "http://127.0.0.1:1/#f",
            "not a url",
        ] {
            assert_eq!(loopback_base(rejected), None, "{rejected}");
        }
        let real = GoogleCalendarHttp::from_env(Some("https://evil.example".into())).unwrap();
        assert_eq!(real.base.as_str(), CALENDAR_API_BASE);
        let fake = GoogleCalendarHttp::from_env(Some("http://127.0.0.1:9/".into())).unwrap();
        assert_eq!(fake.base.as_str(), "http://127.0.0.1:9/calendar/v3");
    }

    #[test]
    fn empty_path_segments_are_rejected_before_sending() {
        let client = GoogleCalendarHttp::new().unwrap();
        assert_eq!(
            client.url(&["calendars", ""], &[]).unwrap_err(),
            GoogleApiError::NotFound
        );
    }
}
