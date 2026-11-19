//! Private-file helpers: 0700 directories, 0600 files, atomic replace.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

/// Creates `dir` (and parents) and restricts `dir` itself to the owner.
pub(crate) fn ensure_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    restrict_dir(dir)
}

#[cfg(unix)]
pub(crate) fn restrict_dir(dir: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = fs::symlink_metadata(dir)?;
    if !metadata.is_dir() {
        return Err(io::Error::other("not a directory"));
    }
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
pub(crate) fn restrict_dir(dir: &Path) -> io::Result<()> {
    if fs::symlink_metadata(dir)?.is_dir() {
        Ok(())
    } else {
        Err(io::Error::other("not a directory"))
    }
}

#[cfg(unix)]
pub(crate) fn restrict_file(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
pub(crate) fn restrict_file(_path: &Path) -> io::Result<()> {
    Ok(())
}

/// Opens a new owner-only file; fails if it already exists.
pub(crate) fn create_private_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Writes `bytes` to `path` via a synced temporary sibling and an atomic rename.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::other("file has no parent"))?;
    ensure_private_dir(dir)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::other("invalid file name"))?;
    let temp = dir.join(format!(".{name}.tmp-{}", uuid::Uuid::new_v4().simple()));
    let result = (|| {
        let mut file = create_private_file(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)?;
        sync_dir(dir)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(unix)]
pub(crate) fn sync_dir(dir: &Path) -> io::Result<()> {
    File::open(dir)?.sync_all()
}

#[cfg(not(unix))]
pub(crate) fn sync_dir(_dir: &Path) -> io::Result<()> {
    Ok(())
}

/// Reads a small file; `Ok(None)` when it does not exist.
pub(crate) fn read_optional(path: &Path, max_bytes: u64) -> io::Result<Option<Vec<u8>>> {
    use std::io::Read;
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::new();
    file.take(max_bytes + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_bytes {
        return Err(io::Error::other("file too large"));
    }
    Ok(Some(bytes))
}

/// Bytes available to an unprivileged writer on the filesystem holding `path`
/// (or its nearest existing ancestor).
pub(crate) fn available_space(path: &Path) -> io::Result<u64> {
    let mut probe = path;
    while !probe.exists() {
        probe = probe
            .parent()
            .ok_or_else(|| io::Error::other("no existing ancestor"))?;
    }
    available_space_at(probe)
}

#[cfg(unix)]
fn available_space_at(path: &Path) -> io::Result<u64> {
    let stat = rustix::fs::statvfs(path).map_err(io::Error::from)?;
    Ok(stat.f_bavail.saturating_mul(stat.f_frsize))
}

#[cfg(windows)]
fn available_space_at(path: &Path) -> io::Result<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();
    let mut available = 0_u64;
    // SAFETY: `wide` is NUL-terminated and the output pointer is valid for the call.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(available)
    }
}

#[cfg(not(any(unix, windows)))]
fn available_space_at(_path: &Path) -> io::Result<u64> {
    Err(io::Error::other("free space is unknown on this platform"))
}
