use std::net::{Ipv4Addr, SocketAddr};

use crate::{cli::McpArgs, config::RavenPaths};
use raven_api::{AuthMode, RavenApiConfig, UiSessionToken, mcp::McpAccessConfig};

#[derive(Debug, thiserror::Error)]
pub enum McpCommandError {
    #[error(
        "MCP requires valid public origin, Cloudflare Access issuer and application audience; consult raven mcp --help"
    )]
    Configuration,
    #[error("Raven MCP could not start")]
    Server,
}

impl McpCommandError {
    pub fn cli_exit_code(&self) -> i32 {
        match self {
            Self::Configuration => 2,
            Self::Server => 1,
        }
    }
}

pub fn run(paths: &RavenPaths, args: McpArgs) -> anyhow::Result<()> {
    let access = match (args.public_origin, args.access_issuer, args.access_audience) {
        (Some(origin), Some(issuer), Some(audience)) => {
            raven_api::validate_ui_public_origin(
                &origin,
                SocketAddr::from((Ipv4Addr::LOCALHOST, args.port)),
            )
            .map_err(|_| McpCommandError::Configuration)?;
            McpAccessConfig::new(origin, issuer, audience)
                .map_err(|_| McpCommandError::Configuration)?
        }
        _ => return Err(McpCommandError::Configuration.into()),
    };
    let session = UiSessionToken::generate().map_err(|_| McpCommandError::Server)?;
    let config = RavenApiConfig {
        todo_db: paths.todo_db(),
        ledger_db: paths.ledger_db(),
        health_db: paths.health_db(),
        health_media_dir: paths.health_media_dir(),
        local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
        auth: AuthMode::ui_session(&session),
    };
    let runtime = tokio::runtime::Runtime::new().map_err(|_| McpCommandError::Server)?;
    runtime
        .block_on(async {
            let app = raven_api::mcp::router(config, access).await?;
            let listener =
                tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, args.port)))
                    .await?;
            println!(
                "Raven MCP listening on http://{}/mcp",
                listener.local_addr()?
            );
            axum::serve(listener, app).await?;
            anyhow::Ok(())
        })
        .map_err(|_| McpCommandError::Server)?;
    Ok(())
}
