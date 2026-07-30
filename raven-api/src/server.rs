use std::net::SocketAddr;

use thiserror::Error;

use crate::{RavenApiConfig, ServerBind};

#[derive(Debug, Error)]
#[error("non-loopback cleartext bind requires RAVEN_API_ALLOW_UNSAFE_CLEARTEXT=true")]
pub struct BindError;

pub fn validate_bind(addr: SocketAddr, allow_unsafe: bool) -> Result<(), BindError> {
    if addr.ip().is_loopback() || allow_unsafe {
        Ok(())
    } else {
        Err(BindError)
    }
}

pub async fn serve(config: RavenApiConfig, bind: ServerBind) -> anyhow::Result<()> {
    validate_bind(bind.addr, bind.allow_unsafe_cleartext)?;
    let listener = tokio::net::TcpListener::bind(bind.addr).await?;
    serve_listener(config, listener, bind.allow_unsafe_cleartext).await
}

pub async fn serve_listener(
    config: RavenApiConfig,
    listener: tokio::net::TcpListener,
    allow_unsafe_cleartext: bool,
) -> anyhow::Result<()> {
    validate_bind(listener.local_addr()?, allow_unsafe_cleartext)?;
    let app = crate::router(config)?;
    axum::serve(listener, app).await?;
    Ok(())
}
