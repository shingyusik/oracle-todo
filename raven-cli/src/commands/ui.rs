use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus};
use std::thread::JoinHandle;

use raven_api::{AuthMode, RavenApiConfig};
use time::macros::offset;

use crate::cli::UiArgs;
use crate::config::RavenPaths;

#[derive(Debug, thiserror::Error)]
pub enum UiCommandError {
    #[error("invalid RAVEN_UI_PUBLIC_ORIGIN")]
    PublicOrigin,
}

impl UiCommandError {
    pub fn cli_exit_code(&self) -> i32 {
        match self {
            Self::PublicOrigin => 2,
        }
    }
}

pub fn run(paths: &RavenPaths, args: UiArgs) -> anyhow::Result<()> {
    let ui_path = resolve_ui_path(args.ui_path)?;
    let artifact = raven_api::UiArtifact::load(ui_path)?;
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
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async move {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        let actual = listener.local_addr()?;
        validate_public_origin(public_origin.as_deref(), actual)?;
        let app = raven_api::ui_router(config, artifact, session, actual, public_origin.as_deref())?;
        let (url, session_url) = ui_urls(actual);
        println!("Raven UI listening on {url}");
        println!("Open Raven UI: {session_url}");
        if !args.no_open {
            if let Err(error) = open_browser(&session_url) {
                tracing::warn!(event = "browser_open_failed", %error, "browser could not be opened");
            }
        }
        axum::serve(listener, app).await?;
        anyhow::Ok(())
    })
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
    fn ui_urls_include_session_bootstrap() {
        let actual = SocketAddr::from((Ipv4Addr::LOCALHOST, 4321));

        let (url, session_url) = ui_urls(actual);

        assert_eq!(url, "http://127.0.0.1:4321");
        assert_eq!(session_url, "http://127.0.0.1:4321/__raven/session");
    }
}
