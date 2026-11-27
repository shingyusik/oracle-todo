//! Daily retention purge shared by the UI/API scheduler, HTTP routes and the CLI.
//!
//! Layout under the Raven home:
//! `maintenance/{retention.json, retention-state.json, retention.lock}` and
//! `backups/retention/<YYYYMMDDTHHMMSSZ>/`.

mod backup;
mod lock;
mod plan;
mod run;
mod scheduler;
mod settings;
mod state;
#[cfg(test)]
mod tests;

use std::collections::BTreeSet;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::fsutil;
use time::{OffsetDateTime, UtcOffset};

pub use plan::{DomainPreview, PreviewItem, RetentionPreview};
pub use run::{RunReport, Trigger};
pub use scheduler::{SchedulerTiming, is_due};
pub use settings::{RetentionSettings, SettingsUpdate};
pub use state::{BackupRef, DomainRun, LastRun};

/// Scheduler cadence advertised to clients.
pub const INTERVAL_HOURS: i64 = 24;
/// Default and bounds of the preview item list.
pub const DEFAULT_PREVIEW_LIMIT: usize = 50;
pub const MAX_PREVIEW_LIMIT: usize = 200;
/// Value of `RAVEN_RETENTION` that disables the scheduler.
pub const ENV_KILL_SWITCH: &str = "RAVEN_RETENTION";

pub(crate) const LOG_TARGET: &str = "raven_api";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Domain {
    Todo,
    Ledger,
    Health,
}

impl Domain {
    pub const ALL: [Domain; 3] = [Domain::Todo, Domain::Ledger, Domain::Health];

    pub fn as_str(self) -> &'static str {
        match self {
            Domain::Todo => "todo",
            Domain::Ledger => "ledger",
            Domain::Health => "health",
        }
    }
}

/// Store locations; the Raven home is the parent of `todo.sqlite`.
#[derive(Clone, PartialEq, Eq)]
pub struct RetentionPaths {
    pub home: PathBuf,
    pub todo_db: PathBuf,
    pub ledger_db: PathBuf,
    pub health_db: PathBuf,
    pub health_media_dir: PathBuf,
}

impl fmt::Debug for RetentionPaths {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RetentionPaths(<redacted>)")
    }
}

impl RetentionPaths {
    pub fn from_config(config: &crate::RavenApiConfig) -> Self {
        Self {
            home: config
                .todo_db
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from(".")),
            todo_db: config.todo_db.clone(),
            ledger_db: config.ledger_db.clone(),
            health_db: config.health_db.clone(),
            health_media_dir: config.health_media_dir.clone(),
        }
    }

    pub(crate) fn maintenance_dir(&self) -> PathBuf {
        self.home.join("maintenance")
    }

    pub(crate) fn settings_file(&self) -> PathBuf {
        self.maintenance_dir().join("retention.json")
    }

    pub(crate) fn state_file(&self) -> PathBuf {
        self.maintenance_dir().join("retention-state.json")
    }

    pub(crate) fn lock_file(&self) -> PathBuf {
        self.maintenance_dir().join("retention.lock")
    }

    pub(crate) fn backups_dir(&self) -> PathBuf {
        self.home.join("backups").join("retention")
    }

    pub(crate) fn db(&self, domain: Domain) -> &Path {
        match domain {
            Domain::Todo => &self.todo_db,
            Domain::Ledger => &self.ledger_db,
            Domain::Health => &self.health_db,
        }
    }
}

/// Failures surfaced to adapters. Messages never contain paths or record data.
#[derive(Debug, thiserror::Error)]
pub enum RetentionError {
    #[error("invalid retention setting")]
    Validation { field: &'static str },
    #[error("retention storage is unavailable")]
    Storage,
}

pub type Clock = Arc<dyn Fn() -> OffsetDateTime + Send + Sync>;
pub type FreeSpace = Arc<dyn Fn(&Path) -> std::io::Result<u64> + Send + Sync>;

/// Shared retention runtime: one per process, cloned into routes and the scheduler.
#[derive(Clone)]
pub struct Retention {
    inner: Arc<Inner>,
}

struct Inner {
    paths: RetentionPaths,
    local_offset: UtcOffset,
    env_disabled: bool,
    clock: Clock,
    free_space: FreeSpace,
    scheduler: Mutex<SchedulerStatus>,
    fail_apply: Mutex<BTreeSet<Domain>>,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct SchedulerStatus {
    pub active: bool,
    pub next_check_at: Option<OffsetDateTime>,
    pub interval: std::time::Duration,
}

impl fmt::Debug for Retention {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Retention(<redacted>)")
    }
}

pub struct RetentionBuilder {
    paths: RetentionPaths,
    local_offset: UtcOffset,
    env_disabled: bool,
    clock: Clock,
    free_space: FreeSpace,
}

impl RetentionBuilder {
    /// Overrides the `RAVEN_RETENTION=off` kill switch read from the environment.
    pub fn env_disabled(mut self, disabled: bool) -> Self {
        self.env_disabled = disabled;
        self
    }

    pub fn clock(mut self, clock: Clock) -> Self {
        self.clock = clock;
        self
    }

    pub fn free_space(mut self, free_space: FreeSpace) -> Self {
        self.free_space = free_space;
        self
    }

    pub fn build(self) -> Retention {
        Retention {
            inner: Arc::new(Inner {
                paths: self.paths,
                local_offset: self.local_offset,
                env_disabled: self.env_disabled,
                clock: self.clock,
                free_space: self.free_space,
                scheduler: Mutex::new(SchedulerStatus::default()),
                fail_apply: Mutex::new(BTreeSet::new()),
            }),
        }
    }
}

/// True when `RAVEN_RETENTION` is exactly `off`.
pub fn env_kill_switch() -> bool {
    std::env::var_os(ENV_KILL_SWITCH).is_some_and(|value| value == "off")
}

impl Retention {
    pub fn builder(paths: RetentionPaths, local_offset: UtcOffset) -> RetentionBuilder {
        RetentionBuilder {
            paths,
            local_offset,
            env_disabled: env_kill_switch(),
            clock: Arc::new(OffsetDateTime::now_utc),
            free_space: Arc::new(fsutil::available_space),
        }
    }

    pub fn from_config(config: &crate::RavenApiConfig) -> Self {
        Self::builder(RetentionPaths::from_config(config), config.local_offset).build()
    }

    pub(crate) fn paths(&self) -> &RetentionPaths {
        &self.inner.paths
    }

    pub(crate) fn now(&self) -> OffsetDateTime {
        (self.inner.clock)()
    }

    pub fn env_disabled(&self) -> bool {
        self.inner.env_disabled
    }

    pub fn settings(&self) -> Result<RetentionSettings, RetentionError> {
        settings::load(self.paths())
    }

    pub fn update_settings(
        &self,
        update: SettingsUpdate,
    ) -> Result<RetentionSettings, RetentionError> {
        settings::update(self.paths(), update)
    }

    pub fn last_run(&self) -> Result<Option<LastRun>, RetentionError> {
        Ok(state::load(self.paths())?.last_run)
    }

    /// The `GET /api/v1/maintenance/retention` document.
    pub fn status(&self) -> Result<RetentionStatus, RetentionError> {
        let settings = self.settings()?;
        let last_run = self.last_run()?;
        let scheduler = *self
            .inner
            .scheduler
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let next_run_at = scheduler::next_run_at(
            &settings,
            self.env_disabled(),
            scheduler,
            last_run.as_ref().and_then(LastRun::finished_at),
        );
        Ok(RetentionStatus {
            settings,
            env_override: self.env_disabled().then_some("disabled"),
            schedule: Schedule {
                interval_hours: INTERVAL_HOURS,
                scheduler_active: scheduler.active,
                next_run_at: next_run_at.and_then(state::format_instant),
            },
            last_run,
        })
    }

    /// Read-only plan of every domain. Never creates stores or maintenance files.
    pub fn preview(&self, limit: usize) -> Result<RetentionPreview, RetentionError> {
        let settings = self.settings()?;
        Ok(plan::preview(self, &settings, limit))
    }

    /// One full run: lock, plan, backup, apply, rotate and record.
    pub fn run(&self, trigger: Trigger) -> Result<RunReport, RetentionError> {
        run::run(self, trigger)
    }

    pub(crate) fn set_scheduler(&self, status: SchedulerStatus) {
        *self
            .inner
            .scheduler
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = status;
    }

    pub(crate) fn apply_should_fail(&self, domain: Domain) -> bool {
        self.inner
            .fail_apply
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .contains(&domain)
    }

    #[cfg(test)]
    pub(crate) fn fail_apply_for(&self, domain: Domain) {
        self.inner.fail_apply.lock().unwrap().insert(domain);
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RetentionStatus {
    pub settings: RetentionSettings,
    pub env_override: Option<&'static str>,
    pub schedule: Schedule,
    pub last_run: Option<LastRun>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Schedule {
    pub interval_hours: i64,
    pub scheduler_active: bool,
    pub next_run_at: Option<String>,
}
