//! `maintenance/retention.lock`: an advisory exclusive lock held for a whole run.

use std::fs::{File, OpenOptions, TryLockError};

use super::{RetentionError, RetentionPaths, fsutil};

/// Released when dropped (closing the file releases the OS lock).
#[derive(Debug)]
pub(crate) struct RunLock {
    _file: File,
}

/// `Ok(None)` when another process or run holds the lock.
pub(crate) fn try_acquire(paths: &RetentionPaths) -> Result<Option<RunLock>, RetentionError> {
    fsutil::ensure_private_dir(&paths.maintenance_dir()).map_err(|_| RetentionError::Storage)?;
    let path = paths.lock_file();
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&path).map_err(|_| RetentionError::Storage)?;
    match file.try_lock() {
        Ok(()) => Ok(Some(RunLock { _file: file })),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(_)) => Err(RetentionError::Storage),
    }
}
