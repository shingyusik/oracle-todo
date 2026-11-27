//! Shared Google Calendar runtime: one per process, cloned into routes, the scheduler
//! and the CLI. Holds the injectable Google clients, the in-memory access token and the
//! pending OAuth `state` values.

use std::ffi::OsString;
use std::fmt;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};

use super::client::{CalendarApi, GoogleApiError, GoogleCalendarHttp};
use super::oauth::{
    AccessToken, GoogleOAuthHttp, OAuthApi, OAuthClient, Pkce, SCOPES, authorization_url,
    generate_state,
};
use super::secret::Secret;
use super::storage::{
    self, ConnectionState, GoogleCalendarPaths, GoogleCalendarSettings, LastSync, SettingsUpdate,
    StorageError, StoredToken, SyncDb,
};

/// Value of `RAVEN_GOOGLE_CALENDAR` that disables the scheduler (manual syncs still run).
pub const ENV_KILL_SWITCH: &str = "RAVEN_GOOGLE_CALENDAR";
/// Path of the OAuth loopback callback on the UI listener.
pub const CALLBACK_PATH: &str = "/__raven/google-calendar/callback";
/// Access tokens are refreshed this long before they expire.
pub const TOKEN_REFRESH_MARGIN: Duration = Duration::from_secs(60);
/// Lifetime of a pending OAuth `state`.
pub const CONNECT_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_PENDING_CONNECTS: usize = 16;
/// Attempts per Google call while rate limited.
pub const MAX_RATE_LIMIT_ATTEMPTS: u32 = 3;
const MAX_BACKOFF: Duration = Duration::from_secs(60);
const MAX_CALENDAR_SUMMARY_CHARS: usize = 255;

pub(crate) const LOG_TARGET: &str = "raven_api";

pub type Clock = Arc<dyn Fn() -> OffsetDateTime + Send + Sync>;
pub type Monotonic = Arc<dyn Fn() -> Instant + Send + Sync>;
pub type SleepFuture = Pin<Box<dyn Future<Output = ()> + Send>>;
pub type Sleeper = Arc<dyn Fn(Duration) -> SleepFuture + Send + Sync>;

/// Failures surfaced to adapters. Messages never contain tokens, ids, titles or paths.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GoogleCalendarError {
    #[error("Google OAuth client is not configured")]
    NotConfigured,
    #[error("Google Calendar is not connected")]
    NotConnected,
    #[error("Google Calendar access must be reconnected")]
    ReauthRequired,
    #[error("a Google Calendar sync is already in progress")]
    SyncInProgress,
    #[error("no Google calendar is selected")]
    CalendarNotSelected,
    #[error("Google Calendar is unavailable")]
    Upstream(GoogleApiError),
    #[error("Google Calendar storage failed")]
    Storage(StorageError),
    #[error("invalid Google Calendar input")]
    Validation { field: &'static str },
    #[error("the ToDo store is unavailable")]
    TodoUnavailable,
}

impl GoogleCalendarError {
    /// Stable snake_case kind for logs and CLI errors.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::NotConfigured => "not_configured",
            Self::NotConnected => "not_connected",
            Self::ReauthRequired => "reauth_required",
            Self::SyncInProgress => "sync_in_progress",
            Self::CalendarNotSelected => "calendar_not_selected",
            Self::Upstream(_) => "upstream_unavailable",
            Self::Storage(error) => error.kind(),
            Self::Validation { .. } => "validation",
            Self::TodoUnavailable => "todo_unavailable",
        }
    }
}

impl From<StorageError> for GoogleCalendarError {
    fn from(error: StorageError) -> Self {
        match error {
            StorageError::Validation { field } => Self::Validation { field },
            other => Self::Storage(other),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    Scheduled,
    Api,
    Cli,
}

impl Trigger {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Scheduled => "scheduled",
            Self::Api => "api",
            Self::Cli => "cli",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SyncOptions {
    pub dry_run: bool,
    pub allow_mass_delete: bool,
}

/// `GET /api/v1/integrations/google-calendar`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GoogleCalendarStatus {
    pub configured: bool,
    pub connection: &'static str,
    pub scopes: Vec<String>,
    pub calendar: Option<CalendarRef>,
    pub settings: SettingsView,
    pub env_override: Option<&'static str>,
    pub schedule: ScheduleView,
    pub first_sync_pending: bool,
    pub last_sync: Option<LastSync>,
    pub links: LinksView,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CalendarRef {
    pub id: String,
    pub summary: Option<String>,
    /// Unknown without asking Google; `null` in the status document.
    pub time_zone: Option<String>,
    pub primary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SettingsView {
    pub enabled: bool,
    pub calendar_id: Option<String>,
    pub calendar_summary: Option<String>,
    pub time_zone: String,
    pub poll_interval_secs: u64,
    pub default_duration_minutes: u32,
    pub sync_note: bool,
    pub push_since: Option<String>,
}

impl From<&GoogleCalendarSettings> for SettingsView {
    fn from(settings: &GoogleCalendarSettings) -> Self {
        Self {
            enabled: settings.enabled,
            calendar_id: settings.calendar_id.clone(),
            calendar_summary: settings.calendar_summary.clone(),
            time_zone: settings.time_zone.clone(),
            poll_interval_secs: settings.poll_interval_secs,
            default_duration_minutes: settings.default_duration_minutes,
            sync_note: settings.sync_note,
            push_since: settings.push_since.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ScheduleView {
    pub scheduler_active: bool,
    pub next_run_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct LinksView {
    pub total: u64,
    pub error: u64,
}

/// One writable calendar of the connected account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CalendarEntry {
    pub id: String,
    pub summary: String,
    pub primary: bool,
    pub access_role: String,
    pub time_zone: Option<String>,
}

/// `GET /calendars`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CalendarList {
    pub calendars: Vec<CalendarEntry>,
}

/// `POST /connect`.
#[derive(Clone, Serialize)]
pub struct ConnectStart {
    pub authorization_url: String,
    pub expires_at: String,
}

impl fmt::Debug for ConnectStart {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConnectStart")
            .field("authorization_url", &"<redacted>")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

/// `GET /preview`: planned counts of a dry run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SyncPreview {
    pub counts: super::reconcile::SyncCounts,
    pub guard_tripped: bool,
    pub first_sync: bool,
}

/// `POST /sync`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SyncReport {
    pub dry_run: bool,
    pub last_sync: Option<LastSync>,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct SchedulerStatus {
    pub active: bool,
    pub next_check_at: Option<OffsetDateTime>,
}

struct CachedAccess {
    token: AccessToken,
    expires_at: Instant,
}

struct PendingConnect {
    state: Secret,
    verifier: Secret,
    redirect_uri: String,
    expires_at: Instant,
}

/// Shared runtime handle (cheap to clone).
#[derive(Clone)]
pub struct GoogleCalendar {
    pub(crate) inner: Arc<Inner>,
}

pub(crate) struct Inner {
    pub paths: GoogleCalendarPaths,
    pub todo_db: PathBuf,
    pub local_offset: UtcOffset,
    pub env_disabled: bool,
    pub oauth_client_env: Option<OsString>,
    pub clock: Clock,
    pub monotonic: Monotonic,
    pub sleeper: Sleeper,
    pub api: Arc<dyn CalendarApi>,
    pub oauth: Arc<dyn OAuthApi>,
    access: tokio::sync::Mutex<Option<CachedAccess>>,
    pending: Mutex<Vec<PendingConnect>>,
    scheduler: Mutex<SchedulerStatus>,
}

impl fmt::Debug for GoogleCalendar {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("GoogleCalendar(<redacted>)")
    }
}

pub struct GoogleCalendarBuilder {
    paths: GoogleCalendarPaths,
    todo_db: PathBuf,
    local_offset: UtcOffset,
    env_disabled: bool,
    oauth_client_env: Option<OsString>,
    clock: Clock,
    monotonic: Monotonic,
    sleeper: Sleeper,
    api: Option<Arc<dyn CalendarApi>>,
    oauth: Option<Arc<dyn OAuthApi>>,
}

impl GoogleCalendarBuilder {
    pub fn api(mut self, api: Arc<dyn CalendarApi>) -> Self {
        self.api = Some(api);
        self
    }

    pub fn oauth(mut self, oauth: Arc<dyn OAuthApi>) -> Self {
        self.oauth = Some(oauth);
        self
    }

    pub fn clock(mut self, clock: Clock) -> Self {
        self.clock = clock;
        self
    }

    pub fn monotonic(mut self, monotonic: Monotonic) -> Self {
        self.monotonic = monotonic;
        self
    }

    /// Replaces the rate-limit backoff sleep (tests).
    pub fn sleeper(mut self, sleeper: Sleeper) -> Self {
        self.sleeper = sleeper;
        self
    }

    /// Overrides the `RAVEN_GOOGLE_CALENDAR=off` kill switch read from the environment.
    pub fn env_disabled(mut self, disabled: bool) -> Self {
        self.env_disabled = disabled;
        self
    }

    /// Overrides `RAVEN_GOOGLE_OAUTH_CLIENT_FILE` read from the environment.
    pub fn oauth_client_env(mut self, value: Option<OsString>) -> Self {
        self.oauth_client_env = value;
        self
    }

    /// Builds the runtime. Real Google clients (honoring the test-only loopback
    /// `RAVEN_GOOGLE_API_URL`) are used unless injected.
    pub fn build(self) -> anyhow::Result<GoogleCalendar> {
        let api_url = std::env::var(super::client::GOOGLE_API_URL_ENV).ok();
        let api: Arc<dyn CalendarApi> = match self.api {
            Some(api) => api,
            None => Arc::new(GoogleCalendarHttp::from_env(api_url.clone())?),
        };
        let oauth: Arc<dyn OAuthApi> = match self.oauth {
            Some(oauth) => oauth,
            None => Arc::new(GoogleOAuthHttp::from_env(api_url)?),
        };
        Ok(GoogleCalendar {
            inner: Arc::new(Inner {
                paths: self.paths,
                todo_db: self.todo_db,
                local_offset: self.local_offset,
                env_disabled: self.env_disabled,
                oauth_client_env: self.oauth_client_env,
                clock: self.clock,
                monotonic: self.monotonic,
                sleeper: self.sleeper,
                api,
                oauth,
                access: tokio::sync::Mutex::new(None),
                pending: Mutex::new(Vec::new()),
                scheduler: Mutex::new(SchedulerStatus::default()),
            }),
        })
    }
}

/// True when `RAVEN_GOOGLE_CALENDAR` is exactly `off`.
pub fn env_kill_switch() -> bool {
    std::env::var_os(ENV_KILL_SWITCH).is_some_and(|value| value == "off")
}

pub(crate) fn format_instant(at: OffsetDateTime) -> String {
    at.format(&Rfc3339).unwrap_or_default()
}

pub(crate) fn parse_instant(text: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(text, &Rfc3339).ok()
}

impl GoogleCalendar {
    /// `home` is the Raven home; `todo_db` the ToDo store synced with Google.
    pub fn builder(
        home: impl Into<PathBuf>,
        todo_db: impl Into<PathBuf>,
        local_offset: UtcOffset,
    ) -> GoogleCalendarBuilder {
        GoogleCalendarBuilder {
            paths: GoogleCalendarPaths::new(home),
            todo_db: todo_db.into(),
            local_offset,
            env_disabled: env_kill_switch(),
            oauth_client_env: std::env::var_os(storage::OAUTH_CLIENT_FILE_ENV),
            clock: Arc::new(OffsetDateTime::now_utc),
            monotonic: Arc::new(Instant::now),
            sleeper: Arc::new(|duration| Box::pin(tokio::time::sleep(duration))),
            api: None,
            oauth: None,
        }
    }

    /// Runtime for the stores of `config` (the home is the parent of `todo.sqlite`).
    pub fn from_config(config: &crate::RavenApiConfig) -> anyhow::Result<Self> {
        let home = config
            .todo_db
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        Self::builder(home, config.todo_db.clone(), config.local_offset).build()
    }

    pub fn paths(&self) -> &GoogleCalendarPaths {
        &self.inner.paths
    }

    pub(crate) fn now(&self) -> OffsetDateTime {
        (self.inner.clock)()
    }

    pub fn env_disabled(&self) -> bool {
        self.inner.env_disabled
    }

    // -----------------------------------------------------------------------------
    // Configuration and status

    /// The OAuth client (`oauth-client.json` or `RAVEN_GOOGLE_OAUTH_CLIENT_FILE`).
    pub fn oauth_client(&self) -> Result<Option<OAuthClient>, GoogleCalendarError> {
        let path = self
            .paths()
            .oauth_client_source(self.inner.oauth_client_env.as_deref());
        Ok(storage::load_oauth_client(&path)?)
    }

    fn require_client(&self) -> Result<OAuthClient, GoogleCalendarError> {
        self.oauth_client()?
            .ok_or(GoogleCalendarError::NotConfigured)
    }

    /// `client set --file`: validates and stores the Desktop-app client.
    pub fn set_oauth_client(
        &self,
        source: &std::path::Path,
    ) -> Result<String, GoogleCalendarError> {
        Ok(storage::import_oauth_client(self.paths(), source)?.client_id)
    }

    pub fn settings(&self) -> Result<GoogleCalendarSettings, GoogleCalendarError> {
        Ok(storage::load_settings(self.paths())?)
    }

    pub fn update_settings(
        &self,
        update: SettingsUpdate,
    ) -> Result<GoogleCalendarStatus, GoogleCalendarError> {
        storage::update_settings(self.paths(), update)?;
        self.status()
    }

    /// Connection as reported: `connected` without a token file reads as disconnected.
    fn connection(&self) -> Result<(ConnectionState, Option<StoredToken>), GoogleCalendarError> {
        let state = storage::load_state(self.paths())?;
        let token = storage::load_token(self.paths())?;
        let connection = match (state.connection, &token) {
            (ConnectionState::Disconnected, _) | (_, None) => ConnectionState::Disconnected,
            (connection, Some(_)) => connection,
        };
        Ok((connection, token))
    }

    /// The status document. Never contacts Google and never creates files.
    pub fn status(&self) -> Result<GoogleCalendarStatus, GoogleCalendarError> {
        let settings = self.settings()?;
        let state = storage::load_state(self.paths())?;
        let (connection, token) = self.connection()?;
        let configured = self.oauth_client().is_ok_and(|client| client.is_some());
        let links = match settings.calendar_id.as_deref() {
            Some(calendar_id) => match SyncDb::open_existing(self.paths())? {
                Some(db) => {
                    let counts = db.repo().link_counts(calendar_id)?;
                    LinksView {
                        total: counts.total,
                        error: counts.error,
                    }
                }
                None => LinksView::default(),
            },
            None => LinksView::default(),
        };
        let scheduler = *self
            .inner
            .scheduler
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let runnable = self.scheduler_gate(&settings, &state, connection).is_ok();
        let next_run_at = (scheduler.active && runnable)
            .then_some(scheduler.next_check_at)
            .flatten()
            .map(format_instant);
        Ok(GoogleCalendarStatus {
            configured,
            connection: connection.as_str(),
            scopes: token.map(|token| token.scopes).unwrap_or_default(),
            calendar: settings.calendar_id.clone().map(|id| CalendarRef {
                primary: id == "primary",
                id,
                summary: settings.calendar_summary.clone(),
                time_zone: None,
            }),
            env_override: self.env_disabled().then_some("disabled"),
            schedule: ScheduleView {
                scheduler_active: scheduler.active,
                next_run_at,
            },
            first_sync_pending: settings.calendar_id.is_some()
                && state.first_sync_completed_at.is_none(),
            last_sync: state.last_sync,
            links,
            settings: SettingsView::from(&settings),
        })
    }

    pub(crate) fn set_scheduler(&self, status: SchedulerStatus) {
        *self
            .inner
            .scheduler
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = status;
    }

    // -----------------------------------------------------------------------------
    // Access tokens

    /// A valid access token, refreshed 60 s before expiry (monotonic clock).
    /// `invalid_grant` marks the connection `reauth_required`.
    pub(crate) async fn access_token(&self) -> Result<AccessToken, GoogleCalendarError> {
        let mut cached = self.inner.access.lock().await;
        let now = (self.inner.monotonic)();
        if let Some(access) = cached.as_ref()
            && now + TOKEN_REFRESH_MARGIN < access.expires_at
        {
            return Ok(access.token.clone());
        }
        *cached = None;
        let (connection, token) = self.connection()?;
        let token = match (connection, token) {
            (ConnectionState::ReauthRequired, _) => {
                return Err(GoogleCalendarError::ReauthRequired);
            }
            (ConnectionState::Connected, Some(token)) => token,
            _ => return Err(GoogleCalendarError::NotConnected),
        };
        let client = self.require_client()?;
        let refresh = Secret::new(token.refresh_token());
        match self.inner.oauth.refresh(&client, &refresh).await {
            Ok(grant) => {
                let token = grant.access_token.clone();
                *cached = Some(CachedAccess {
                    token: grant.access_token,
                    expires_at: now + grant.expires_in,
                });
                Ok(token)
            }
            Err(GoogleApiError::InvalidGrant) => {
                log_auth_failed("invalid_grant");
                self.mark_reauth_required()?;
                Err(GoogleCalendarError::ReauthRequired)
            }
            Err(error) => {
                log_auth_failed(error.kind());
                Err(GoogleCalendarError::Upstream(error))
            }
        }
    }

    /// Drops the cached access token (after a 401).
    pub(crate) async fn invalidate_access(&self) {
        *self.inner.access.lock().await = None;
    }

    fn mark_reauth_required(&self) -> Result<(), GoogleCalendarError> {
        let mut state = storage::load_state(self.paths())?;
        state.connection = ConnectionState::ReauthRequired;
        storage::save_state(self.paths(), &state)?;
        Ok(())
    }

    /// Backoff before retrying a rate-limited call (`None` = give up). Honors
    /// `Retry-After`, else 1 s, 2 s, 4 s; capped at 60 s.
    pub(crate) async fn rate_limit_backoff(
        &self,
        operation: &'static str,
        attempt: u32,
        retry_after: Option<Duration>,
    ) -> bool {
        if attempt >= MAX_RATE_LIMIT_ATTEMPTS {
            return false;
        }
        let backoff = retry_after
            .unwrap_or_else(|| Duration::from_secs(1 << (attempt - 1).min(5)))
            .min(MAX_BACKOFF);
        tracing::info!(
            target: LOG_TARGET,
            event = "google_calendar_api_retry",
            operation,
            status = "rate_limited",
            attempt,
            backoff_ms = backoff.as_millis() as u64,
            "google calendar request rate limited"
        );
        (self.inner.sleeper)(backoff).await;
        true
    }

    // -----------------------------------------------------------------------------
    // Calendars

    /// Writable calendars of the connected account.
    pub async fn list_calendars(&self) -> Result<CalendarList, GoogleCalendarError> {
        self.require_client()?;
        let entries = google_call!(self, "list_calendars", |api, at| api.list_calendars(at))?;
        Ok(CalendarList {
            calendars: entries
                .into_iter()
                .filter(|entry| entry.writable())
                .map(|entry| CalendarEntry {
                    summary: entry.summary.unwrap_or_default(),
                    id: entry.id,
                    primary: entry.primary,
                    access_role: entry.access_role,
                    time_zone: entry.time_zone,
                })
                .collect(),
        })
    }

    /// Selects an existing writable calendar.
    pub async fn select_calendar(
        &self,
        calendar_id: &str,
    ) -> Result<GoogleCalendarStatus, GoogleCalendarError> {
        let calendar_id = calendar_id.trim();
        if calendar_id.is_empty() || calendar_id.chars().count() > 1024 {
            return Err(GoogleCalendarError::Validation { field: "select" });
        }
        let calendars = self.list_calendars().await?;
        let entry = calendars
            .calendars
            .into_iter()
            .find(|entry| entry.id == calendar_id)
            .ok_or(GoogleCalendarError::Validation { field: "select" })?;
        self.use_calendar(entry.id, Some(entry.summary))
    }

    /// Creates a dedicated calendar (scope `calendar.app.created`) and selects it.
    pub async fn create_calendar(
        &self,
        summary: &str,
    ) -> Result<GoogleCalendarStatus, GoogleCalendarError> {
        let summary = summary.trim().to_owned();
        if summary.is_empty() || summary.chars().count() > MAX_CALENDAR_SUMMARY_CHARS {
            return Err(GoogleCalendarError::Validation { field: "summary" });
        }
        self.require_client()?;
        let time_zone = self.settings()?.time_zone;
        let calendar = google_call!(self, "insert_calendar", |api, at| api
            .insert_calendar(at, &summary, &time_zone))?;
        let summary = calendar.summary.unwrap_or(summary);
        self.use_calendar(calendar.id, Some(summary))
    }

    /// Switching calendars unlinks the old one (its Google events are left alone) and
    /// makes the next pass a first sync.
    fn use_calendar(
        &self,
        calendar_id: String,
        summary: Option<String>,
    ) -> Result<GoogleCalendarStatus, GoogleCalendarError> {
        let _lock = storage::try_lock(self.paths())?.ok_or(GoogleCalendarError::SyncInProgress)?;
        let mut settings = self.settings()?;
        if settings.calendar_id.as_deref() != Some(calendar_id.as_str()) {
            if let Some(old) = settings.calendar_id.as_deref()
                && let Some(db) = SyncDb::open_existing(self.paths())?
            {
                db.repo().forget_calendar(old)?;
            }
            if let Some(db) = SyncDb::open_existing(self.paths())? {
                // A calendar selected again later starts from a clean first sync.
                db.repo().forget_calendar(&calendar_id)?;
            }
            let mut state = storage::load_state(self.paths())?;
            state.first_sync_completed_at = None;
            storage::save_state(self.paths(), &state)?;
            settings.push_since = None;
        }
        settings.calendar_id = Some(calendar_id);
        settings.calendar_summary = summary;
        storage::save_settings(self.paths(), &settings)?;
        self.status()
    }

    // -----------------------------------------------------------------------------
    // Connect / disconnect

    /// Starts an OAuth authorization (PKCE S256, single-use state valid for 10 minutes).
    pub fn begin_connect(&self, redirect_uri: &str) -> Result<ConnectStart, GoogleCalendarError> {
        let client = self.require_client()?;
        let pkce = Pkce::generate().map_err(|_| GoogleCalendarError::Storage(StorageError::Io))?;
        let state = generate_state().map_err(|_| GoogleCalendarError::Storage(StorageError::Io))?;
        let url = authorization_url(&client, redirect_uri, &SCOPES, &state, &pkce.challenge);
        let now = (self.inner.monotonic)();
        let mut pending = self
            .inner
            .pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        pending.retain(|entry| entry.expires_at > now);
        if pending.len() >= MAX_PENDING_CONNECTS {
            pending.remove(0);
        }
        pending.push(PendingConnect {
            state,
            verifier: pkce.verifier,
            redirect_uri: redirect_uri.to_owned(),
            expires_at: now + CONNECT_TTL,
        });
        let ttl = time::Duration::try_from(CONNECT_TTL).unwrap_or(time::Duration::minutes(10));
        Ok(ConnectStart {
            authorization_url: url,
            expires_at: format_instant(self.now() + ttl),
        })
    }

    /// Finishes an authorization with the `state` and `code` Google redirected with.
    /// The state is consumed even when the exchange fails.
    pub async fn complete_connect(
        &self,
        state: &Secret,
        code: &Secret,
    ) -> Result<GoogleCalendarStatus, GoogleCalendarError> {
        let pending = self.take_pending(state)?;
        if code.is_empty() || code.expose().len() > 4096 {
            return Err(GoogleCalendarError::Validation { field: "code" });
        }
        let client = self.require_client()?;
        let grant = self
            .inner
            .oauth
            .exchange_code(&client, code, &pending.verifier, &pending.redirect_uri)
            .await
            .map_err(|error| {
                log_auth_failed(error.kind());
                GoogleCalendarError::Upstream(error)
            })?;
        let now = self.now();
        let scopes = if grant.access.scopes.is_empty() {
            SCOPES.map(str::to_owned).to_vec()
        } else {
            grant.access.scopes.clone()
        };
        storage::save_token(
            self.paths(),
            &StoredToken::new(
                grant.refresh_token.expose(),
                scopes.clone(),
                format_instant(now),
            ),
        )?;
        let mut sync_state = storage::load_state(self.paths())?;
        sync_state.connection = ConnectionState::Connected;
        sync_state.connected_at = Some(format_instant(now));
        storage::save_state(self.paths(), &sync_state)?;
        *self.inner.access.lock().await = Some(CachedAccess {
            token: grant.access.access_token.clone(),
            expires_at: (self.inner.monotonic)() + grant.access.expires_in,
        });
        tracing::info!(
            target: LOG_TARGET,
            event = "google_calendar_connected",
            scopes = %scopes.join(" "),
            "google calendar connected"
        );
        self.status()
    }

    /// Completes from a pasted/redirected URL (`?state=..&code=..` or `?error=..`).
    pub async fn complete_connect_url(
        &self,
        redirect_url: &str,
    ) -> Result<GoogleCalendarStatus, GoogleCalendarError> {
        let query = redirect_url
            .split_once('?')
            .map(|(_, query)| query.split('#').next().unwrap_or_default())
            .ok_or(GoogleCalendarError::Validation {
                field: "redirect_url",
            })?;
        let (state, code) = parse_callback_query(query)?;
        self.complete_connect(&state, &code).await
    }

    fn take_pending(&self, state: &Secret) -> Result<PendingConnect, GoogleCalendarError> {
        let now = (self.inner.monotonic)();
        let mut pending = self
            .inner
            .pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let position = pending
            .iter()
            .position(|entry| entry.state.ct_eq(state))
            .ok_or(GoogleCalendarError::Validation { field: "state" })?;
        let entry = pending.remove(position);
        if entry.expires_at <= now {
            return Err(GoogleCalendarError::Validation { field: "state" });
        }
        Ok(entry)
    }

    /// Revokes and deletes the refresh token. Settings and links are kept unless
    /// `forget_links` (which deletes `sync.sqlite` and restarts first-sync rules).
    pub async fn disconnect(
        &self,
        forget_links: bool,
    ) -> Result<GoogleCalendarStatus, GoogleCalendarError> {
        let _lock = storage::try_lock(self.paths())?.ok_or(GoogleCalendarError::SyncInProgress)?;
        let token = storage::load_token(self.paths()).ok().flatten();
        let revoked = match &token {
            Some(token) => self
                .inner
                .oauth
                .revoke(&Secret::new(token.refresh_token()))
                .await
                .is_ok(),
            None => false,
        };
        storage::delete_token(self.paths())?;
        *self.inner.access.lock().await = None;
        let mut state = storage::load_state(self.paths())?;
        state.connection = ConnectionState::Disconnected;
        state.connected_at = None;
        if forget_links {
            storage::delete_sync_db(self.paths())?;
            state.first_sync_completed_at = None;
            let mut settings = self.settings()?;
            if settings.push_since.is_some() {
                settings.push_since = None;
                storage::save_settings(self.paths(), &settings)?;
            }
        }
        storage::save_state(self.paths(), &state)?;
        tracing::info!(
            target: LOG_TARGET,
            event = "google_calendar_disconnected",
            revoked,
            "google calendar disconnected"
        );
        self.status()
    }

    /// Scheduler gate: enabled, connected, calendar selected and first sync done.
    pub(crate) fn scheduler_gate(
        &self,
        settings: &GoogleCalendarSettings,
        state: &storage::SyncState,
        connection: ConnectionState,
    ) -> Result<(), &'static str> {
        if self.env_disabled() {
            return Err("env_disabled");
        }
        if !settings.enabled {
            return Err("disabled");
        }
        match connection {
            ConnectionState::Disconnected => return Err("not_connected"),
            ConnectionState::ReauthRequired => return Err("reauth_required"),
            ConnectionState::Connected => {}
        }
        if settings.calendar_id.is_none() {
            return Err("calendar_not_selected");
        }
        if state.first_sync_completed_at.is_none() {
            return Err("first_sync_pending");
        }
        Ok(())
    }

    pub(crate) fn connection_state(&self) -> Result<ConnectionState, GoogleCalendarError> {
        Ok(self.connection()?.0)
    }
}

/// `state` and `code` from a callback query; `error=..` and missing values fail.
pub fn parse_callback_query(query: &str) -> Result<(Secret, Secret), GoogleCalendarError> {
    let mut state = None;
    let mut code = None;
    for (key, value) in url_pairs(query) {
        match key.as_str() {
            "error" => return Err(GoogleCalendarError::Validation { field: "code" }),
            "state" if state.is_none() => state = Some(Secret::new(value)),
            "code" if code.is_none() => code = Some(Secret::new(value)),
            _ => {}
        }
    }
    let state = state
        .filter(|state| !state.is_empty())
        .ok_or(GoogleCalendarError::Validation { field: "state" })?;
    let code = code
        .filter(|code| !code.is_empty())
        .ok_or(GoogleCalendarError::Validation { field: "code" })?;
    Ok((state, code))
}

fn url_pairs(query: &str) -> Vec<(String, String)> {
    reqwest::Url::parse(&format!("http://localhost/?{query}"))
        .map(|url| {
            url.query_pairs()
                .map(|(key, value)| (key.into_owned(), value.into_owned()))
                .collect()
        })
        .unwrap_or_default()
}

fn log_auth_failed(error_kind: &'static str) {
    tracing::warn!(
        target: LOG_TARGET,
        event = "google_calendar_auth_failed",
        error_kind,
        "google calendar authorization failed"
    );
}
