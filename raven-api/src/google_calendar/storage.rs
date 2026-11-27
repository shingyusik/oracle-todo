//! Files under `$RAVEN_HOME/integrations/google-calendar/` (dir 0700, files 0600):
//! `settings.json`, `state.json`, `token.json`, `oauth-client.json`, `sync.sqlite`,
//! `sync.lock`. Reading never creates anything.

use std::fmt;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::mapping::{FieldHashes, parse_date};
use super::oauth::{OAuthClient, OAuthClientError};
use super::reconcile::{Link, LinkOrigin, LinkState, SyncCounts};
use crate::fsutil;

const VERSION: u32 = 1;
const SETTINGS_MAX_BYTES: u64 = 4 * 1024;
const STATE_MAX_BYTES: u64 = 64 * 1024;
const TOKEN_MAX_BYTES: u64 = 16 * 1024;
const OAUTH_CLIENT_MAX_BYTES: u64 = 64 * 1024;
const MAX_ID_CHARS: usize = 1024;
const MAX_TIME_ZONE_CHARS: usize = 64;
/// Schema version of `sync.sqlite`.
pub const SYNC_DB_VERSION: i64 = 1;
/// Poison events are retried at most this many times.
pub const PENDING_MAX_ATTEMPTS: i64 = 5;
pub const POLL_INTERVAL_RANGE: std::ops::RangeInclusive<u64> = 60..=3600;
pub const DEFAULT_DURATION_RANGE: std::ops::RangeInclusive<u32> = 1..=1440;
/// Env override for the OAuth client file location.
pub const OAUTH_CLIENT_FILE_ENV: &str = "RAVEN_GOOGLE_OAUTH_CLIENT_FILE";

/// Storage failures; messages never include paths, SQL or file contents.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StorageError {
    #[error("google calendar storage is unavailable")]
    Io,
    #[error("google calendar file is invalid")]
    Invalid,
    #[error("google calendar file is too large")]
    TooLarge,
    #[error("google calendar token file is readable by other users")]
    InsecurePermissions,
    #[error("google calendar file has an unsupported version")]
    UnsupportedVersion,
    #[error("google calendar sync database is unavailable")]
    Database,
    #[error("invalid google calendar setting: {field}")]
    Validation { field: &'static str },
}

impl StorageError {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Io => "storage_io",
            Self::Invalid => "storage_invalid",
            Self::TooLarge => "storage_too_large",
            Self::InsecurePermissions => "storage_insecure_permissions",
            Self::UnsupportedVersion => "storage_unsupported_version",
            Self::Database => "storage_database",
            Self::Validation { .. } => "validation",
        }
    }
}

fn io_error(error: io::Error) -> StorageError {
    if error.to_string() == "file too large" {
        StorageError::TooLarge
    } else {
        StorageError::Io
    }
}

fn db_error(_: rusqlite::Error) -> StorageError {
    StorageError::Database
}

/// Locations under the Raven home.
#[derive(Clone, PartialEq, Eq)]
pub struct GoogleCalendarPaths {
    pub home: PathBuf,
}

impl fmt::Debug for GoogleCalendarPaths {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("GoogleCalendarPaths(<redacted>)")
    }
}

impl GoogleCalendarPaths {
    pub fn new(home: impl Into<PathBuf>) -> Self {
        Self { home: home.into() }
    }

    pub fn dir(&self) -> PathBuf {
        self.home.join("integrations").join("google-calendar")
    }

    pub fn settings_file(&self) -> PathBuf {
        self.dir().join("settings.json")
    }

    pub fn state_file(&self) -> PathBuf {
        self.dir().join("state.json")
    }

    pub fn token_file(&self) -> PathBuf {
        self.dir().join("token.json")
    }

    pub fn oauth_client_file(&self) -> PathBuf {
        self.dir().join("oauth-client.json")
    }

    pub fn sync_db(&self) -> PathBuf {
        self.dir().join("sync.sqlite")
    }

    pub fn lock_file(&self) -> PathBuf {
        self.dir().join("sync.lock")
    }

    /// `RAVEN_GOOGLE_OAUTH_CLIENT_FILE` when set and non-empty, else `oauth-client.json`.
    pub fn oauth_client_source(&self, env_override: Option<&std::ffi::OsStr>) -> PathBuf {
        env_override
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.oauth_client_file())
    }
}

fn valid_id(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= MAX_ID_CHARS
}

fn valid_time_zone(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_TIME_ZONE_CHARS
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-' | '+'))
}

// ---------------------------------------------------------------------------
// settings.json

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleCalendarSettings {
    pub enabled: bool,
    pub calendar_id: Option<String>,
    pub calendar_summary: Option<String>,
    pub time_zone: String,
    pub poll_interval_secs: u64,
    pub default_duration_minutes: u32,
    pub sync_note: bool,
    /// First-sync window start (`YYYY-MM-DD`), set when the first sync completes.
    pub push_since: Option<String>,
}

impl Default for GoogleCalendarSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            calendar_id: None,
            calendar_summary: None,
            time_zone: "Asia/Seoul".to_owned(),
            poll_interval_secs: 120,
            default_duration_minutes: 60,
            sync_note: true,
            push_since: None,
        }
    }
}

impl GoogleCalendarSettings {
    pub fn validate(&self) -> Result<(), StorageError> {
        let invalid = |field| Err(StorageError::Validation { field });
        if self.calendar_id.as_deref().is_some_and(|id| !valid_id(id)) {
            return invalid("calendar_id");
        }
        if self
            .calendar_summary
            .as_deref()
            .is_some_and(|summary| summary.chars().count() > MAX_ID_CHARS)
        {
            return invalid("calendar_summary");
        }
        if !valid_time_zone(&self.time_zone) {
            return invalid("time_zone");
        }
        if !POLL_INTERVAL_RANGE.contains(&self.poll_interval_secs) {
            return invalid("poll_interval_secs");
        }
        if !DEFAULT_DURATION_RANGE.contains(&self.default_duration_minutes) {
            return invalid("default_duration_minutes");
        }
        if self
            .push_since
            .as_deref()
            .is_some_and(|day| parse_date(day).is_none())
        {
            return invalid("push_since");
        }
        Ok(())
    }

    /// `push_since` parsed.
    pub fn push_since_date(&self) -> Option<time::Date> {
        self.push_since.as_deref().and_then(parse_date)
    }
}

/// A partial user update; absent fields keep their value.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SettingsUpdate {
    pub enabled: Option<bool>,
    pub poll_interval_secs: Option<u64>,
    pub default_duration_minutes: Option<u32>,
    pub sync_note: Option<bool>,
}

impl SettingsUpdate {
    pub fn apply(self, current: &GoogleCalendarSettings) -> GoogleCalendarSettings {
        GoogleCalendarSettings {
            enabled: self.enabled.unwrap_or(current.enabled),
            poll_interval_secs: self
                .poll_interval_secs
                .unwrap_or(current.poll_interval_secs),
            default_duration_minutes: self
                .default_duration_minutes
                .unwrap_or(current.default_duration_minutes),
            sync_note: self.sync_note.unwrap_or(current.sync_note),
            ..current.clone()
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SettingsFile {
    version: u32,
    enabled: bool,
    calendar_id: Option<String>,
    calendar_summary: Option<String>,
    time_zone: String,
    poll_interval_secs: u64,
    default_duration_minutes: u32,
    sync_note: bool,
    push_since: Option<String>,
}

/// Missing file => defaults. Never creates anything.
pub fn load_settings(paths: &GoogleCalendarPaths) -> Result<GoogleCalendarSettings, StorageError> {
    let Some(bytes) =
        fsutil::read_optional(&paths.settings_file(), SETTINGS_MAX_BYTES).map_err(io_error)?
    else {
        return Ok(GoogleCalendarSettings::default());
    };
    let file: SettingsFile = serde_json::from_slice(&bytes).map_err(|_| StorageError::Invalid)?;
    if file.version != VERSION {
        return Err(StorageError::UnsupportedVersion);
    }
    let settings = GoogleCalendarSettings {
        enabled: file.enabled,
        calendar_id: file.calendar_id,
        calendar_summary: file.calendar_summary,
        time_zone: file.time_zone,
        poll_interval_secs: file.poll_interval_secs,
        default_duration_minutes: file.default_duration_minutes,
        sync_note: file.sync_note,
        push_since: file.push_since,
    };
    settings.validate().map_err(|_| StorageError::Invalid)?;
    Ok(settings)
}

pub fn save_settings(
    paths: &GoogleCalendarPaths,
    settings: &GoogleCalendarSettings,
) -> Result<(), StorageError> {
    settings.validate()?;
    let file = SettingsFile {
        version: VERSION,
        enabled: settings.enabled,
        calendar_id: settings.calendar_id.clone(),
        calendar_summary: settings.calendar_summary.clone(),
        time_zone: settings.time_zone.clone(),
        poll_interval_secs: settings.poll_interval_secs,
        default_duration_minutes: settings.default_duration_minutes,
        sync_note: settings.sync_note,
        push_since: settings.push_since.clone(),
    };
    let bytes = serde_json::to_vec_pretty(&file).map_err(|_| StorageError::Invalid)?;
    if bytes.len() as u64 > SETTINGS_MAX_BYTES {
        return Err(StorageError::TooLarge);
    }
    write_private(&paths.dir(), &paths.settings_file(), &bytes)
}

/// Loads, applies `update`, validates and saves.
pub fn update_settings(
    paths: &GoogleCalendarPaths,
    update: SettingsUpdate,
) -> Result<GoogleCalendarSettings, StorageError> {
    let next = update.apply(&load_settings(paths)?);
    next.validate()?;
    save_settings(paths, &next)?;
    Ok(next)
}

fn write_private(dir: &Path, path: &Path, bytes: &[u8]) -> Result<(), StorageError> {
    fsutil::ensure_private_dir(dir).map_err(|_| StorageError::Io)?;
    fsutil::write_atomic(path, bytes).map_err(|_| StorageError::Io)
}

// ---------------------------------------------------------------------------
// state.json

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    #[default]
    Disconnected,
    Connected,
    ReauthRequired,
}

impl ConnectionState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disconnected => "disconnected",
            Self::Connected => "connected",
            Self::ReauthRequired => "reauth_required",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LastSync {
    pub run_id: String,
    /// `scheduled|api|cli`
    pub trigger: String,
    pub started_at: String,
    pub finished_at: String,
    /// `ok|partial|failed|guard_tripped|reauth_required|nothing_to_do`
    pub outcome: String,
    pub counts: SyncCounts,
    pub error_kind: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncState {
    pub connection: ConnectionState,
    pub connected_at: Option<String>,
    pub first_sync_completed_at: Option<String>,
    pub last_sync: Option<LastSync>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StateFile {
    version: u32,
    connection: ConnectionState,
    connected_at: Option<String>,
    first_sync_completed_at: Option<String>,
    last_sync: Option<LastSync>,
}

/// Missing file => disconnected, never synced. Never creates anything.
pub fn load_state(paths: &GoogleCalendarPaths) -> Result<SyncState, StorageError> {
    let Some(bytes) =
        fsutil::read_optional(&paths.state_file(), STATE_MAX_BYTES).map_err(io_error)?
    else {
        return Ok(SyncState::default());
    };
    let file: StateFile = serde_json::from_slice(&bytes).map_err(|_| StorageError::Invalid)?;
    if file.version != VERSION {
        return Err(StorageError::UnsupportedVersion);
    }
    Ok(SyncState {
        connection: file.connection,
        connected_at: file.connected_at,
        first_sync_completed_at: file.first_sync_completed_at,
        last_sync: file.last_sync,
    })
}

pub fn save_state(paths: &GoogleCalendarPaths, state: &SyncState) -> Result<(), StorageError> {
    let file = StateFile {
        version: VERSION,
        connection: state.connection,
        connected_at: state.connected_at.clone(),
        first_sync_completed_at: state.first_sync_completed_at.clone(),
        last_sync: state.last_sync.clone(),
    };
    let bytes = serde_json::to_vec_pretty(&file).map_err(|_| StorageError::Invalid)?;
    if bytes.len() as u64 > STATE_MAX_BYTES {
        return Err(StorageError::TooLarge);
    }
    write_private(&paths.dir(), &paths.state_file(), &bytes)
}

// ---------------------------------------------------------------------------
// token.json

/// The stored refresh token. `Debug` never shows it.
#[derive(Clone, PartialEq, Eq)]
pub struct StoredToken {
    refresh_token: String,
    pub scopes: Vec<String>,
    pub obtained_at: String,
}

impl StoredToken {
    pub fn new(refresh_token: impl Into<String>, scopes: Vec<String>, obtained_at: String) -> Self {
        Self {
            refresh_token: refresh_token.into(),
            scopes,
            obtained_at,
        }
    }

    /// The raw refresh token. Never log or format it.
    pub fn refresh_token(&self) -> &str {
        &self.refresh_token
    }
}

impl fmt::Debug for StoredToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("StoredToken")
            .field("refresh_token", &"<redacted>")
            .field("scopes", &self.scopes)
            .field("obtained_at", &self.obtained_at)
            .finish()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TokenFile {
    version: u32,
    refresh_token: String,
    scopes: Vec<String>,
    obtained_at: String,
}

/// `Ok(None)` when absent. Refuses a token file readable by group/other or not owned
/// by the current user.
pub fn load_token(paths: &GoogleCalendarPaths) -> Result<Option<StoredToken>, StorageError> {
    let Some(bytes) = read_owner_only(&paths.token_file(), TOKEN_MAX_BYTES)? else {
        return Ok(None);
    };
    let file: TokenFile = serde_json::from_slice(&bytes).map_err(|_| StorageError::Invalid)?;
    if file.version != VERSION {
        return Err(StorageError::UnsupportedVersion);
    }
    if file.refresh_token.is_empty() {
        return Err(StorageError::Invalid);
    }
    Ok(Some(StoredToken {
        refresh_token: file.refresh_token,
        scopes: file.scopes,
        obtained_at: file.obtained_at,
    }))
}

pub fn save_token(paths: &GoogleCalendarPaths, token: &StoredToken) -> Result<(), StorageError> {
    if token.refresh_token.is_empty() {
        return Err(StorageError::Validation {
            field: "refresh_token",
        });
    }
    let file = TokenFile {
        version: VERSION,
        refresh_token: token.refresh_token.clone(),
        scopes: token.scopes.clone(),
        obtained_at: token.obtained_at.clone(),
    };
    let bytes = serde_json::to_vec(&file).map_err(|_| StorageError::Invalid)?;
    write_private(&paths.dir(), &paths.token_file(), &bytes)
}

/// Removes `token.json`; absent is fine.
pub fn delete_token(paths: &GoogleCalendarPaths) -> Result<(), StorageError> {
    remove_if_exists(&paths.token_file())
}

fn remove_if_exists(path: &Path) -> Result<(), StorageError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(StorageError::Io),
    }
}

fn read_owner_only(path: &Path, max_bytes: u64) -> Result<Option<Vec<u8>>, StorageError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32);
    }
    let file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        // A symlink (O_NOFOLLOW → ELOOP) is refused as insecure.
        Err(_) if fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink()) => {
            return Err(StorageError::InsecurePermissions);
        }
        Err(_) => return Err(StorageError::Io),
    };
    let metadata = file.metadata().map_err(|_| StorageError::Io)?;
    if !metadata.is_file() {
        return Err(StorageError::Invalid);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.mode() & 0o077 != 0 || metadata.uid() != rustix::process::geteuid().as_raw() {
            return Err(StorageError::InsecurePermissions);
        }
    }
    let mut bytes = Vec::new();
    file.take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| StorageError::Io)?;
    if bytes.len() as u64 > max_bytes {
        return Err(StorageError::TooLarge);
    }
    Ok(Some(bytes))
}

// ---------------------------------------------------------------------------
// oauth-client.json

fn oauth_client_file_json(client: &OAuthClient) -> Vec<u8> {
    serde_json::to_vec_pretty(&serde_json::json!({
        "installed": {
            "client_id": client.client_id,
            "client_secret": client.client_secret.expose(),
        }
    }))
    .unwrap_or_default()
}

/// Parses Google's downloaded client JSON via [`OAuthClient::from_json`].
pub fn parse_oauth_client(bytes: &[u8]) -> Result<OAuthClient, StorageError> {
    OAuthClient::from_json(bytes).map_err(|error| match error {
        OAuthClientError::TooLarge => StorageError::TooLarge,
        OAuthClientError::Invalid | OAuthClientError::NotDesktopClient => StorageError::Invalid,
    })
}

/// Reads an OAuth client file (`oauth-client.json` or the env override). `Ok(None)`
/// when absent.
pub fn load_oauth_client(path: &Path) -> Result<Option<OAuthClient>, StorageError> {
    let Some(bytes) = fsutil::read_optional(path, OAUTH_CLIENT_MAX_BYTES).map_err(io_error)? else {
        return Ok(None);
    };
    parse_oauth_client(&bytes).map(Some)
}

/// `client set --file`: validates `source` and stores only id+secret as
/// `oauth-client.json` (0600).
pub fn import_oauth_client(
    paths: &GoogleCalendarPaths,
    source: &Path,
) -> Result<OAuthClient, StorageError> {
    let bytes = fsutil::read_optional(source, OAUTH_CLIENT_MAX_BYTES)
        .map_err(io_error)?
        .ok_or(StorageError::Io)?;
    let client = parse_oauth_client(&bytes)?;
    write_private(
        &paths.dir(),
        &paths.oauth_client_file(),
        &oauth_client_file_json(&client),
    )?;
    Ok(client)
}

// ---------------------------------------------------------------------------
// sync.lock

/// Held for a whole sync run; released on drop.
#[derive(Debug)]
pub struct SyncLock {
    _file: File,
}

/// `Ok(None)` when another run (any process) holds the lock.
pub fn try_lock(paths: &GoogleCalendarPaths) -> Result<Option<SyncLock>, StorageError> {
    fsutil::ensure_private_dir(&paths.dir()).map_err(|_| StorageError::Io)?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(paths.lock_file())
        .map_err(|_| StorageError::Io)?;
    match file.try_lock() {
        Ok(()) => Ok(Some(SyncLock { _file: file })),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(_)) => Err(StorageError::Io),
    }
}

// ---------------------------------------------------------------------------
// sync.sqlite

const SCHEMA_V1: &str = "
CREATE TABLE calendars(calendar_id TEXT PRIMARY KEY, sync_token TEXT, full_synced_at TEXT, updated_at TEXT NOT NULL);
CREATE TABLE links(calendar_id TEXT NOT NULL, google_event_id TEXT NOT NULL, raven_item_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN('raven','google')),
  state TEXT NOT NULL CHECK(state IN('active','frozen','deleted','orphaned','unsupported','error')),
  google_etag TEXT, google_updated TEXT, google_time_zone TEXT, raven_updated_at TEXT NOT NULL, base_hashes TEXT NOT NULL,
  duration_seconds INTEGER, duration_days INTEGER, last_synced_at TEXT NOT NULL, error_kind TEXT, error_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(calendar_id, google_event_id), UNIQUE(calendar_id, raven_item_id));
CREATE TABLE pending_inbound(calendar_id TEXT, google_event_id TEXT, attempts INTEGER, last_error_kind TEXT, next_attempt_at TEXT, PRIMARY KEY(calendar_id, google_event_id));
";

/// The `sync.sqlite` connection.
pub struct SyncDb {
    conn: Connection,
}

impl fmt::Debug for SyncDb {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SyncDb")
    }
}

impl SyncDb {
    /// Opens (creating the directory and a 0600 file if needed) and migrates.
    pub fn open(paths: &GoogleCalendarPaths) -> Result<Self, StorageError> {
        fsutil::ensure_private_dir(&paths.dir()).map_err(|_| StorageError::Io)?;
        let path = paths.sync_db();
        match fsutil::create_private_file(&path) {
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(StorageError::Io),
        }
        fsutil::restrict_file(&path).map_err(|_| StorageError::Io)?;
        let conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(db_error)?;
        Self::init(conn)
    }

    /// Read paths: `Ok(None)` when the file is absent (nothing is created); an
    /// existing older database is migrated.
    pub fn open_existing(paths: &GoogleCalendarPaths) -> Result<Option<Self>, StorageError> {
        let path = paths.sync_db();
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.is_file() => {}
            Ok(_) => return Err(StorageError::Invalid),
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(StorageError::Io),
        }
        let conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(db_error)?;
        Self::init(conn).map(Some)
    }

    /// In-memory database (tests and dry runs).
    pub fn in_memory() -> Result<Self, StorageError> {
        Self::init(Connection::open_in_memory().map_err(db_error)?)
    }

    fn init(conn: Connection) -> Result<Self, StorageError> {
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(db_error)?;
        let mut db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&mut self) -> Result<(), StorageError> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(db_error)?;
        match version {
            SYNC_DB_VERSION => Ok(()),
            0 => {
                let tx = self.conn.transaction().map_err(db_error)?;
                tx.execute_batch(SCHEMA_V1).map_err(db_error)?;
                tx.pragma_update(None, "user_version", SYNC_DB_VERSION)
                    .map_err(db_error)?;
                tx.commit().map_err(db_error)
            }
            _ => Err(StorageError::UnsupportedVersion),
        }
    }

    pub fn user_version(&self) -> Result<i64, StorageError> {
        self.conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(db_error)
    }

    /// Repository over the connection (each statement autocommits).
    pub fn repo(&self) -> Repo<'_> {
        Repo { conn: &self.conn }
    }

    /// Runs `f` in one transaction; committed only when `f` returns `Ok`.
    pub fn transaction<T>(
        &mut self,
        f: impl FnOnce(&Repo<'_>) -> Result<T, StorageError>,
    ) -> Result<T, StorageError> {
        let tx = self.conn.transaction().map_err(db_error)?;
        let value = f(&Repo { conn: &tx })?;
        tx.commit().map_err(db_error)?;
        Ok(value)
    }
}

/// Removes `sync.sqlite` and its journal files (`disconnect --forget-links`).
pub fn delete_sync_db(paths: &GoogleCalendarPaths) -> Result<(), StorageError> {
    let db = paths.sync_db();
    remove_if_exists(&db)?;
    for suffix in ["-journal", "-wal", "-shm"] {
        let mut name = db.clone().into_os_string();
        name.push(suffix);
        remove_if_exists(Path::new(&name))?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalendarRow {
    pub calendar_id: String,
    pub sync_token: Option<String>,
    pub full_synced_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingInbound {
    pub calendar_id: String,
    pub google_event_id: String,
    pub attempts: i64,
    pub last_error_kind: Option<String>,
    pub next_attempt_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LinkCounts {
    pub total: u64,
    pub error: u64,
}

fn format_time(at: OffsetDateTime) -> String {
    at.format(&Rfc3339).unwrap_or_default()
}

fn parse_time(text: &str) -> Result<OffsetDateTime, StorageError> {
    OffsetDateTime::parse(text, &Rfc3339).map_err(|_| StorageError::Invalid)
}

const LINK_COLUMNS: &str = "calendar_id, google_event_id, raven_item_id, origin, state, google_etag, \
    google_updated, google_time_zone, raven_updated_at, base_hashes, duration_seconds, \
    duration_days, last_synced_at, error_kind, error_count";

struct RawLink {
    calendar_id: String,
    google_event_id: String,
    raven_item_id: String,
    origin: String,
    state: String,
    google_etag: Option<String>,
    google_updated: Option<String>,
    google_time_zone: Option<String>,
    raven_updated_at: String,
    base_hashes: String,
    duration_seconds: Option<i64>,
    duration_days: Option<i64>,
    last_synced_at: String,
    error_kind: Option<String>,
    error_count: i64,
}

impl RawLink {
    fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            calendar_id: row.get(0)?,
            google_event_id: row.get(1)?,
            raven_item_id: row.get(2)?,
            origin: row.get(3)?,
            state: row.get(4)?,
            google_etag: row.get(5)?,
            google_updated: row.get(6)?,
            google_time_zone: row.get(7)?,
            raven_updated_at: row.get(8)?,
            base_hashes: row.get(9)?,
            duration_seconds: row.get(10)?,
            duration_days: row.get(11)?,
            last_synced_at: row.get(12)?,
            error_kind: row.get(13)?,
            error_count: row.get(14)?,
        })
    }

    fn into_link(self) -> Result<Link, StorageError> {
        Ok(Link {
            origin: LinkOrigin::parse(&self.origin).ok_or(StorageError::Invalid)?,
            state: LinkState::parse(&self.state).ok_or(StorageError::Invalid)?,
            google_updated: self.google_updated.as_deref().map(parse_time).transpose()?,
            raven_updated_at: parse_time(&self.raven_updated_at)?,
            base_hashes: FieldHashes::from_json(&self.base_hashes).ok_or(StorageError::Invalid)?,
            last_synced_at: parse_time(&self.last_synced_at)?,
            calendar_id: self.calendar_id,
            google_event_id: self.google_event_id,
            raven_item_id: self.raven_item_id,
            google_etag: self.google_etag,
            google_time_zone: self.google_time_zone,
            duration_seconds: self.duration_seconds,
            duration_days: self.duration_days,
            error_kind: self.error_kind,
            error_count: self.error_count,
        })
    }
}

/// Typed access to the `sync.sqlite` tables.
pub struct Repo<'c> {
    conn: &'c Connection,
}

impl Repo<'_> {
    pub fn calendar(&self, calendar_id: &str) -> Result<Option<CalendarRow>, StorageError> {
        self.conn
            .query_row(
                "SELECT calendar_id, sync_token, full_synced_at, updated_at FROM calendars WHERE calendar_id = ?1",
                [calendar_id],
                |row| {
                    Ok(CalendarRow {
                        calendar_id: row.get(0)?,
                        sync_token: row.get(1)?,
                        full_synced_at: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(db_error)
    }

    pub fn upsert_calendar(&self, row: &CalendarRow) -> Result<(), StorageError> {
        self.conn
            .execute(
                "INSERT INTO calendars(calendar_id, sync_token, full_synced_at, updated_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(calendar_id) DO UPDATE SET sync_token = excluded.sync_token,
                   full_synced_at = excluded.full_synced_at, updated_at = excluded.updated_at",
                params![row.calendar_id, row.sync_token, row.full_synced_at, row.updated_at],
            )
            .map(|_| ())
            .map_err(db_error)
    }

    /// Stores the next sync token (creating the calendar row if needed).
    pub fn set_sync_token(
        &self,
        calendar_id: &str,
        sync_token: Option<&str>,
        full_synced: bool,
        now: OffsetDateTime,
    ) -> Result<(), StorageError> {
        let now = format_time(now);
        self.conn
            .execute(
                "INSERT INTO calendars(calendar_id, sync_token, full_synced_at, updated_at)
                 VALUES (?1, ?2, CASE WHEN ?3 THEN ?4 END, ?4)
                 ON CONFLICT(calendar_id) DO UPDATE SET sync_token = excluded.sync_token,
                   full_synced_at = CASE WHEN ?3 THEN ?4 ELSE calendars.full_synced_at END,
                   updated_at = ?4",
                params![calendar_id, sync_token, full_synced, now],
            )
            .map(|_| ())
            .map_err(db_error)
    }

    /// 410 Gone or calendar change: forget the token so the next pass is a full sync.
    pub fn clear_sync_token(
        &self,
        calendar_id: &str,
        now: OffsetDateTime,
    ) -> Result<(), StorageError> {
        self.conn
            .execute(
                "UPDATE calendars SET sync_token = NULL, updated_at = ?2 WHERE calendar_id = ?1",
                params![calendar_id, format_time(now)],
            )
            .map(|_| ())
            .map_err(db_error)
    }

    pub fn links(&self, calendar_id: &str) -> Result<Vec<Link>, StorageError> {
        self.query_links(
            &format!(
                "SELECT {LINK_COLUMNS} FROM links WHERE calendar_id = ?1 ORDER BY google_event_id"
            ),
            [calendar_id],
        )
    }

    pub fn link_by_google(
        &self,
        calendar_id: &str,
        google_event_id: &str,
    ) -> Result<Option<Link>, StorageError> {
        Ok(self
            .query_links(
                &format!(
                    "SELECT {LINK_COLUMNS} FROM links WHERE calendar_id = ?1 AND google_event_id = ?2"
                ),
                [calendar_id, google_event_id],
            )?
            .pop())
    }

    pub fn link_by_raven(
        &self,
        calendar_id: &str,
        raven_item_id: &str,
    ) -> Result<Option<Link>, StorageError> {
        Ok(self
            .query_links(
                &format!(
                    "SELECT {LINK_COLUMNS} FROM links WHERE calendar_id = ?1 AND raven_item_id = ?2"
                ),
                [calendar_id, raven_item_id],
            )?
            .pop())
    }

    fn query_links<P: rusqlite::Params>(
        &self,
        sql: &str,
        params: P,
    ) -> Result<Vec<Link>, StorageError> {
        let mut statement = self.conn.prepare(sql).map_err(db_error)?;
        let rows = statement
            .query_map(params, RawLink::from_row)
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)?;
        rows.into_iter().map(RawLink::into_link).collect()
    }

    /// Inserts or replaces the row keyed by (calendar_id, google_event_id). A stale row
    /// holding the same raven item id (e.g. after a postpone re-link) is replaced.
    pub fn upsert_link(&self, link: &Link) -> Result<(), StorageError> {
        if !valid_id(&link.calendar_id)
            || !valid_id(&link.google_event_id)
            || !valid_id(&link.raven_item_id)
        {
            return Err(StorageError::Validation { field: "link" });
        }
        self.conn
            .execute(
                &format!(
                    "INSERT OR REPLACE INTO links({LINK_COLUMNS})
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"
                ),
                params![
                    link.calendar_id,
                    link.google_event_id,
                    link.raven_item_id,
                    link.origin.as_str(),
                    link.state.as_str(),
                    link.google_etag,
                    link.google_updated.map(format_time),
                    link.google_time_zone,
                    format_time(link.raven_updated_at),
                    link.base_hashes.to_json(),
                    link.duration_seconds,
                    link.duration_days,
                    format_time(link.last_synced_at),
                    link.error_kind,
                    link.error_count,
                ],
            )
            .map(|_| ())
            .map_err(db_error)
    }

    pub fn delete_link(
        &self,
        calendar_id: &str,
        google_event_id: &str,
    ) -> Result<(), StorageError> {
        self.conn
            .execute(
                "DELETE FROM links WHERE calendar_id = ?1 AND google_event_id = ?2",
                [calendar_id, google_event_id],
            )
            .map(|_| ())
            .map_err(db_error)
    }

    /// Records a failed write on a link (`state = error` once it keeps failing).
    pub fn record_link_error(
        &self,
        calendar_id: &str,
        google_event_id: &str,
        error_kind: &str,
        error_state_after: i64,
    ) -> Result<(), StorageError> {
        self.conn
            .execute(
                "UPDATE links SET error_kind = ?3, error_count = error_count + 1,
                   state = CASE WHEN error_count + 1 >= ?4 AND state = 'active' THEN 'error' ELSE state END
                 WHERE calendar_id = ?1 AND google_event_id = ?2",
                params![calendar_id, google_event_id, error_kind, error_state_after],
            )
            .map(|_| ())
            .map_err(db_error)
    }

    /// Calendar change: drop every link (and pending row) of the old calendar and its
    /// sync token. Google events are left untouched.
    pub fn forget_calendar(&self, calendar_id: &str) -> Result<u64, StorageError> {
        let removed = self
            .conn
            .execute("DELETE FROM links WHERE calendar_id = ?1", [calendar_id])
            .map_err(db_error)?;
        self.conn
            .execute(
                "DELETE FROM pending_inbound WHERE calendar_id = ?1",
                [calendar_id],
            )
            .map_err(db_error)?;
        self.conn
            .execute(
                "DELETE FROM calendars WHERE calendar_id = ?1",
                [calendar_id],
            )
            .map_err(db_error)?;
        Ok(removed as u64)
    }

    pub fn link_counts(&self, calendar_id: &str) -> Result<LinkCounts, StorageError> {
        self.conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(state = 'error' OR error_count > 0), 0) FROM links WHERE calendar_id = ?1",
                [calendar_id],
                |row| {
                    Ok(LinkCounts {
                        total: row.get::<_, i64>(0)?.max(0) as u64,
                        error: row.get::<_, i64>(1)?.max(0) as u64,
                    })
                },
            )
            .map_err(db_error)
    }

    /// Records a failed inbound event; returns the attempt count.
    pub fn record_pending_failure(
        &self,
        calendar_id: &str,
        google_event_id: &str,
        error_kind: &str,
        next_attempt_at: OffsetDateTime,
    ) -> Result<i64, StorageError> {
        self.conn
            .query_row(
                "INSERT INTO pending_inbound(calendar_id, google_event_id, attempts, last_error_kind, next_attempt_at)
                 VALUES (?1, ?2, 1, ?3, ?4)
                 ON CONFLICT(calendar_id, google_event_id) DO UPDATE SET attempts = COALESCE(pending_inbound.attempts, 0) + 1,
                   last_error_kind = excluded.last_error_kind, next_attempt_at = excluded.next_attempt_at
                 RETURNING attempts",
                params![calendar_id, google_event_id, error_kind, format_time(next_attempt_at)],
                |row| row.get(0),
            )
            .map_err(db_error)
    }

    /// Pending rows due at `now` with fewer than [`PENDING_MAX_ATTEMPTS`] attempts.
    pub fn due_pending(
        &self,
        calendar_id: &str,
        now: OffsetDateTime,
    ) -> Result<Vec<PendingInbound>, StorageError> {
        Ok(self
            .pending(calendar_id)?
            .into_iter()
            .filter(|row| row.attempts < PENDING_MAX_ATTEMPTS)
            .filter(|row| {
                row.next_attempt_at
                    .as_deref()
                    .and_then(|at| OffsetDateTime::parse(at, &Rfc3339).ok())
                    .is_none_or(|at| at <= now)
            })
            .collect())
    }

    pub fn pending(&self, calendar_id: &str) -> Result<Vec<PendingInbound>, StorageError> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT calendar_id, google_event_id, attempts, last_error_kind, next_attempt_at
                 FROM pending_inbound WHERE calendar_id = ?1 ORDER BY google_event_id",
            )
            .map_err(db_error)?;
        statement
            .query_map([calendar_id], |row| {
                Ok(PendingInbound {
                    calendar_id: row.get(0)?,
                    google_event_id: row.get(1)?,
                    attempts: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                    last_error_kind: row.get(3)?,
                    next_attempt_at: row.get(4)?,
                })
            })
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)
    }

    pub fn clear_pending(
        &self,
        calendar_id: &str,
        google_event_id: &str,
    ) -> Result<(), StorageError> {
        self.conn
            .execute(
                "DELETE FROM pending_inbound WHERE calendar_id = ?1 AND google_event_id = ?2",
                [calendar_id, google_event_id],
            )
            .map(|_| ())
            .map_err(db_error)
    }
}

#[cfg(test)]
mod tests;
