use std::collections::BTreeMap;
use std::io::Read;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use thiserror::Error;

use crate::{RavenApiConfig, ServerBind, UiSessionToken};

const MAX_UI_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_UI_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
const MAX_UI_ENTRIES: usize = 10_000;
const MAX_UI_DEPTH: usize = 64;

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
    artifact: UiArtifact,
    session: UiSessionToken,
    authority: SocketAddr,
) -> anyhow::Result<Router> {
    if !authority.ip().is_loopback() {
        anyhow::bail!("Raven UI authority must be loopback");
    }
    let expected = ExpectedAuthority::new(authority);
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
                .headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response
        }
    };
    let static_files = move |request: Request| serve_static(artifact.clone(), request);

    Ok(Router::new()
        .merge(crate::router(config)?)
        .route("/__raven/session", get(bootstrap))
        .fallback(static_files)
        .layer(middleware::from_fn_with_state(
            expected,
            validate_ui_authority,
        )))
}

#[derive(Clone)]
pub struct UiArtifact(Arc<StaticSnapshot>);

struct StaticSnapshot {
    files: BTreeMap<String, StaticAsset>,
}

#[derive(Clone)]
struct StaticAsset {
    bytes: Bytes,
    content_type: &'static str,
}

impl UiArtifact {
    pub fn load(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let path = path.as_ref();
        let metadata = std::fs::symlink_metadata(path)
            .map_err(|_| anyhow::anyhow!("UI artifact is missing"))?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            anyhow::bail!("UI artifact must be a regular directory");
        }
        let root = path
            .canonicalize()
            .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?;
        let mut files = BTreeMap::new();
        let mut total_bytes = 0_u64;
        let mut entries = 0_usize;
        load_directory(
            &root,
            &root,
            "",
            0,
            &mut entries,
            &mut total_bytes,
            &mut files,
        )?;
        if !files.contains_key("index.html") {
            anyhow::bail!("UI artifact does not contain index.html");
        }
        Ok(Self(Arc::new(StaticSnapshot { files })))
    }
}

fn load_directory(
    root: &Path,
    directory: &Path,
    prefix: &str,
    depth: usize,
    entries: &mut usize,
    total_bytes: &mut u64,
    files: &mut BTreeMap<String, StaticAsset>,
) -> anyhow::Result<()> {
    if depth > MAX_UI_DEPTH {
        anyhow::bail!("UI artifact directory depth exceeds the limit");
    }
    let mut children = std::fs::read_dir(directory)
        .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?;
    children.sort_by_key(std::fs::DirEntry::file_name);

    for child in children {
        *entries += 1;
        if *entries > MAX_UI_ENTRIES {
            anyhow::bail!("UI artifact contains too many entries");
        }
        let name = child
            .file_name()
            .into_string()
            .map_err(|_| anyhow::anyhow!("UI artifact contains a non-UTF-8 name"))?;
        if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
            anyhow::bail!("UI artifact contains an invalid name");
        }
        let key = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        let path = child.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?;
        if metadata.file_type().is_symlink() {
            anyhow::bail!("UI artifact must not contain symlinks");
        }
        if metadata.is_dir() {
            let canonical = path
                .canonicalize()
                .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?;
            if !canonical.starts_with(root) {
                anyhow::bail!("UI artifact entry escapes its root");
            }
            load_directory(
                root,
                &canonical,
                &key,
                depth + 1,
                entries,
                total_bytes,
                files,
            )?;
        } else if metadata.is_file() {
            let length = metadata.len();
            if length > MAX_UI_FILE_BYTES {
                anyhow::bail!("UI artifact file exceeds the size limit");
            }
            let next_total = total_bytes
                .checked_add(length)
                .filter(|value| *value <= MAX_UI_TOTAL_BYTES)
                .ok_or_else(|| anyhow::anyhow!("UI artifact exceeds the total size limit"))?;
            let bytes = read_snapshot_file(&path, root, &metadata)?;
            *total_bytes = next_total;
            files.insert(
                key.clone(),
                StaticAsset {
                    bytes: Bytes::from(bytes),
                    content_type: content_type(Path::new(&key)),
                },
            );
        } else {
            anyhow::bail!("UI artifact contains a non-regular entry");
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReadPhase {
    BeforeOpen,
    AfterOpen,
    AfterRead,
}

fn read_snapshot_file(
    path: &Path,
    root: &Path,
    expected: &std::fs::Metadata,
) -> anyhow::Result<Vec<u8>> {
    read_snapshot_file_with_hook(path, root, expected, |_| {})
}

fn read_snapshot_file_with_hook(
    path: &Path,
    root: &Path,
    expected: &std::fs::Metadata,
    mut hook: impl FnMut(ReadPhase),
) -> anyhow::Result<Vec<u8>> {
    if expected.len() > MAX_UI_FILE_BYTES {
        anyhow::bail!("UI artifact file exceeds the size limit");
    }

    hook(ReadPhase::BeforeOpen);
    let mut file = open_snapshot_file(path)?;
    let opened = opened_file_stamp(&file)?;
    if !expected_matches_opened(expected, opened)? {
        anyhow::bail!("UI artifact changed while loading");
    }

    hook(ReadPhase::AfterOpen);
    let canonical = path
        .canonicalize()
        .map_err(|_| anyhow::anyhow!("UI artifact changed while loading"))?;
    let current = open_snapshot_file(path)?;
    if !canonical.starts_with(root) || opened_file_stamp(&current)? != opened {
        anyhow::bail!("UI artifact changed while loading");
    }

    let mut bytes = Vec::with_capacity(opened.len as usize);
    (&mut file)
        .take(MAX_UI_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?;
    hook(ReadPhase::AfterRead);

    let after = opened_file_stamp(&file)?;
    let path_after = open_snapshot_file(path)?;
    if after != opened
        || opened_file_stamp(&path_after)? != opened
        || bytes.len() as u64 != opened.len
    {
        anyhow::bail!("UI artifact changed while loading");
    }
    Ok(bytes)
}

#[cfg(unix)]
fn open_snapshot_file(path: &Path) -> anyhow::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;

    let flags = rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(flags.bits() as i32)
        .open(path)
        .map_err(|_| anyhow::anyhow!("UI artifact changed while loading"))
}

#[cfg(windows)]
fn open_snapshot_file(path: &Path) -> anyhow::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| anyhow::anyhow!("UI artifact changed while loading"))
}

#[cfg(unix)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileStamp {
    device: u64,
    inode: u64,
    len: u64,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
}

#[cfg(unix)]
fn opened_file_stamp(file: &std::fs::File) -> anyhow::Result<FileStamp> {
    let metadata = file
        .metadata()
        .map_err(|_| anyhow::anyhow!("UI artifact changed while loading"))?;
    unix_file_stamp(&metadata)
}

#[cfg(unix)]
fn expected_matches_opened(
    expected: &std::fs::Metadata,
    opened: FileStamp,
) -> anyhow::Result<bool> {
    Ok(unix_file_stamp(expected)? == opened)
}

#[cfg(unix)]
fn unix_file_stamp(metadata: &std::fs::Metadata) -> anyhow::Result<FileStamp> {
    use std::os::unix::fs::MetadataExt;

    if !metadata.is_file() || metadata.file_type().is_symlink() {
        anyhow::bail!("UI artifact must contain regular files");
    }
    Ok(FileStamp {
        device: metadata.dev(),
        inode: metadata.ino(),
        len: metadata.len(),
        modified_seconds: metadata.mtime(),
        modified_nanoseconds: metadata.mtime_nsec(),
        changed_seconds: metadata.ctime(),
        changed_nanoseconds: metadata.ctime_nsec(),
    })
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileStamp {
    volume: u32,
    index: u64,
    len: u64,
    attributes: u32,
    created: u64,
    modified: u64,
    changed: i64,
}

#[cfg(windows)]
fn opened_file_stamp(file: &std::fs::File) -> anyhow::Result<FileStamp> {
    use std::os::windows::fs::MetadataExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFO, FileBasicInfo,
        GetFileInformationByHandle, GetFileInformationByHandleEx,
    };

    let metadata = file
        .metadata()
        .map_err(|_| anyhow::anyhow!("UI artifact changed while loading"))?;

    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        anyhow::bail!("UI artifact must contain regular non-reparse files");
    }
    let mut identity = BY_HANDLE_FILE_INFORMATION::default();
    let mut basic = FILE_BASIC_INFO::default();
    let handle = file.as_raw_handle() as HANDLE;
    // SAFETY: `file` owns a valid handle and both output buffers live for the calls.
    let identity_ok = unsafe { GetFileInformationByHandle(handle, &mut identity) };
    // SAFETY: `file` owns a valid handle and `basic` has the exact requested layout.
    let basic_ok = unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileBasicInfo,
            std::ptr::addr_of_mut!(basic).cast(),
            std::mem::size_of::<FILE_BASIC_INFO>() as u32,
        )
    };
    if identity_ok == 0 || basic_ok == 0 {
        anyhow::bail!("UI artifact changed while loading");
    }
    Ok(FileStamp {
        volume: identity.dwVolumeSerialNumber,
        index: u64::from(identity.nFileIndexHigh) << 32 | u64::from(identity.nFileIndexLow),
        len: u64::from(identity.nFileSizeHigh) << 32 | u64::from(identity.nFileSizeLow),
        attributes: identity.dwFileAttributes,
        created: filetime(identity.ftCreationTime),
        modified: filetime(identity.ftLastWriteTime),
        changed: basic.ChangeTime,
    })
}

#[cfg(windows)]
fn expected_matches_opened(
    expected: &std::fs::Metadata,
    opened: FileStamp,
) -> anyhow::Result<bool> {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

    if !expected.is_file() || expected.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        anyhow::bail!("UI artifact must contain regular non-reparse files");
    }
    Ok(expected.len() == opened.len
        && expected.file_attributes() == opened.attributes
        && expected.creation_time() == opened.created
        && expected.last_write_time() == opened.modified)
}

#[cfg(windows)]
fn filetime(value: windows_sys::Win32::Foundation::FILETIME) -> u64 {
    u64::from(value.dwHighDateTime) << 32 | u64::from(value.dwLowDateTime)
}

#[derive(Clone)]
struct ExpectedAuthority {
    host: HeaderValue,
    origin: HeaderValue,
}

impl ExpectedAuthority {
    fn new(authority: SocketAddr) -> Self {
        let authority = authority.to_string();
        Self {
            host: HeaderValue::from_str(&authority).expect("socket authority is a valid header"),
            origin: HeaderValue::from_str(&format!("http://{authority}"))
                .expect("socket origin is a valid header"),
        }
    }
}

async fn validate_ui_authority(
    State(expected): State<ExpectedAuthority>,
    request: Request,
    next: Next,
) -> Response {
    let headers = request.headers();
    if exact_header(headers, header::HOST) != Some(expected.host.as_bytes()) {
        return status(StatusCode::MISDIRECTED_REQUEST);
    }
    if let Some(origin) = optional_exact_header(headers, header::ORIGIN) {
        if origin != Some(expected.origin.as_bytes()) {
            return status(StatusCode::MISDIRECTED_REQUEST);
        }
    }
    next.run(request).await
}

fn exact_header(headers: &axum::http::HeaderMap, name: axum::http::HeaderName) -> Option<&[u8]> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    values.next().is_none().then_some(value.as_bytes())
}

fn optional_exact_header(
    headers: &axum::http::HeaderMap,
    name: axum::http::HeaderName,
) -> Option<Option<&[u8]>> {
    let mut values = headers.get_all(name).iter();
    let first = values.next();
    if values.next().is_some() {
        return Some(None);
    }
    first.map(|value| Some(value.as_bytes()))
}

async fn serve_static(artifact: UiArtifact, request: Request) -> Response {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return status(StatusCode::METHOD_NOT_ALLOWED);
    }
    let path = request.uri().path();
    if reserved(path, "/api") || reserved(path, "/__raven") || reserved(path, "/healthz") {
        return status(StatusCode::NOT_FOUND);
    }
    if path.as_bytes().contains(&b'%') || path.as_bytes().contains(&b'\\') {
        return status(StatusCode::BAD_REQUEST);
    }

    let key = path.trim_start_matches('/');
    let key = if key.is_empty() { "index.html" } else { key };
    if key
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return status(StatusCode::BAD_REQUEST);
    }

    let asset = match artifact.0.files.get(key) {
        Some(asset) => asset.clone(),
        None if Path::new(key).extension().is_none() => artifact
            .0
            .files
            .get("index.html")
            .expect("validated UI artifact has index.html")
            .clone(),
        None => return status(StatusCode::NOT_FOUND),
    };
    let mut response = if request.method() == Method::HEAD {
        Response::new(Body::empty())
    } else {
        Response::new(Body::from(asset.bytes.clone()))
    };
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(asset.content_type),
    );
    response.headers_mut().insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&asset.bytes.len().to_string())
            .expect("asset length is a valid header"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn reserved(path: &str, namespace: &str) -> bool {
    path == namespace
        || path
            .strip_prefix(namespace)
            .is_some_and(|suffix| suffix.starts_with('/'))
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn file_fixture() -> (tempfile::TempDir, std::path::PathBuf, std::fs::Metadata) {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("asset.js");
        std::fs::write(&path, b"trusted").unwrap();
        let metadata = std::fs::symlink_metadata(&path).unwrap();
        (temp, path, metadata)
    }

    #[test]
    fn no_follow_open_rejects_a_link_swapped_in_before_open() {
        use std::os::unix::fs::symlink;

        let (temp, path, metadata) = file_fixture();
        let victim = temp.path().join("victim");
        std::fs::write(&victim, b"foreign").unwrap();
        let result = read_snapshot_file_with_hook(&path, temp.path(), &metadata, |phase| {
            if phase == ReadPhase::BeforeOpen {
                std::fs::remove_file(&path).unwrap();
                symlink(&victim, &path).unwrap();
            }
        });
        assert!(result.is_err());
    }

    #[test]
    fn path_double_swap_is_rejected_without_snapshotting_victim_bytes() {
        use std::os::unix::fs::symlink;

        let (temp, path, metadata) = file_fixture();
        let original = temp.path().join("original");
        let victim = temp.path().join("victim");
        std::fs::write(&victim, b"foreign").unwrap();
        let result = read_snapshot_file_with_hook(&path, temp.path(), &metadata, |phase| {
            if phase == ReadPhase::AfterOpen {
                std::fs::rename(&path, &original).unwrap();
                symlink(&victim, &path).unwrap();
                std::fs::remove_file(&path).unwrap();
                std::fs::rename(&original, &path).unwrap();
            }
        });
        assert!(result.is_err());
    }

    #[test]
    fn same_length_mutation_after_open_is_rejected() {
        let (temp, path, metadata) = file_fixture();
        let result = read_snapshot_file_with_hook(&path, temp.path(), &metadata, |phase| {
            if phase == ReadPhase::AfterOpen {
                std::thread::sleep(std::time::Duration::from_millis(2));
                std::fs::write(&path, b"changed").unwrap();
            }
        });
        assert!(result.is_err());
    }
}
