use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus};
use std::thread::JoinHandle;

use raven_api::{AuthMode, RavenApiConfig};
use time::macros::offset;

use crate::cli::UiArgs;
use crate::config::RavenPaths;

pub fn run(paths: &RavenPaths, args: UiArgs) -> anyhow::Result<()> {
    let ui_path = resolve_ui_path(args.ui_path)?;
    let artifact = raven_api::UiArtifact::load(ui_path)?;
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
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, args.port));
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async move {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        let actual = listener.local_addr()?;
        let app = raven_api::ui_router(config, artifact, session, actual, None)?;
        let url = format!("http://{actual}");
        println!("Raven UI listening on {url}");
        if !args.no_open {
            if let Err(error) = open_browser(&format!("{url}/__raven/session")) {
                tracing::warn!(event = "browser_open_failed", %error, "browser could not be opened");
            }
        }
        axum::serve(listener, app).await?;
        anyhow::Ok(())
    })
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
}
