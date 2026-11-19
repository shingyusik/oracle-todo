//! Background scheduler for `raven ui` / `raven api`: first check after a start
//! delay, then on a fixed interval; a run is due once a day.

use std::time::Duration;

use time::OffsetDateTime;

use super::settings::RetentionSettings;
use super::{INTERVAL_HOURS, LOG_TARGET, LastRun, Retention, RunReport, SchedulerStatus, Trigger};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SchedulerTiming {
    pub initial_delay: Duration,
    pub interval: Duration,
}

impl Default for SchedulerTiming {
    fn default() -> Self {
        Self {
            initial_delay: Duration::from_secs(5 * 60),
            interval: Duration::from_secs(60 * 60),
        }
    }
}

/// Due when enabled, not env-disabled, and never ran or the last run finished ≥ 24h ago.
pub fn is_due(
    settings: &RetentionSettings,
    env_disabled: bool,
    last_finished_at: Option<OffsetDateTime>,
    now: OffsetDateTime,
) -> bool {
    settings.enabled
        && !env_disabled
        && last_finished_at.is_none_or(|last| now >= last + time::Duration::hours(INTERVAL_HOURS))
}

/// First scheduler check at which a run will be due, if the scheduler is running.
pub(crate) fn next_run_at(
    settings: &RetentionSettings,
    env_disabled: bool,
    status: SchedulerStatus,
    last_finished_at: Option<OffsetDateTime>,
) -> Option<OffsetDateTime> {
    if !status.active || !settings.enabled || env_disabled {
        return None;
    }
    let next_check = status.next_check_at?;
    let Some(due_at) = last_finished_at.map(|last| last + time::Duration::hours(INTERVAL_HOURS))
    else {
        return Some(next_check);
    };
    if due_at <= next_check {
        return Some(next_check);
    }
    let interval = time::Duration::try_from(status.interval)
        .ok()
        .filter(|interval| interval.is_positive())?;
    let gap = due_at - next_check;
    let steps =
        (gap.whole_nanoseconds() + interval.whole_nanoseconds() - 1) / interval.whole_nanoseconds();
    Some(next_check + interval * i32::try_from(steps).ok()?)
}

impl Retention {
    /// Starts the scheduler on the current Tokio runtime. The task holds no
    /// resources between checks, so aborting it or exiting the process is safe.
    pub fn spawn_scheduler(&self, timing: SchedulerTiming) -> tokio::task::JoinHandle<()> {
        let retention = self.clone();
        tokio::spawn(async move { retention.scheduler_loop(timing).await })
    }

    async fn scheduler_loop(self, timing: SchedulerTiming) {
        if self.env_disabled() {
            tracing::info!(
                target: LOG_TARGET,
                event = "retention_skipped",
                reason = "env_disabled",
                "retention scheduler disabled"
            );
            return;
        }
        let mut delay = timing.initial_delay;
        loop {
            self.set_scheduler(SchedulerStatus {
                active: true,
                next_check_at: time::Duration::try_from(delay)
                    .ok()
                    .map(|delay| self.now() + delay),
                interval: timing.interval,
            });
            tokio::time::sleep(delay).await;
            let retention = self.clone();
            let _ = tokio::task::spawn_blocking(move || retention.scheduled_check()).await;
            delay = timing.interval;
        }
    }

    /// One scheduler tick: runs only when due.
    pub fn scheduled_check(&self) -> Option<RunReport> {
        let settings = match self.settings() {
            Ok(settings) => settings,
            Err(_) => {
                tracing::warn!(
                    target: LOG_TARGET,
                    event = "retention_skipped",
                    reason = "settings_unavailable",
                    "retention settings unavailable"
                );
                return None;
            }
        };
        let last = self.last_run().ok()?;
        if !is_due(
            &settings,
            self.env_disabled(),
            last.as_ref().and_then(LastRun::finished_at),
            self.now(),
        ) {
            return None;
        }
        self.run(Trigger::Scheduled).ok()
    }
}
