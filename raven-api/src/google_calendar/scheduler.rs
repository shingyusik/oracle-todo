//! Background scheduler for `raven ui` / `raven api`: first pass after a start delay,
//! then every `poll_interval_secs`. Runs only when enabled, connected, a calendar is
//! selected and the first sync was confirmed. `RAVEN_GOOGLE_CALENDAR=off` disables it.

use std::time::Duration;

use super::runtime::{
    GoogleCalendar, GoogleCalendarError, LOG_TARGET, SchedulerStatus, SyncOptions, SyncReport,
    Trigger,
};
use super::storage;
use super::sync::log_skipped_reason;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SchedulerTiming {
    pub initial_delay: Duration,
    /// `None` = `settings.poll_interval_secs`, re-read before every wait.
    pub interval: Option<Duration>,
}

impl Default for SchedulerTiming {
    fn default() -> Self {
        Self {
            initial_delay: Duration::from_secs(60),
            interval: None,
        }
    }
}

impl GoogleCalendar {
    /// Starts the scheduler on the current Tokio runtime.
    pub fn spawn_scheduler(&self, timing: SchedulerTiming) -> tokio::task::JoinHandle<()> {
        let runtime = self.clone();
        tokio::spawn(async move { runtime.scheduler_loop(timing).await })
    }

    async fn scheduler_loop(self, timing: SchedulerTiming) {
        if self.env_disabled() {
            log_skipped_reason("env_disabled");
            return;
        }
        let mut delay = timing.initial_delay;
        loop {
            self.set_scheduler(SchedulerStatus {
                active: true,
                next_check_at: time::Duration::try_from(delay)
                    .ok()
                    .map(|delay| self.now() + delay),
            });
            tokio::time::sleep(delay).await;
            let _ = self.scheduled_check().await;
            delay = timing.interval.unwrap_or_else(|| {
                Duration::from_secs(
                    self.settings()
                        .map(|settings| settings.poll_interval_secs)
                        .unwrap_or(120),
                )
            });
        }
    }

    /// One scheduler tick; runs a pass only when every gate passes.
    pub async fn scheduled_check(&self) -> Option<SyncReport> {
        let gate = (|| {
            let settings = self.settings().map_err(|_| "storage_unavailable")?;
            let state = storage::load_state(self.paths()).map_err(|_| "storage_unavailable")?;
            let connection = self.connection_state().map_err(|_| "storage_unavailable")?;
            self.scheduler_gate(&settings, &state, connection)?;
            Ok::<_, &'static str>(settings)
        })();
        let settings = match gate {
            Ok(settings) => settings,
            // Waiting for the user to confirm the first sync is not worth a log line.
            Err("first_sync_pending") => return None,
            Err(reason @ ("disabled" | "not_connected" | "calendar_not_selected")) => {
                tracing::debug!(
                    target: LOG_TARGET,
                    event = "google_calendar_sync_skipped",
                    reason,
                    "google calendar sync skipped"
                );
                return None;
            }
            Err(reason) => {
                log_skipped_reason(reason);
                return None;
            }
        };
        let calendar_id = settings.calendar_id.clone()?;
        let lock = match storage::try_lock(self.paths()) {
            Ok(Some(lock)) => lock,
            Ok(None) => {
                log_skipped_reason("locked");
                return None;
            }
            Err(_) => return None,
        };
        let result = self
            .run_locked(
                Trigger::Scheduled,
                SyncOptions::default(),
                settings,
                calendar_id,
            )
            .await;
        drop(lock);
        match result {
            Ok(report) => Some(report),
            Err(GoogleCalendarError::TodoUnavailable) => None,
            Err(_) => None,
        }
    }
}
