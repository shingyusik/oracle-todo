use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use raven_api::google_calendar::SchedulerTiming as GoogleCalendarTiming;
use raven_api::retention::SchedulerTiming;
use raven_api::{
    AuthMode, GithubReleases, RavenApiConfig, RestartSignal, UiUpdates, UpdateSettings,
};
use time::macros::offset;

use crate::cli::UiArgs;
use crate::config::RavenPaths;

#[derive(Debug, thiserror::Error)]
pub enum UiCommandError {
    #[error("UI artifact is missing, unreadable, or invalid")]
    Artifact,
    #[error("invalid RAVEN_UI_PUBLIC_ORIGIN")]
    PublicOrigin,
}

impl UiCommandError {
    pub fn cli_exit_code(&self) -> i32 {
        match self {
            Self::Artifact => 1,
            Self::PublicOrigin => 2,
        }
    }
}

pub fn run(paths: &RavenPaths, args: UiArgs) -> anyhow::Result<()> {
    let ui_path = resolve_ui_path(args.ui_path).map_err(|_| UiCommandError::Artifact)?;
    let artifact = raven_api::UiArtifact::load(ui_path).map_err(|_| UiCommandError::Artifact)?;
    let public_origin = public_origin_from_env()?;
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, args.port));
    validate_public_origin(public_origin.as_deref(), addr)?;
    let session =
        raven_api::UiSessionToken::generate().map_err(|_| anyhow::anyhow!("UI session failed"))?;
    let config = RavenApiConfig {
        todo_db: paths.todo_db(),
        ledger_db: paths.ledger_db(),
        health_db: paths.health_db(),
        health_media_dir: paths.health_media_dir(),
        local_offset: offset!(+9),
        auth: AuthMode::ui_session(&session),
    };
    let updates = ui_updates()?;
    let restart = updates.restart_signal();
    let retention = raven_api::Retention::from_config(&config);
    let google_calendar = raven_api::GoogleCalendar::from_config(&config)?;
    let runtime = tokio::runtime::Runtime::new()?;
    let result = runtime.block_on(async move {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        let actual = listener.local_addr()?;
        validate_public_origin(public_origin.as_deref(), actual)?;
        // The Google OAuth redirect URI uses the actual listener port.
        let app = raven_api::ui_router_with_integrations(
            config,
            artifact,
            session,
            actual,
            public_origin.as_deref(),
            updates,
            retention.clone(),
            google_calendar.clone(),
        )?;
        tokio::spawn(exit_after_restart(restart, UPDATE_RESTART_DELAY, || {
            std::process::exit(UPDATE_RESTART_EXIT_CODE)
        }));
        // Detached: the exit-75 update path and shutdown never wait for it.
        retention.spawn_scheduler(SchedulerTiming::default());
        google_calendar.spawn_scheduler(GoogleCalendarTiming::default());
        let (url, session_url) = ui_urls(actual);
        println!("Raven UI listening on {url}");
        println!("Open Raven UI: {session_url}");
        if !args.no_open
            && let Err(error) = open_browser(&session_url)
        {
            tracing::warn!(event = "browser_open_failed", %error, "browser could not be opened");
        }
        axum::serve(listener, app).await?;
        anyhow::Ok(())
    });
    // Never block exit on an in-flight scheduled purge or sync; their writes are atomic
    // and a sync resumes from its last saved link and token.
    runtime.shutdown_background();
    result
}

fn public_origin_from_env() -> Result<Option<String>, UiCommandError> {
    std::env::var_os("RAVEN_UI_PUBLIC_ORIGIN")
        .map(|value| {
            value
                .into_string()
                .map_err(|_| UiCommandError::PublicOrigin)
        })
        .transpose()
}

fn validate_public_origin(
    public_origin: Option<&str>,
    authority: SocketAddr,
) -> anyhow::Result<()> {
    if let Some(public_origin) = public_origin {
        raven_api::validate_ui_public_origin(public_origin, authority)
            .map_err(|_| UiCommandError::PublicOrigin)?;
    }
    Ok(())
}

/// Exit code telling the npm supervisor to install the accepted update and relaunch.
pub const UPDATE_RESTART_EXIT_CODE: i32 = 75;
const UPDATE_RESTART_DELAY: Duration = Duration::from_millis(300);

fn update_settings(lookup: impl Fn(&str) -> Option<String>) -> UpdateSettings {
    let compiled = UpdateSettings::compiled();
    let present = |name: &str| lookup(name).filter(|value| !value.is_empty());
    UpdateSettings {
        current_version: present("RAVEN_BUNDLE_VERSION").unwrap_or(compiled.current_version),
        ui_version: present("RAVEN_UI_VERSION"),
        supported: lookup("RAVEN_UPDATE_SUPERVISOR").as_deref() == Some("1"),
        target: compiled.target,
    }
}

fn ui_updates() -> anyhow::Result<UiUpdates> {
    let lookup = |name: &str| std::env::var(name).ok();
    let source =
        GithubReleases::from_env(lookup("RAVEN_GITHUB_TOKEN"), lookup("RAVEN_GITHUB_API_URL"))?;
    Ok(UiUpdates::new(update_settings(lookup), Arc::new(source)))
}

/// After an accepted update, give the 202 response time to flush, then exit without
/// waiting for open SSE connections.
async fn exit_after_restart(signal: RestartSignal, delay: Duration, exit: impl FnOnce()) {
    signal.requested().await;
    tokio::time::sleep(delay).await;
    exit();
}

fn resolve_ui_path(explicit: Option<PathBuf>) -> anyhow::Result<PathBuf> {
    if let Some(path) = explicit.or_else(|| std::env::var_os("RAVEN_UI_PATH").map(PathBuf::from)) {
        return Ok(path);
    }
    let executable =
        std::env::current_exe().map_err(|_| anyhow::anyhow!("UI artifact is missing"))?;
    executable
        .parent()
        .map(|parent| parent.join("ui"))
        .ok_or_else(|| anyhow::anyhow!("UI artifact is missing"))
}

fn ui_urls(actual: SocketAddr) -> (String, String) {
    let url = format!("http://{actual}");
    let session_url = format!("{url}/__raven/session");
    (url, session_url)
}

fn open_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };
    let child = command.spawn()?;
    reap_child(child);
    Ok(())
}

fn reap_child(mut child: Child) -> JoinHandle<std::io::Result<ExitStatus>> {
    std::thread::spawn(move || child.wait())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_child_is_reaped_off_the_server_thread() {
        #[cfg(unix)]
        let child = Command::new("sh").args(["-c", "exit 0"]).spawn().unwrap();
        #[cfg(windows)]
        let child = Command::new("cmd")
            .args(["/C", "exit", "0"])
            .spawn()
            .unwrap();

        let status = reap_child(child).join().unwrap().unwrap();
        assert!(status.success());
    }

    #[test]
    fn update_settings_read_the_supervisor_environment() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| {
                pairs
                    .iter()
                    .find(|(key, _)| *key == name)
                    .map(|(_, value)| (*value).to_owned())
            }
        };
        let supervised = update_settings(env(&[
            ("RAVEN_UPDATE_SUPERVISOR", "1"),
            ("RAVEN_BUNDLE_VERSION", "0.4.0"),
            ("RAVEN_UI_VERSION", "0.4.1"),
        ]));
        assert_eq!(supervised.current_version, "0.4.0");
        assert_eq!(supervised.ui_version.as_deref(), Some("0.4.1"));
        assert!(supervised.supported);

        let standalone = update_settings(env(&[
            ("RAVEN_UPDATE_SUPERVISOR", "true"),
            ("RAVEN_BUNDLE_VERSION", ""),
        ]));
        assert_eq!(
            standalone.current_version,
            raven_api::version::RELEASE_VERSION
        );
        assert_eq!(standalone.ui_version, None);
        assert!(!standalone.supported);
        assert_eq!(standalone.target, raven_api::version::HOST_TARGET);
    }

    #[tokio::test(start_paused = true)]
    async fn accepted_update_exits_with_code_75_after_the_restart_delay() {
        let signal = RestartSignal::default();
        let (sender, mut exited) = tokio::sync::oneshot::channel();
        let started = tokio::time::Instant::now();
        let waiter = tokio::spawn(exit_after_restart(
            signal.clone(),
            UPDATE_RESTART_DELAY,
            move || sender.send(UPDATE_RESTART_EXIT_CODE).unwrap(),
        ));
        tokio::time::sleep(Duration::from_secs(3600)).await;
        assert!(exited.try_recv().is_err(), "no exit without an update");

        let requested = tokio::time::Instant::now();
        signal.trigger();
        tokio::time::sleep(UPDATE_RESTART_DELAY - Duration::from_millis(1)).await;
        assert!(exited.try_recv().is_err(), "exit waits for the response");
        assert_eq!(exited.await.unwrap(), 75);
        assert_eq!(requested.elapsed(), UPDATE_RESTART_DELAY);
        assert!(started.elapsed() > UPDATE_RESTART_DELAY);
        waiter.await.unwrap();
    }

    #[test]
    fn ui_urls_include_session_bootstrap() {
        let actual = SocketAddr::from((Ipv4Addr::LOCALHOST, 4321));

        let (url, session_url) = ui_urls(actual);

        assert_eq!(url, "http://127.0.0.1:4321");
        assert_eq!(session_url, "http://127.0.0.1:4321/__raven/session");
    }
}
