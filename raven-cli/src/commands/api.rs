use std::env;
use std::net::{IpAddr, SocketAddr};

use raven_api::{AuthMode, RavenApiConfig, ServerBind};
use thiserror::Error;
use time::macros::offset;

use crate::config::RavenPaths;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 3002;

#[derive(Debug, Error)]
pub enum ApiCommandError {
    #[error("API token configuration is invalid")]
    Token(#[source] raven_api::AuthConfigError),
    #[error("RAVEN_API_BIND_HOST must be an IPv4 or IPv6 address")]
    Host,
    #[error("RAVEN_API_BIND_PORT must be an integer from 1 through 65535")]
    Port,
    #[error("RAVEN_API_ALLOW_UNSAFE_CLEARTEXT must be exactly true when set")]
    UnsafeOverride,
    #[error("non-loopback cleartext bind requires RAVEN_API_ALLOW_UNSAFE_CLEARTEXT=true")]
    Bind,
    #[error("Raven API could not start")]
    Server(#[source] anyhow::Error),
}

impl ApiCommandError {
    pub fn cli_exit_code(&self) -> i32 {
        match self {
            Self::Token(_) | Self::Host | Self::Port | Self::UnsafeOverride | Self::Bind => 2,
            Self::Server(_) => 1,
        }
    }
}

pub fn run(paths: &RavenPaths) -> anyhow::Result<()> {
    let token = raven_api::load_bearer_from_env().map_err(ApiCommandError::Token)?;
    let bind = bind_from_env()?;
    let config = RavenApiConfig {
        todo_db: paths.todo_db(),
        ledger_db: paths.ledger_db(),
        health_db: paths.health_db(),
        health_media_dir: paths.health_media_dir(),
        local_offset: offset!(+9),
        auth: AuthMode::bearer(token),
    };

    raven_api::validate_bind(bind.addr, bind.allow_unsafe_cleartext)
        .map_err(|_| ApiCommandError::Bind)?;
    let runtime =
        tokio::runtime::Runtime::new().map_err(|error| ApiCommandError::Server(error.into()))?;
    runtime
        .block_on(async {
            let listener = tokio::net::TcpListener::bind(bind.addr).await?;
            let actual = listener.local_addr()?;
            println!("Raven API listening on http://{actual}");
            raven_api::serve_listener(config, listener, bind.allow_unsafe_cleartext).await
        })
        .map_err(ApiCommandError::Server)?;
    Ok(())
}

fn bind_from_env() -> Result<ServerBind, ApiCommandError> {
    let host = match env::var("RAVEN_API_BIND_HOST") {
        Ok(value) => value.parse::<IpAddr>().map_err(|_| ApiCommandError::Host)?,
        Err(env::VarError::NotPresent) => DEFAULT_HOST.parse().expect("valid default IP"),
        Err(env::VarError::NotUnicode(_)) => return Err(ApiCommandError::Host),
    };
    let port = match env::var("RAVEN_API_BIND_PORT") {
        Ok(value) => value
            .parse::<u16>()
            .ok()
            .filter(|value| *value != 0)
            .ok_or(ApiCommandError::Port)?,
        Err(env::VarError::NotPresent) => DEFAULT_PORT,
        Err(env::VarError::NotUnicode(_)) => return Err(ApiCommandError::Port),
    };
    let allow_unsafe_cleartext = match env::var("RAVEN_API_ALLOW_UNSAFE_CLEARTEXT") {
        Ok(value) if value == "true" => true,
        Ok(_) => return Err(ApiCommandError::UnsafeOverride),
        Err(env::VarError::NotPresent) => false,
        Err(env::VarError::NotUnicode(_)) => return Err(ApiCommandError::UnsafeOverride),
    };
    Ok(ServerBind {
        addr: SocketAddr::new(host, port),
        allow_unsafe_cleartext,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_loopback() {
        // Environment parsing is covered by the process-isolated CLI tests.
        let addr = SocketAddr::new(DEFAULT_HOST.parse().unwrap(), DEFAULT_PORT);
        assert!(addr.ip().is_loopback());
    }
}
