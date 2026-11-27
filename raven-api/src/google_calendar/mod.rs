//! Google Calendar two-way sync of ToDo events.

/// Runs one Google call with a fresh access token: retries once after a 401 and backs
/// off on rate limits. Evaluates to `Result<T, GoogleCalendarError>`.
macro_rules! google_call {
    ($rt:expr, $operation:expr, |$api:ident, $at:ident| $call:expr) => {{
        let rt = &$rt;
        let mut attempt: u32 = 0;
        let mut reauthorized = false;
        loop {
            attempt += 1;
            let token = match rt.access_token().await {
                Ok(token) => token,
                Err(error) => break Err(error),
            };
            let $api = rt.inner.api.as_ref();
            let $at = &token;
            match $call.await {
                Ok(value) => break Ok(value),
                Err($crate::google_calendar::client::GoogleApiError::Unauthorized)
                    if !reauthorized =>
                {
                    reauthorized = true;
                    rt.invalidate_access().await;
                }
                Err($crate::google_calendar::client::GoogleApiError::RateLimited {
                    retry_after,
                }) if rt
                    .rate_limit_backoff($operation, attempt, retry_after)
                    .await => {}
                Err(error) => {
                    break Err($crate::google_calendar::GoogleCalendarError::Upstream(
                        error,
                    ));
                }
            }
        }
    }};
}

pub mod client;
pub mod mapping;
pub mod oauth;
pub mod reconcile;
mod runtime;
mod scheduler;
pub mod secret;
pub mod storage;
mod sync;
#[cfg(any(test, feature = "contract-test-support"))]
pub mod testing;
#[cfg(test)]
mod tests;

pub use runtime::{
    CALLBACK_PATH, CONNECT_TTL, CalendarEntry, CalendarList, CalendarRef, Clock, ConnectStart,
    ENV_KILL_SWITCH, GoogleCalendar, GoogleCalendarBuilder, GoogleCalendarError,
    GoogleCalendarStatus, LinksView, MAX_RATE_LIMIT_ATTEMPTS, Monotonic, ScheduleView,
    SettingsView, SleepFuture, Sleeper, SyncOptions, SyncPreview, SyncReport, TOKEN_REFRESH_MARGIN,
    Trigger, env_kill_switch, parse_callback_query,
};
pub use scheduler::SchedulerTiming;
pub use storage::SettingsUpdate;
pub use sync::MAX_WRITES_PER_PASS;
