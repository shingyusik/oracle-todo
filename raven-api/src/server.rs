use std::collections::BTreeMap;
use std::io::Read;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use thiserror::Error;

use crate::{RavenApiConfig, ServerBind, UiSessionToken};

const MAX_UI_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_UI_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
const MAX_UI_ENTRIES: usize = 10_000;
const MAX_UI_DEPTH: usize = 64;
const ACCESS_ASSERTION: HeaderName = HeaderName::from_static("cf-access-jwt-assertion");

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
    public_origin: Option<&str>,
) -> anyhow::Result<Router> {
    if !authority.ip().is_loopback() {
        anyhow::bail!("Raven UI authority must be loopback");
    }
    let expected = ExpectedAuthority::new(authority, public_origin)?;
    let local_cookie = session_cookie(&session, false)?;
    let public_cookie = session_cookie(&session, true)?;
    let bootstrap_expected = expected.clone();
    let bootstrap_public_cookie = public_cookie.clone();
    let bootstrap = move |headers: axum::http::HeaderMap| {
        let cookie =
            if bootstrap_expected.public.as_ref().is_some_and(|pair| {
                exact_header(&headers, header::HOST) == Some(pair.host.as_bytes())
            }) {
                bootstrap_public_cookie.clone()
            } else {
                local_cookie.clone()
            };
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
            UiAuthorityState {
                expected,
                public_cookie,
            },
            validate_ui_authority,
        )))
}

fn session_cookie(session: &UiSessionToken, secure: bool) -> anyhow::Result<HeaderValue> {
    let secure = if secure { "; Secure" } else { "" };
    Ok(HeaderValue::from_str(&format!(
        "raven_session={}; HttpOnly; SameSite=Strict{secure}; Path=/",
        session.cookie_value()
    ))?)
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
        #[cfg(unix)]
        let files = load_artifact_unix(path)?;
        #[cfg(windows)]
        let files = load_artifact_windows(path)?;
        if !files.contains_key("index.html") {
            anyhow::bail!("UI artifact does not contain index.html");
        }
        Ok(Self(Arc::new(StaticSnapshot { files })))
    }
}

struct SnapshotBuilder {
    files: BTreeMap<String, StaticAsset>,
    total_bytes: u64,
    entries: usize,
}

impl SnapshotBuilder {
    fn new() -> Self {
        Self {
            files: BTreeMap::new(),
            total_bytes: 0,
            entries: 0,
        }
    }

    fn count_entry(&mut self) -> anyhow::Result<()> {
        self.entries += 1;
        if self.entries > MAX_UI_ENTRIES {
            anyhow::bail!("UI artifact contains too many entries");
        }
        Ok(())
    }

    fn insert(&mut self, key: String, bytes: Vec<u8>) -> anyhow::Result<()> {
        let length = bytes.len() as u64;
        if length > MAX_UI_FILE_BYTES {
            anyhow::bail!("UI artifact file exceeds the size limit");
        }
        self.total_bytes = self
            .total_bytes
            .checked_add(length)
            .filter(|value| *value <= MAX_UI_TOTAL_BYTES)
            .ok_or_else(|| anyhow::anyhow!("UI artifact exceeds the total size limit"))?;
        self.files.insert(
            key.clone(),
            StaticAsset {
                bytes: Bytes::from(bytes),
                content_type: content_type(Path::new(&key)),
            },
        );
        Ok(())
    }
}

fn validate_name(name: &str) -> anyhow::Result<()> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        anyhow::bail!("UI artifact contains an invalid name");
    }
    Ok(())
}

#[cfg(any(windows, test))]
fn normalize_windows_final_path(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

#[cfg(any(windows, test))]
fn windows_path_is_contained(root: &str, candidate: &str) -> bool {
    let root = normalize_windows_final_path(root);
    let candidate = normalize_windows_final_path(candidate);
    candidate == root
        || candidate
            .strip_prefix(&root)
            .is_some_and(|remainder| remainder.starts_with('\\'))
}

#[cfg(unix)]
#[derive(Clone, Debug, PartialEq, Eq)]
enum UnixLoadPhase {
    PathComponentOpening(String),
    ChildOpening(String),
    FileOpened(String),
}

#[cfg(unix)]
fn load_artifact_unix(path: &Path) -> anyhow::Result<BTreeMap<String, StaticAsset>> {
    load_artifact_unix_with_hook(path, |_| {})
}

#[cfg(unix)]
fn load_artifact_unix_with_hook(
    path: &Path,
    mut hook: impl FnMut(UnixLoadPhase),
) -> anyhow::Result<BTreeMap<String, StaticAsset>> {
    use rustix::fs::{Mode, OFlags};
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let components = normalized_unix_components(path)?;
    let anchor = rustix::fs::open(
        Path::new("/"),
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map(std::fs::File::from)
    .map_err(|_| anyhow::anyhow!("UI artifact must be a regular directory"))?;
    let mut capability_chain = vec![anchor];
    for component in components {
        let display = component
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("UI artifact contains a non-UTF-8 name"))?
            .to_owned();
        validate_name(&display)?;
        hook(UnixLoadPhase::PathComponentOpening(display));
        let os_name = CString::new(component.as_bytes())
            .map_err(|_| anyhow::anyhow!("UI artifact contains an invalid name"))?;
        let directory = rustix::fs::openat(
            capability_chain
                .last()
                .expect("filesystem anchor is always retained"),
            os_name.as_c_str(),
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map(std::fs::File::from)
        .map_err(|_| anyhow::anyhow!("UI artifact must be a regular directory"))?;
        capability_chain.push(directory);
    }
    let root = capability_chain
        .last()
        .expect("filesystem anchor is always retained");
    let mut builder = SnapshotBuilder::new();
    load_directory_unix(root, "", 0, &mut builder, &mut hook)?;
    Ok(builder.files)
}

#[cfg(unix)]
fn normalized_unix_components(path: &Path) -> anyhow::Result<Vec<std::ffi::OsString>> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|_| anyhow::anyhow!("UI artifact path is unreadable"))?
            .join(path)
    };
    let mut normalized = Vec::new();
    let mut rooted = false;
    for component in absolute.components() {
        match component {
            std::path::Component::RootDir => rooted = true,
            std::path::Component::CurDir => {}
            std::path::Component::Normal(value) => normalized.push(value.to_os_string()),
            std::path::Component::ParentDir => {
                if normalized.pop().is_none() {
                    anyhow::bail!("UI artifact path escapes the filesystem root");
                }
            }
            std::path::Component::Prefix(_) => {
                anyhow::bail!("UI artifact path has an unsupported prefix");
            }
        }
    }
    if !rooted {
        anyhow::bail!("UI artifact path is not absolute");
    }
    Ok(normalized)
}

#[cfg(unix)]
fn load_directory_unix(
    directory: &std::fs::File,
    prefix: &str,
    depth: usize,
    builder: &mut SnapshotBuilder,
    hook: &mut impl FnMut(UnixLoadPhase),
) -> anyhow::Result<()> {
    use rustix::fs::{Mode, OFlags};
    use std::ffi::CString;

    if depth > MAX_UI_DEPTH {
        anyhow::bail!("UI artifact directory depth exceeds the limit");
    }
    let mut children = rustix::fs::Dir::read_from(directory)
        .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?
        .filter_map(|entry| match entry {
            Ok(entry)
                if entry.file_name().to_bytes() == b"."
                    || entry.file_name().to_bytes() == b".." =>
            {
                None
            }
            other => Some(other),
        })
        .map(|entry| {
            let entry = entry.map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?;
            let bytes = entry.file_name().to_bytes();
            let name = std::str::from_utf8(bytes)
                .map_err(|_| anyhow::anyhow!("UI artifact contains a non-UTF-8 name"))?
                .to_owned();
            validate_name(&name)?;
            let os_name = CString::new(bytes)
                .map_err(|_| anyhow::anyhow!("UI artifact contains an invalid name"))?;
            Ok((name, os_name))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    children.sort_by(|left, right| left.0.cmp(&right.0));

    for (name, os_name) in children {
        builder.count_entry()?;
        let key = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        hook(UnixLoadPhase::ChildOpening(key.clone()));
        let child = rustix::fs::openat(
            directory,
            os_name.as_c_str(),
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::empty(),
        )
        .map(std::fs::File::from)
        .map_err(|_| anyhow::anyhow!("UI artifact changed while loading"))?;
        let metadata = child
            .metadata()
            .map_err(|_| anyhow::anyhow!("UI artifact changed while loading"))?;
        if metadata.is_dir() {
            load_directory_unix(&child, &key, depth + 1, builder, hook)?;
        } else if metadata.is_file() {
            let opened = opened_file_stamp(&child)?;
            if opened.len > MAX_UI_FILE_BYTES {
                anyhow::bail!("UI artifact file exceeds the size limit");
            }
            hook(UnixLoadPhase::FileOpened(key.clone()));
            let bytes = read_opened_unix_file(child, opened)?;
            builder.insert(key, bytes)?;
        } else {
            anyhow::bail!("UI artifact contains a non-regular entry");
        }
    }
    Ok(())
}

#[cfg(unix)]
fn read_opened_unix_file(mut file: std::fs::File, opened: FileStamp) -> anyhow::Result<Vec<u8>> {
    let mut bytes = Vec::with_capacity(opened.len as usize);
    (&mut file)
        .take(MAX_UI_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?;
    let after = opened_file_stamp(&file)?;
    if after != opened || bytes.len() as u64 != opened.len {
        anyhow::bail!("UI artifact changed while loading");
    }
    Ok(bytes)
}

#[cfg(windows)]
fn load_artifact_windows(path: &Path) -> anyhow::Result<BTreeMap<String, StaticAsset>> {
    let (mut current_path, components) = normalized_windows_components(path)?;
    let anchor = open_windows_entry(&current_path)?;
    ensure_windows_directory(&anchor)?;
    let anchor_final_path = final_windows_path(&anchor)?;
    let mut capability_chain = vec![anchor];
    for component in components {
        current_path.push(component);
        let directory = open_windows_entry(&current_path)?;
        ensure_windows_directory(&directory)?;
        ensure_windows_contained(&directory, &anchor_final_path)?;
        let _identity = opened_windows_handle_stamp(&directory)?;
        capability_chain.push(directory);
    }
    let root = capability_chain
        .last()
        .expect("drive root anchor is always retained");
    let root_path = final_windows_path(&root)?;
    let mut builder = SnapshotBuilder::new();
    load_directory_windows(&current_path, root, &root_path, "", 0, &mut builder)?;
    Ok(builder.files)
}

#[cfg(windows)]
fn normalized_windows_components(
    path: &Path,
) -> anyhow::Result<(std::path::PathBuf, Vec<std::ffi::OsString>)> {
    use std::path::{Component, Prefix};

    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|_| anyhow::anyhow!("UI artifact path is unreadable"))?
            .join(path)
    };
    let mut drive = None;
    let mut rooted = false;
    let mut normalized = Vec::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(prefix) => match prefix.kind() {
                Prefix::Disk(value) if drive.is_none() => drive = Some(value),
                _ => anyhow::bail!("UI artifact path has an unsupported Windows prefix"),
            },
            Component::RootDir => rooted = true,
            Component::CurDir => {}
            Component::Normal(value) => normalized.push(value.to_os_string()),
            Component::ParentDir => {
                if normalized.pop().is_none() {
                    anyhow::bail!("UI artifact path escapes the drive root");
                }
            }
        }
    }
    let drive = drive.ok_or_else(|| anyhow::anyhow!("UI artifact path has no local drive"))?;
    if !rooted {
        anyhow::bail!("UI artifact path is not drive-absolute");
    }
    let drive_root = std::path::PathBuf::from(format!("{}:\\", char::from(drive)));
    Ok((drive_root, normalized))
}

#[cfg(windows)]
fn open_windows_entry(path: &Path) -> anyhow::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .map_err(|_| anyhow::anyhow!("UI artifact changed while loading"))
}

#[cfg(windows)]
fn load_directory_windows(
    directory_path: &Path,
    _directory_guard: &std::fs::File,
    root_final_path: &str,
    prefix: &str,
    depth: usize,
    builder: &mut SnapshotBuilder,
) -> anyhow::Result<()> {
    if depth > MAX_UI_DEPTH {
        anyhow::bail!("UI artifact directory depth exceeds the limit");
    }
    let mut children = std::fs::read_dir(directory_path)
        .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?;
    children.sort_by_key(std::fs::DirEntry::file_name);

    for child in children {
        builder.count_entry()?;
        let name = child
            .file_name()
            .into_string()
            .map_err(|_| anyhow::anyhow!("UI artifact contains a non-UTF-8 name"))?;
        validate_name(&name)?;
        let key = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        let child_path = child.path();
        let mut handle = open_windows_entry(&child_path)?;
        ensure_windows_contained(&handle, root_final_path)?;
        let metadata = handle
            .metadata()
            .map_err(|_| anyhow::anyhow!("UI artifact changed while loading"))?;
        ensure_windows_not_reparse(&metadata)?;
        if metadata.is_dir() {
            load_directory_windows(
                &child_path,
                &handle,
                root_final_path,
                &key,
                depth + 1,
                builder,
            )?;
        } else if metadata.is_file() {
            let opened = opened_windows_handle_stamp(&handle)?;
            if opened.len > MAX_UI_FILE_BYTES {
                anyhow::bail!("UI artifact file exceeds the size limit");
            }
            let mut bytes = Vec::with_capacity(opened.len as usize);
            (&mut handle)
                .take(MAX_UI_FILE_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?;
            if opened_windows_handle_stamp(&handle)? != opened || bytes.len() as u64 != opened.len {
                anyhow::bail!("UI artifact changed while loading");
            }
            builder.insert(key, bytes)?;
        } else {
            anyhow::bail!("UI artifact contains a non-regular entry");
        }
    }
    Ok(())
}

#[cfg(windows)]
fn ensure_windows_directory(file: &std::fs::File) -> anyhow::Result<()> {
    let metadata = file
        .metadata()
        .map_err(|_| anyhow::anyhow!("UI artifact is unreadable"))?;
    ensure_windows_not_reparse(&metadata)?;
    if !metadata.is_dir() {
        anyhow::bail!("UI artifact must be a regular directory");
    }
    Ok(())
}

#[cfg(windows)]
fn ensure_windows_not_reparse(metadata: &std::fs::Metadata) -> anyhow::Result<()> {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        anyhow::bail!("UI artifact must not contain reparse points");
    }
    Ok(())
}

#[cfg(windows)]
fn final_windows_path(file: &std::fs::File) -> anyhow::Result<String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_NAME_NORMALIZED, GetFinalPathNameByHandleW, VOLUME_NAME_DOS,
    };

    let handle = file.as_raw_handle() as HANDLE;
    let mut buffer = vec![0_u16; 512];
    loop {
        // SAFETY: `file` owns a valid handle and the buffer is writable for its full length.
        let length = unsafe {
            GetFinalPathNameByHandleW(
                handle,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
            )
        };
        if length == 0 {
            anyhow::bail!("UI artifact changed while loading");
        }
        if length < buffer.len() as u32 {
            let path = String::from_utf16_lossy(&buffer[..length as usize]);
            return Ok(normalize_windows_final_path(&path));
        }
        buffer.resize(length as usize + 1, 0);
    }
}

#[cfg(windows)]
fn ensure_windows_contained(file: &std::fs::File, root: &str) -> anyhow::Result<()> {
    let child = final_windows_path(file)?;
    if !windows_path_is_contained(root, &child) {
        anyhow::bail!("UI artifact entry escapes its root");
    }
    Ok(())
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
fn opened_windows_handle_stamp(file: &std::fs::File) -> anyhow::Result<FileStamp> {
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

    ensure_windows_not_reparse(&metadata)?;
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
fn filetime(value: windows_sys::Win32::Foundation::FILETIME) -> u64 {
    u64::from(value.dwHighDateTime) << 32 | u64::from(value.dwLowDateTime)
}

#[derive(Clone)]
struct AuthorityPair {
    host: HeaderValue,
    origin: HeaderValue,
    public: bool,
}

#[derive(Clone)]
struct ExpectedAuthority {
    local: AuthorityPair,
    public: Option<AuthorityPair>,
}

#[derive(Clone)]
struct UiAuthorityState {
    expected: ExpectedAuthority,
    public_cookie: HeaderValue,
}

impl ExpectedAuthority {
    fn new(authority: SocketAddr, public_origin: Option<&str>) -> anyhow::Result<Self> {
        let authority = authority.to_string();
        let local = AuthorityPair {
            host: HeaderValue::from_str(&authority).expect("socket authority is a valid header"),
            origin: HeaderValue::from_str(&format!("http://{authority}"))
                .expect("socket origin is a valid header"),
            public: false,
        };
        let public = public_origin.map(parse_public_authority).transpose()?;
        Ok(Self { local, public })
    }
}

fn parse_public_authority(public_origin: &str) -> anyhow::Result<AuthorityPair> {
    let invalid = || anyhow::anyhow!("invalid RAVEN_UI_PUBLIC_ORIGIN");
    if public_origin.contains('#') {
        return Err(invalid());
    }
    let uri: Uri = public_origin.parse().map_err(|_| invalid())?;
    let authority = uri.authority().ok_or_else(invalid)?;
    if uri.scheme_str() != Some("https")
        || authority.as_str().contains('@')
        || uri.path() != "/"
        || uri.query().is_some()
    {
        return Err(invalid());
    }
    let authority = authority.as_str();
    Ok(AuthorityPair {
        host: HeaderValue::from_str(authority).map_err(|_| invalid())?,
        origin: HeaderValue::from_str(&format!("https://{authority}")).map_err(|_| invalid())?,
        public: true,
    })
}

impl ExpectedAuthority {
    fn resolve(&self, host: &[u8]) -> Option<&AuthorityPair> {
        if host == self.local.host.as_bytes() {
            Some(&self.local)
        } else {
            self.public
                .as_ref()
                .filter(|pair| host == pair.host.as_bytes())
        }
    }
}

async fn validate_ui_authority(
    State(state): State<UiAuthorityState>,
    request: Request,
    next: Next,
) -> Response {
    let headers = request.headers();
    let Some(authority) =
        exact_header(headers, header::HOST).and_then(|host| state.expected.resolve(host))
    else {
        return status(StatusCode::MISDIRECTED_REQUEST);
    };
    if let Some(origin) = optional_exact_header(headers, header::ORIGIN) {
        if origin != Some(authority.origin.as_bytes()) {
            return status(StatusCode::MISDIRECTED_REQUEST);
        }
    }
    if authority.public
        && !matches!(exact_header(headers, ACCESS_ASSERTION), Some(assertion) if !assertion.is_empty())
    {
        return status(StatusCode::MISDIRECTED_REQUEST);
    }
    let public_html_get = authority.public && request.method() == Method::GET;
    let mut response = next.run(request).await;
    if public_html_get
        && response.status().is_success()
        && response.headers().get(header::CONTENT_TYPE)
            == Some(&HeaderValue::from_static("text/html; charset=utf-8"))
    {
        response
            .headers_mut()
            .insert(header::SET_COOKIE, state.public_cookie);
    }
    response
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

    fn artifact_fixture() -> (tempfile::TempDir, std::path::PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("ui");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("index.html"), b"trusted").unwrap();
        (temp, root)
    }

    #[test]
    fn unix_component_normalization_resolves_relative_parent_components() {
        let current = std::env::current_dir().unwrap();
        let expected = normalized_unix_components(&current.join("nested/../ui")).unwrap();
        let actual = normalized_unix_components(Path::new("./ui")).unwrap();
        assert_eq!(actual, expected);
    }

    #[test]
    fn unix_component_normalization_rejects_parent_above_root() {
        assert!(normalized_unix_components(Path::new("/../../ui")).is_err());
    }

    #[test]
    fn root_symlink_swap_is_rejected_during_root_open() {
        use std::os::unix::fs::symlink;

        let (temp, root) = artifact_fixture();
        let original = temp.path().join("original");
        let victim = temp.path().join("victim");
        std::fs::create_dir(&victim).unwrap();
        std::fs::write(victim.join("index.html"), b"foreign").unwrap();
        let result = load_artifact_unix_with_hook(&root, |phase| {
            if phase == UnixLoadPhase::PathComponentOpening("ui".into()) {
                std::fs::rename(&root, &original).unwrap();
                symlink(&victim, &root).unwrap();
            }
        });
        assert!(result.is_err());
    }

    #[test]
    fn ancestor_symlink_swap_is_rejected_during_capability_walk() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let temp_path = temp.path().canonicalize().unwrap();
        let container = temp_path.join("container");
        let root = container.join("ui");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("index.html"), b"trusted").unwrap();
        let original = temp_path.join("container-original");
        let victim = temp_path.join("victim");
        std::fs::create_dir_all(victim.join("ui")).unwrap();
        std::fs::write(victim.join("ui/index.html"), b"foreign").unwrap();

        let result = load_artifact_unix_with_hook(&root, |phase| {
            if phase == UnixLoadPhase::PathComponentOpening("container".into()) {
                std::fs::rename(&container, &original).unwrap();
                symlink(&victim, &container).unwrap();
            }
        });
        assert!(result.is_err());
    }

    #[test]
    fn parent_component_symlink_swap_is_rejected_during_child_open() {
        use std::os::unix::fs::symlink;

        let (temp, root) = artifact_fixture();
        let nested = root.join("assets");
        std::fs::create_dir(&nested).unwrap();
        std::fs::write(nested.join("app.js"), b"trusted").unwrap();
        let original = root.join("assets-original");
        let victim = temp.path().join("victim");
        std::fs::create_dir(&victim).unwrap();
        std::fs::write(victim.join("app.js"), b"foreign").unwrap();
        let result = load_artifact_unix_with_hook(&root, |phase| {
            if phase == UnixLoadPhase::ChildOpening("assets".into()) {
                std::fs::rename(&nested, &original).unwrap();
                symlink(&victim, &nested).unwrap();
            }
        });
        assert!(result.is_err());
    }

    #[test]
    fn same_length_mutation_after_open_is_rejected() {
        let (_temp, root) = artifact_fixture();
        let path = root.join("index.html");
        let result = load_artifact_unix_with_hook(&root, |phase| {
            if phase == UnixLoadPhase::FileOpened("index.html".into()) {
                std::thread::sleep(std::time::Duration::from_millis(2));
                std::fs::write(&path, b"changed").unwrap();
            }
        });
        assert!(result.is_err());
    }
}

#[cfg(all(test, windows))]
mod windows_path_tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn local_drive_components_are_lexically_normalized() {
        let (root, components) =
            normalized_windows_components(Path::new(r"C:\safe\.\nested\..\ui")).unwrap();
        assert_eq!(root, Path::new(r"C:\"));
        assert_eq!(
            components,
            vec![OsString::from("safe"), OsString::from("ui")]
        );
    }

    #[test]
    fn unc_device_and_parent_escape_paths_are_rejected() {
        assert!(normalized_windows_components(Path::new(r"\\server\share\ui")).is_err());
        assert!(normalized_windows_components(Path::new(r"\\?\C:\ui")).is_err());
        assert!(normalized_windows_components(Path::new(r"C:\..\ui")).is_err());
    }

    #[test]
    fn relative_paths_resolve_from_a_local_drive_current_directory() {
        let (root, components) = normalized_windows_components(Path::new(r".\ui")).unwrap();
        assert!(root.has_root());
        assert_eq!(components.last(), Some(&OsString::from("ui")));
    }
}

#[cfg(test)]
mod windows_containment_tests {
    use super::*;

    #[test]
    fn volume_root_contains_its_first_component() {
        assert!(windows_path_is_contained(r"\\?\C:\", r"\\?\C:\Users"));
    }

    #[test]
    fn sibling_prefix_is_not_contained() {
        assert!(!windows_path_is_contained(r"\\?\C:\foo", r"\\?\C:\foobar"));
    }

    #[test]
    fn containment_is_case_insensitive() {
        assert!(windows_path_is_contained(
            r"\\?\C:\USERS",
            r"\\?\c:\users\Raven"
        ));
    }

    #[test]
    fn nested_child_is_contained() {
        assert!(windows_path_is_contained(
            r"\\?\C:\Users",
            r"\\?\C:\Users\Raven\ui"
        ));
    }
}
