//! `/api/v1/integrations/google-calendar*` on the UI and standalone API routers (never
//! MCP) and the unauthenticated UI-only OAuth callback. Every response is `no-store`;
//! POST/PUT require the exact Origin and `X-Raven-Integration: 1`.

use axum::Json;
use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::{Extension, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::ApiError;
use crate::google_calendar::{
    GoogleCalendar, GoogleCalendarError, SettingsUpdate, SyncOptions, Trigger, parse_callback_query,
};
use crate::system::ResolvedUiOrigin;

const INTEGRATION_HEADER: HeaderName = HeaderName::from_static("x-raven-integration");
const MAX_BODY_BYTES: usize = 16 * 1024;

#[derive(Clone)]
struct RouteState {
    calendar: GoogleCalendar,
    /// Loopback OAuth redirect URI; `Some` only on the UI listener.
    callback_uri: Option<String>,
}

/// `callback_uri` enables `POST /connect*` (UI listener only).
pub(crate) fn router<S>(runtime: GoogleCalendar, callback_uri: Option<String>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    let connect = callback_uri.is_some();
    let router = Router::new()
        .route("/", get(status).put(update))
        .route("/calendars", get(calendars))
        .route("/calendar", post(choose_calendar))
        .route("/preview", get(preview))
        .route("/sync", post(sync))
        .route("/disconnect", post(disconnect));
    let router = if connect {
        router
            .route("/connect", post(connect_start))
            .route("/connect/complete", post(connect_complete))
    } else {
        router
    };
    router.with_state(RouteState {
        calendar: runtime,
        callback_uri,
    })
}

impl From<GoogleCalendarError> for ApiError {
    fn from(error: GoogleCalendarError) -> Self {
        match error {
            GoogleCalendarError::NotConfigured => ApiError::google_calendar(
                "google_calendar_not_configured",
                "Google Calendar access is not set up.",
            ),
            GoogleCalendarError::NotConnected => ApiError::google_calendar(
                "google_calendar_not_connected",
                "Google Calendar is not connected.",
            ),
            GoogleCalendarError::ReauthRequired => ApiError::google_calendar(
                "google_calendar_reauth_required",
                "Google Calendar access must be reconnected.",
            ),
            GoogleCalendarError::SyncInProgress => ApiError::google_calendar(
                "google_calendar_sync_in_progress",
                "A Google Calendar sync is already in progress.",
            ),
            GoogleCalendarError::CalendarNotSelected => ApiError::google_calendar(
                "google_calendar_calendar_not_selected",
                "No Google calendar is selected.",
            ),
            GoogleCalendarError::Upstream(_) => ApiError::upstream_unavailable(),
            GoogleCalendarError::Validation { field } => ApiError::validation(Some(field)),
            GoogleCalendarError::Storage(_) | GoogleCalendarError::TodoUnavailable => {
                ApiError::internal(anyhow::anyhow!("google calendar failure"))
            }
        }
    }
}

fn respond<T: serde::Serialize>(result: Result<T, GoogleCalendarError>) -> Response {
    match result {
        Ok(value) => no_store(Json(value).into_response()),
        Err(error) => no_store(ApiError::from(error).into_response()),
    }
}

/// Exact Origin (UI authority, else `http://<Host>`) and the integration header.
fn guard(origin: Option<Extension<ResolvedUiOrigin>>, headers: &HeaderMap) -> Option<Response> {
    let expected = match origin {
        Some(Extension(ResolvedUiOrigin(expected))) => Some(expected.as_bytes().to_vec()),
        None => {
            single_header(headers, header::HOST).map(|host| [b"http://".as_slice(), host].concat())
        }
    };
    let exact_origin = expected
        .is_some_and(|expected| single_header(headers, header::ORIGIN) == Some(&expected[..]));
    if !exact_origin || single_header(headers, INTEGRATION_HEADER) != Some(b"1") {
        return Some(no_store(ApiError::forbidden().into_response()));
    }
    None
}

/// Empty body = `{}`; unknown fields are rejected.
fn parse<T: DeserializeOwned>(body: &Bytes) -> Result<T, ApiError> {
    let body: &[u8] = if body.iter().all(u8::is_ascii_whitespace) {
        b"{}"
    } else {
        body
    };
    if body.len() > MAX_BODY_BYTES {
        return Err(ApiError::payload_too_large());
    }
    serde_json::from_slice(body).map_err(|_| ApiError::validation(None))
}

macro_rules! guarded {
    ($origin:expr, $headers:expr, $body:expr, $ty:ty) => {{
        if let Some(response) = guard($origin, &$headers) {
            return response;
        }
        match parse::<$ty>(&$body) {
            Ok(request) => request,
            Err(error) => return no_store(error.into_response()),
        }
    }};
}

async fn status(State(state): State<RouteState>) -> Response {
    respond(state.calendar.status())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateRequest {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    sync_note: Option<bool>,
    #[serde(default)]
    poll_interval_secs: Option<u64>,
    #[serde(default)]
    default_duration_minutes: Option<u32>,
}

async fn update(
    State(state): State<RouteState>,
    origin: Option<Extension<ResolvedUiOrigin>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let request = guarded!(origin, headers, body, UpdateRequest);
    respond(state.calendar.update_settings(SettingsUpdate {
        enabled: request.enabled,
        poll_interval_secs: request.poll_interval_secs,
        default_duration_minutes: request.default_duration_minutes,
        sync_note: request.sync_note,
    }))
}

async fn calendars(State(state): State<RouteState>) -> Response {
    respond(state.calendar.list_calendars().await)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateCalendar {
    summary: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CalendarRequest {
    #[serde(default)]
    select: Option<String>,
    #[serde(default)]
    create: Option<CreateCalendar>,
}

async fn choose_calendar(
    State(state): State<RouteState>,
    origin: Option<Extension<ResolvedUiOrigin>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let request = guarded!(origin, headers, body, CalendarRequest);
    match (request.select, request.create) {
        (Some(id), None) => respond(state.calendar.select_calendar(&id).await),
        (None, Some(create)) => respond(state.calendar.create_calendar(&create.summary).await),
        _ => no_store(ApiError::validation(Some("calendar")).into_response()),
    }
}

async fn preview(State(state): State<RouteState>) -> Response {
    respond(state.calendar.preview().await)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SyncRequest {
    #[serde(default)]
    dry_run: bool,
    #[serde(default)]
    allow_mass_delete: bool,
}

async fn sync(
    State(state): State<RouteState>,
    origin: Option<Extension<ResolvedUiOrigin>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let request = guarded!(origin, headers, body, SyncRequest);
    respond(
        state
            .calendar
            .sync(
                Trigger::Api,
                SyncOptions {
                    dry_run: request.dry_run,
                    allow_mass_delete: request.allow_mass_delete,
                },
            )
            .await,
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DisconnectRequest {
    #[serde(default)]
    forget_links: bool,
}

async fn disconnect(
    State(state): State<RouteState>,
    origin: Option<Extension<ResolvedUiOrigin>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let request = guarded!(origin, headers, body, DisconnectRequest);
    respond(state.calendar.disconnect(request.forget_links).await)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConnectRequest {}

async fn connect_start(
    State(state): State<RouteState>,
    origin: Option<Extension<ResolvedUiOrigin>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let ConnectRequest {} = guarded!(origin, headers, body, ConnectRequest);
    let Some(callback) = state.callback_uri.as_deref() else {
        return no_store(ApiError::not_found().into_response());
    };
    respond(state.calendar.begin_connect(callback))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteRequest {
    redirect_url: String,
}

async fn connect_complete(
    State(state): State<RouteState>,
    origin: Option<Extension<ResolvedUiOrigin>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let request = guarded!(origin, headers, body, CompleteRequest);
    respond(
        state
            .calendar
            .complete_connect_url(&request.redirect_url)
            .await,
    )
}

/// `GET /__raven/google-calendar/callback`: unauthenticated (single-use `state`
/// only); answers a no-store page linking back to the UI.
pub(crate) async fn callback(calendar: GoogleCalendar, uri: Uri) -> Response {
    let result = match parse_callback_query(uri.query().unwrap_or_default()) {
        Ok((state, code)) => calendar.complete_connect(&state, &code).await.map(|_| ()),
        Err(error) => Err(error),
    };
    let (status, outcome, text) = match result {
        Ok(()) => (
            StatusCode::OK,
            "connected",
            "Google Calendar is connected. You can return to Raven.",
        ),
        Err(_) => (
            StatusCode::BAD_REQUEST,
            "error",
            "Google Calendar could not be connected. Return to Raven and try again.",
        ),
    };
    let page = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Raven</title></head>\
         <body><p>{text}</p><p><a href=\"/?google_calendar={outcome}\">Return to Raven</a></p>\
         </body></html>"
    );
    let mut response = Response::new(Body::from(page));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'"),
    );
    no_store(response)
}

fn single_header(headers: &HeaderMap, name: HeaderName) -> Option<&[u8]> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    values.next().is_none().then_some(value.as_bytes())
}

fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests;
