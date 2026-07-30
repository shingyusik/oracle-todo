use std::io::ErrorKind;
use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::Response;
use axum::routing::get;
use thiserror::Error;

use crate::{RavenApiConfig, ServerBind, UiSessionToken};

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

pub fn ui_router(
    config: RavenApiConfig,
    ui_path: impl AsRef<Path>,
    session: UiSessionToken,
) -> anyhow::Result<Router> {
    let root = StaticRoot::new(ui_path.as_ref())?;
    let cookie = HeaderValue::from_str(&format!(
        "raven_session={}; HttpOnly; SameSite=Strict; Path=/",
        session.cookie_value()
    ))?;
    let bootstrap = move || {
        let cookie = cookie.clone();
        async move {
            let mut response = Response::new(Body::empty());
            *response.status_mut() = StatusCode::SEE_OTHER;
            response.headers_mut().insert(header::SET_COOKIE, cookie);
            response
                .headers_mut()
                .insert(header::LOCATION, HeaderValue::from_static("/"));
            response
        }
    };
    let root = Arc::new(root);
    let static_files = move |request: Request| serve_static(root.clone(), request);

    Ok(Router::new()
        .merge(crate::router(config)?)
        .route("/__raven/session", get(bootstrap))
        .fallback(static_files))
}

#[derive(Debug)]
struct StaticRoot {
    canonical: PathBuf,
    index: PathBuf,
}

impl StaticRoot {
    fn new(path: &Path) -> anyhow::Result<Self> {
        let metadata = std::fs::symlink_metadata(path)
            .map_err(|_| anyhow::anyhow!("UI artifact is missing"))?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            anyhow::bail!("UI artifact must be a regular directory");
        }
        let canonical = path
            .canonicalize()
            .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?;
        let index = canonical.join("index.html");
        let index_metadata = std::fs::symlink_metadata(&index)
            .map_err(|_| anyhow::anyhow!("UI artifact does not contain index.html"))?;
        if !index_metadata.file_type().is_file() || index_metadata.file_type().is_symlink() {
            anyhow::bail!("UI artifact index.html must be a regular file");
        }
        Ok(Self { canonical, index })
    }
}

async fn serve_static(root: Arc<StaticRoot>, request: Request) -> Response {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return status(StatusCode::METHOD_NOT_ALLOWED);
    }
    let path = request.uri().path();
    if path.starts_with("/api/") || path.starts_with("/__raven/") || path == "/healthz" {
        return status(StatusCode::NOT_FOUND);
    }
    if path.as_bytes().contains(&b'%') || path.as_bytes().contains(&b'\\') {
        return status(StatusCode::BAD_REQUEST);
    }

    let relative = path.trim_start_matches('/');
    let relative = if relative.is_empty() {
        Path::new("index.html")
    } else {
        Path::new(relative)
    };
    if relative.components().any(|component| {
        !matches!(component, Component::Normal(_))
            || component.as_os_str().is_empty()
            || component.as_os_str() == "."
            || component.as_os_str() == ".."
    }) {
        return status(StatusCode::BAD_REQUEST);
    }

    let requested = root.canonical.join(relative);
    let file = match regular_file_within(&root.canonical, &requested).await {
        Ok(Some(path)) => path,
        Ok(None) if relative.extension().is_none() => root.index.clone(),
        Ok(None) => return status(StatusCode::NOT_FOUND),
        Err(()) => return status(StatusCode::FORBIDDEN),
    };
    let body = match tokio::fs::read(&file).await {
        Ok(body) => body,
        Err(_) => return status(StatusCode::NOT_FOUND),
    };
    let content_type = HeaderValue::from_static(content_type(&file));
    let mut response = if request.method() == Method::HEAD {
        Response::new(Body::empty())
    } else {
        Response::new(Body::from(body))
    };
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, content_type);
    response
}

async fn regular_file_within(root: &Path, path: &Path) -> Result<Option<PathBuf>, ()> {
    let relative = path.strip_prefix(root).map_err(|_| ())?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        match tokio::fs::symlink_metadata(&current).await {
            Ok(metadata) if metadata.file_type().is_symlink() => return Err(()),
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(()),
        }
    }
    let metadata = tokio::fs::metadata(path).await.map_err(|_| ())?;
    if !metadata.is_file() {
        return Ok(None);
    }
    let canonical = tokio::fs::canonicalize(path).await.map_err(|_| ())?;
    canonical
        .starts_with(root)
        .then_some(canonical)
        .ok_or(())
        .map(Some)
}

fn status(value: StatusCode) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = value;
    response
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json" | "map" | "webmanifest") => "application/json",
        Some("txt") => "text/plain; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}
