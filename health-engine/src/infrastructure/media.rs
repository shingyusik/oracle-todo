use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::application::error::{HealthError, HealthResult};
use crate::application::media::{
    DEFAULT_MAX_MEDIA_BYTES, MediaRecovery, MediaStore, StoredMedia, invalid_media_relative_path,
    validate_media_relative_path,
};

#[cfg(unix)]
const MAX_TEMP_NAME_ATTEMPTS: usize = 8;
const MAX_RECOVERY_JOURNAL_BYTES: u64 = 4096;

#[derive(Debug)]
pub struct LocalMediaStore {
    #[cfg_attr(any(unix, windows), allow(dead_code))]
    root: PathBuf,
    max_bytes: u64,
    #[cfg(any(unix, windows))]
    directory: Arc<File>,
}

impl LocalMediaStore {
    pub fn new(root: impl AsRef<Path>) -> HealthResult<Self> {
        Self::with_limit(root, DEFAULT_MAX_MEDIA_BYTES)
    }

    pub fn with_limit(root: impl AsRef<Path>, max_bytes: u64) -> HealthResult<Self> {
        validate_max_bytes(max_bytes)?;
        #[cfg(unix)]
        let (root, directory) = prepare_root_unix_with_hook(root.as_ref(), |_| {})?;
        #[cfg(windows)]
        let (root, directory) = prepare_root_windows(root.as_ref())?;
        #[cfg(any(unix, windows))]
        let directory = Arc::new(directory);
        #[cfg(not(any(unix, windows)))]
        let root = prepare_root_unsupported(root.as_ref())?;
        Ok(Self {
            root,
            max_bytes,
            #[cfg(any(unix, windows))]
            directory,
        })
    }

    pub const fn max_bytes(&self) -> u64 {
        self.max_bytes
    }

    pub fn list_recoveries(&self) -> HealthResult<Vec<MediaRecovery>> {
        #[cfg(unix)]
        {
            list_recoveries_unix(&self.directory)
        }
        #[cfg(windows)]
        {
            list_recoveries_windows(&self.root, &self.directory)
        }
        #[cfg(not(any(unix, windows)))]
        {
            list_recoveries_unsupported(&self.root)
        }
    }
}

fn decode_recovery(name: &str, bytes: &[u8]) -> HealthResult<MediaRecovery> {
    if bytes.len() as u64 > MAX_RECOVERY_JOURNAL_BYTES {
        return Err(HealthError::Storage(
            "media recovery journal exceeds the size limit".to_string(),
        ));
    }
    let recovery: MediaRecovery = serde_json::from_slice(bytes)
        .map_err(|_| HealthError::Storage("invalid media recovery journal".to_string()))?;
    recovery.validate()?;
    if recovery.journal_name() != Path::new(name) {
        return Err(HealthError::Storage(
            "media recovery journal name does not match its contents".to_string(),
        ));
    }
    Ok(recovery)
}

#[cfg(unix)]
fn list_recoveries_unix(directory: &File) -> HealthResult<Vec<MediaRecovery>> {
    let entries = rustix::fs::Dir::read_from(directory).map_err(|error| {
        media_storage_error(
            "could not open media recoveries",
            &std::io::Error::from(error),
        )
    })?;
    let mut recoveries = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            media_storage_error(
                "could not list media recoveries",
                &std::io::Error::from(error),
            )
        })?;
        let Ok(name) = entry.file_name().to_str() else {
            continue;
        };
        if !name.starts_with(".raven-recovery-") || !name.ends_with(".json") {
            continue;
        }
        let descriptor = rustix::fs::openat(
            directory,
            entry.file_name(),
            rustix::fs::OFlags::RDONLY | rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )
        .map_err(|error| {
            media_storage_error(
                "could not safely open media recovery",
                &std::io::Error::from(error),
            )
        })?;
        let metadata = rustix::fs::fstat(&descriptor).map_err(|error| {
            media_storage_error(
                "could not inspect media recovery",
                &std::io::Error::from(error),
            )
        })?;
        if rustix::fs::FileType::from_raw_mode(metadata.st_mode)
            != rustix::fs::FileType::RegularFile
        {
            return Err(HealthError::Storage(
                "media recovery journal must be a regular file".to_string(),
            ));
        }
        let mut bytes = Vec::new();
        File::from(descriptor)
            .take(MAX_RECOVERY_JOURNAL_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| media_storage_error("could not read media recovery", &error))?;
        recoveries.push(decode_recovery(name, &bytes)?);
    }
    recoveries.sort_by(|left, right| left.media_id().cmp(right.media_id()));
    Ok(recoveries)
}

#[cfg(windows)]
fn list_recoveries_windows(root: &Path, directory: &File) -> HealthResult<Vec<MediaRecovery>> {
    let _root_guard = lock_root_windows(root, directory)?;
    let mut recoveries = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|error| media_storage_error("could not list media recoveries", &error))?
    {
        let entry =
            entry.map_err(|error| media_storage_error("could not read media recovery", &error))?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !name.starts_with(".raven-recovery-") || !name.ends_with(".json") {
            continue;
        }
        let file = open_regular_windows(&entry.path(), "media recovery journal")?;
        let mut bytes = Vec::new();
        std::io::Read::take(file, MAX_RECOVERY_JOURNAL_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| media_storage_error("could not read media recovery", &error))?;
        recoveries.push(decode_recovery(name, &bytes)?);
    }
    recoveries.sort_by(|left, right| left.media_id().cmp(right.media_id()));
    Ok(recoveries)
}

#[cfg(not(any(unix, windows)))]
fn list_recoveries_unsupported(_root: &Path) -> HealthResult<Vec<MediaRecovery>> {
    Err(HealthError::Storage(
        "secure media recovery requires directory-handle support on this platform".to_string(),
    ))
}

#[cfg(unix)]
#[must_use = "staged media must be finalized or explicitly aborted"]
#[derive(Debug)]
pub struct LocalStagedMedia {
    directory: Arc<File>,
    temporary_name: String,
    stored: StoredMedia,
    recovery: MediaRecovery,
    finalized: bool,
}

impl LocalStagedMedia {
    pub fn relative_path(&self) -> &Path {
        &self.stored.relative_path
    }
}

#[cfg(unix)]
impl Drop for LocalStagedMedia {
    fn drop(&mut self) {
        if !self.finalized
            && matches!(
                rustix::fs::unlinkat(
                    &*self.directory,
                    self.temporary_name.as_str(),
                    rustix::fs::AtFlags::empty(),
                ),
                Ok(()) | Err(rustix::io::Errno::NOENT)
            )
        {
            let _ = unlink_recovery_unix(&self.directory, &self.recovery);
        }
    }
}

#[cfg(not(unix))]
impl Drop for LocalStagedMedia {
    fn drop(&mut self) {
        let Some(temporary) = self.temporary.take() else {
            return;
        };
        if temporary.close().is_ok() {
            if let Ok(root) = staged_root_portable(self) {
                let _ = remove_recovery_portable(&root, &self.recovery);
            }
        }
    }
}

#[cfg(unix)]
fn remove_staged_unix(staged: &mut LocalStagedMedia) -> HealthResult<()> {
    match rustix::fs::unlinkat(
        &*staged.directory,
        staged.temporary_name.as_str(),
        rustix::fs::AtFlags::empty(),
    ) {
        Ok(()) | Err(rustix::io::Errno::NOENT) => {
            staged.finalized = true;
            unlink_recovery_unix(&staged.directory, &staged.recovery)
        }
        Err(error) => Err(HealthError::Cleanup {
            primary: Box::new(HealthError::Storage(
                "could not cancel staged media".to_string(),
            )),
            cleanup: safe_io_summary(&std::io::Error::from(error)),
            recovery: Some(Box::new(staged.recovery.clone())),
            cleanup_path: Some(Box::new(PathBuf::from(&staged.temporary_name))),
        }),
    }
}

#[cfg(not(unix))]
#[must_use = "staged media must be finalized or explicitly aborted"]
#[derive(Debug)]
pub struct LocalStagedMedia {
    root: PathBuf,
    #[cfg(windows)]
    directory: Arc<File>,
    temporary: Option<tempfile::NamedTempFile>,
    stored: StoredMedia,
    recovery: MediaRecovery,
}

impl MediaStore for LocalMediaStore {
    type Staged = LocalStagedMedia;

    fn stage(&self, content_type: &str, bytes: &[u8]) -> HealthResult<Self::Staged> {
        let byte_size = u64::try_from(bytes.len()).map_err(|_| HealthError::MediaTooLarge)?;
        if byte_size > self.max_bytes {
            return Err(HealthError::MediaTooLarge);
        }
        let format = ImageFormat::detect(content_type, bytes)?;
        let id = Uuid::new_v4().to_string();
        let relative_path = PathBuf::from(format!("{id}.{}", format.extension()));
        let checksum_sha256 = format!("{:x}", Sha256::digest(bytes));
        let stored = StoredMedia {
            id,
            relative_path,
            mime_type: format.mime_type().to_string(),
            byte_size,
            checksum_sha256,
            recovery_staged_path: None,
        };
        self.stage_bytes(bytes, stored)
    }

    fn finalize(&self, mut staged: Self::Staged) -> HealthResult<StoredMedia> {
        #[cfg(unix)]
        {
            if !Arc::ptr_eq(&self.directory, &staged.directory) {
                let recovery = staged.recovery.clone();
                let primary = HealthError::Validation {
                    field: "media.staged",
                    message: "belongs to a different media store".to_string(),
                };
                return Err(cleanup_staged_unix(&mut staged, primary, Some(&recovery)));
            }
            let recovery = staged.recovery.clone();
            let result = atomic_finalize_unix(
                &self.directory,
                &staged.temporary_name,
                staged
                    .stored
                    .relative_path
                    .to_str()
                    .ok_or_else(invalid_relative_path)?,
                &recovery,
            );
            if let Err(primary) = result {
                return Err(cleanup_staged_unix(&mut staged, primary, Some(&recovery)));
            }
            staged.finalized = true;
            if let Err(error) = self.directory.sync_all() {
                let primary = media_storage_error("could not sync the media directory", &error);
                return Err(cleanup_finalized_unix(&staged, primary, &recovery));
            }
            Ok(staged.stored.clone())
        }

        #[cfg(not(unix))]
        {
            #[cfg(windows)]
            if !Arc::ptr_eq(&self.directory, &staged.directory) {
                return Err(cleanup_staged_portable(
                    &mut staged,
                    HealthError::Validation {
                        field: "media.staged",
                        message: "belongs to a different media store".to_string(),
                    },
                ));
            }
            #[cfg(windows)]
            let _root_guard = lock_root_windows(&self.root, &self.directory)?;
            if self.root != staged.root {
                return Err(HealthError::Validation {
                    field: "media.staged",
                    message: "belongs to a different media store".to_string(),
                });
            }
            let recovery = staged.recovery.clone();
            let target = self.root.join(&staged.stored.relative_path);
            let temporary = staged
                .temporary
                .take()
                .ok_or_else(|| HealthError::Storage("staged media is unavailable".to_string()))?;
            match temporary.persist_noclobber(&target) {
                Ok(file) => {
                    if let Err(error) = file.sync_all() {
                        drop(file);
                        let primary = media_storage_error("could not sync finalized media", &error);
                        return Err(match fs::remove_file(&target) {
                            Ok(()) => primary,
                            Err(cleanup) if cleanup.kind() == std::io::ErrorKind::NotFound => {
                                primary
                            }
                            Err(cleanup) => HealthError::Cleanup {
                                primary: Box::new(primary),
                                cleanup: safe_io_summary(&cleanup),
                                recovery: Some(Box::new(recovery.clone())),
                                cleanup_path: Some(Box::new(staged.stored.relative_path.clone())),
                            },
                        });
                    }
                    Ok(staged.stored.clone())
                }
                Err(error) => {
                    let tempfile::PersistError { error, file } = error;
                    let primary = if error.kind() == std::io::ErrorKind::AlreadyExists {
                        HealthError::Conflict("generated media path already exists".to_string())
                    } else {
                        media_storage_error("could not atomically finalize staged media", &error)
                    };
                    let cleanup_path = file.path().to_path_buf();
                    match file.close() {
                        Ok(()) => match remove_recovery_portable(&self.root, &recovery) {
                            Ok(()) => Err(primary),
                            Err(cleanup) => Err(HealthError::Cleanup {
                                primary: Box::new(primary),
                                cleanup: safe_error_text(&cleanup),
                                recovery: Some(Box::new(recovery.clone())),
                                cleanup_path: Some(Box::new(cleanup_path)),
                            }),
                        },
                        Err(cleanup) => Err(HealthError::Cleanup {
                            primary: Box::new(primary),
                            cleanup: safe_io_summary(&cleanup),
                            recovery: Some(Box::new(recovery.clone())),
                            cleanup_path: Some(Box::new(cleanup_path)),
                        }),
                    }
                }
            }
        }
    }

    fn abort(&self, mut staged: Self::Staged) -> HealthResult<()> {
        #[cfg(unix)]
        {
            if !Arc::ptr_eq(&self.directory, &staged.directory) {
                let recovery = staged.recovery.clone();
                return Err(cleanup_staged_unix(
                    &mut staged,
                    HealthError::Validation {
                        field: "media.staged",
                        message: "belongs to a different media store".to_string(),
                    },
                    Some(&recovery),
                ));
            }
            abort_staged_unix(&mut staged)
        }
        #[cfg(not(unix))]
        {
            #[cfg(windows)]
            if !Arc::ptr_eq(&self.directory, &staged.directory) {
                return Err(cleanup_staged_portable(
                    &mut staged,
                    HealthError::Validation {
                        field: "media.staged",
                        message: "belongs to a different media store".to_string(),
                    },
                ));
            }
            #[cfg(windows)]
            let _root_guard = lock_root_windows(&self.root, &self.directory)?;
            if self.root != staged.root {
                return Err(HealthError::Validation {
                    field: "media.staged",
                    message: "belongs to a different media store".to_string(),
                });
            }
            let temporary = staged
                .temporary
                .take()
                .ok_or_else(|| HealthError::Storage("staged media is unavailable".to_string()))?;
            let cleanup_path = temporary.path().to_path_buf();
            match temporary.close() {
                Ok(()) => {
                    remove_recovery_portable(&staged_root_portable(&staged)?, &staged.recovery)
                }
                Err(error) => Err(HealthError::Cleanup {
                    primary: Box::new(HealthError::Storage(
                        "could not cancel staged media".to_string(),
                    )),
                    cleanup: safe_io_summary(&error),
                    recovery: Some(Box::new(staged.recovery.clone())),
                    cleanup_path: Some(Box::new(cleanup_path)),
                }),
            }
        }
    }

    fn confirm(&self, stored: &StoredMedia) -> HealthResult<()> {
        let recovery = MediaRecovery::for_media(stored);
        #[cfg(unix)]
        {
            unlink_recovery_unix(&self.directory, &recovery)?;
            self.directory.sync_all().map_err(|error| {
                media_storage_error("could not sync confirmed media ownership", &error)
            })
        }
        #[cfg(not(unix))]
        {
            #[cfg(windows)]
            let _root_guard = lock_root_windows(&self.root, &self.directory)?;
            remove_recovery_portable(&self.root, &recovery)
        }
    }

    fn remove(&self, relative_path: &Path) -> HealthResult<()> {
        validate_media_relative_path(relative_path)?;
        #[cfg(unix)]
        {
            let relative = relative_path
                .to_str()
                .ok_or_else(invalid_media_relative_path)?;
            let mut components = relative.split('/').collect::<Vec<_>>();
            let file_name = components.pop().ok_or_else(invalid_media_relative_path)?;
            let mut opened_parent = None;
            for component in components {
                let parent = opened_parent.as_ref().unwrap_or(&self.directory);
                let descriptor = match rustix::fs::openat(
                    &**parent,
                    component,
                    rustix::fs::OFlags::RDONLY
                        | rustix::fs::OFlags::DIRECTORY
                        | rustix::fs::OFlags::NOFOLLOW
                        | rustix::fs::OFlags::CLOEXEC,
                    rustix::fs::Mode::empty(),
                ) {
                    Ok(descriptor) => descriptor,
                    Err(rustix::io::Errno::NOENT) => {
                        return remove_recovery_for_path_unix(&self.directory, relative_path);
                    }
                    Err(error) => {
                        return Err(media_storage_error(
                            "could not safely traverse media path",
                            &std::io::Error::from(error),
                        ));
                    }
                };
                opened_parent = Some(Arc::new(File::from(descriptor)));
            }
            let parent = opened_parent.as_ref().unwrap_or(&self.directory);
            match rustix::fs::statat(&**parent, file_name, rustix::fs::AtFlags::SYMLINK_NOFOLLOW) {
                Err(rustix::io::Errno::NOENT) => {
                    return remove_recovery_for_path_unix(&self.directory, relative_path);
                }
                Err(error) => {
                    return Err(media_storage_error(
                        "could not inspect media before removal",
                        &std::io::Error::from(error),
                    ));
                }
                Ok(metadata)
                    if rustix::fs::FileType::from_raw_mode(metadata.st_mode)
                        != rustix::fs::FileType::RegularFile =>
                {
                    return Err(HealthError::Storage(
                        "refusing to remove a non-regular media path".to_string(),
                    ));
                }
                Ok(_) => {}
            }
            match rustix::fs::unlinkat(&**parent, file_name, rustix::fs::AtFlags::empty()) {
                Ok(()) | Err(rustix::io::Errno::NOENT) => {
                    remove_recovery_for_path_unix(&self.directory, relative_path)
                }
                Err(error) => Err(media_storage_error(
                    "could not remove media",
                    &std::io::Error::from(error),
                )),
            }
        }

        #[cfg(not(unix))]
        {
            #[cfg(windows)]
            let _parent_guards =
                lock_media_parents_windows(&self.root, &self.directory, relative_path)?;
            let target = self.root.join(relative_path);
            match fs::symlink_metadata(&target) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return remove_recovery_for_path_portable(&self.root, relative_path);
                }
                Err(error) => {
                    return Err(media_storage_error(
                        "could not inspect media before removal",
                        &error,
                    ));
                }
                Ok(metadata) if !metadata.file_type().is_file() => {
                    return Err(HealthError::Storage(
                        "refusing to remove a non-regular media path".to_string(),
                    ));
                }
                Ok(_) => {}
            }
            match fs::remove_file(target) {
                Ok(()) => remove_recovery_for_path_portable(&self.root, relative_path),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    remove_recovery_for_path_portable(&self.root, relative_path)
                }
                Err(error) => Err(media_storage_error("could not remove media", &error)),
            }
        }
    }
}

impl LocalMediaStore {
    #[cfg(unix)]
    fn stage_bytes(&self, bytes: &[u8], mut stored: StoredMedia) -> HealthResult<LocalStagedMedia> {
        for _ in 0..MAX_TEMP_NAME_ATTEMPTS {
            let temporary_name = format!(".raven-upload-{}.tmp", Uuid::new_v4());
            let descriptor = match rustix::fs::openat(
                &*self.directory,
                temporary_name.as_str(),
                rustix::fs::OFlags::WRONLY
                    | rustix::fs::OFlags::CREATE
                    | rustix::fs::OFlags::EXCL
                    | rustix::fs::OFlags::NOFOLLOW
                    | rustix::fs::OFlags::CLOEXEC,
                rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
            ) {
                Ok(descriptor) => descriptor,
                Err(rustix::io::Errno::EXIST) => continue,
                Err(error) => {
                    return Err(media_storage_error(
                        "could not create staged media",
                        &std::io::Error::from(error),
                    ));
                }
            };
            let mut file = File::from(descriptor);
            if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
                drop(file);
                let primary = media_storage_error("could not write staged media", &error);
                let cleanup = rustix::fs::unlinkat(
                    &*self.directory,
                    temporary_name.as_str(),
                    rustix::fs::AtFlags::empty(),
                );
                return Err(match cleanup {
                    Ok(()) | Err(rustix::io::Errno::NOENT) => primary,
                    Err(cleanup) => HealthError::Cleanup {
                        primary: Box::new(primary),
                        cleanup: safe_io_summary(&std::io::Error::from(cleanup)),
                        recovery: None,
                        cleanup_path: Some(Box::new(PathBuf::from(&temporary_name))),
                    },
                });
            }
            stored.recovery_staged_path = Some(PathBuf::from(&temporary_name));
            let recovery = MediaRecovery::for_media(&stored);
            let mut staged = LocalStagedMedia {
                directory: Arc::clone(&self.directory),
                temporary_name,
                stored,
                recovery: recovery.clone(),
                finalized: false,
            };
            if let Err(primary) = write_recovery_unix(&self.directory, &recovery) {
                return Err(cleanup_staged_unix(&mut staged, primary, Some(&recovery)));
            }
            return Ok(staged);
        }
        Err(HealthError::Conflict(
            "could not allocate a unique staged media path".to_string(),
        ))
    }

    #[cfg(not(unix))]
    fn stage_bytes(&self, bytes: &[u8], mut stored: StoredMedia) -> HealthResult<LocalStagedMedia> {
        #[cfg(windows)]
        let _root_guard = lock_root_windows(&self.root, &self.directory)?;
        let mut temporary = tempfile::Builder::new()
            .prefix(".raven-upload-")
            .suffix(".tmp")
            .tempfile_in(&self.root)
            .map_err(|error| media_storage_error("could not create staged media", &error))?;
        temporary
            .write_all(bytes)
            .and_then(|()| temporary.as_file().sync_all())
            .map_err(|error| media_storage_error("could not write staged media", &error))?;
        let staged_path = temporary
            .path()
            .file_name()
            .ok_or_else(invalid_media_relative_path)?
            .into();
        stored.recovery_staged_path = Some(staged_path);
        let recovery = MediaRecovery::for_media(&stored);
        let mut staged = LocalStagedMedia {
            root: self.root.clone(),
            #[cfg(windows)]
            directory: Arc::clone(&self.directory),
            temporary: Some(temporary),
            stored,
            recovery,
        };
        if let Err(primary) = write_recovery_portable(&self.root, &staged.recovery) {
            return Err(cleanup_staged_portable(&mut staged, primary));
        }
        Ok(staged)
    }
}

#[cfg(unix)]
fn cleanup_staged_unix(
    staged: &mut LocalStagedMedia,
    primary: HealthError,
    recovery: Option<&MediaRecovery>,
) -> HealthError {
    let temporary = rustix::fs::unlinkat(
        &*staged.directory,
        staged.temporary_name.as_str(),
        rustix::fs::AtFlags::empty(),
    );
    if matches!(temporary, Ok(()) | Err(rustix::io::Errno::NOENT)) {
        staged.finalized = true;
        if let Some(recovery) = recovery {
            if let Err(cleanup) = unlink_recovery_unix(&staged.directory, recovery) {
                return HealthError::Cleanup {
                    primary: Box::new(primary),
                    cleanup: safe_error_text(&cleanup),
                    recovery: Some(Box::new(recovery.clone())),
                    cleanup_path: Some(Box::new(staged.stored.relative_path.clone())),
                };
            }
        }
        return primary;
    }
    HealthError::Cleanup {
        primary: Box::new(primary),
        cleanup: safe_io_summary(&std::io::Error::from(temporary.unwrap_err())),
        recovery: recovery.cloned().map(Box::new),
        cleanup_path: Some(Box::new(PathBuf::from(&staged.temporary_name))),
    }
}

#[cfg(unix)]
fn abort_staged_unix(staged: &mut LocalStagedMedia) -> HealthResult<()> {
    remove_staged_unix(staged)
}

#[cfg(not(unix))]
fn cleanup_staged_portable(staged: &mut LocalStagedMedia, primary: HealthError) -> HealthError {
    let cleanup_path = staged
        .temporary
        .as_ref()
        .map(|file| file.path().to_path_buf())
        .or_else(|| staged.recovery.staged_path().map(Path::to_path_buf));
    let temporary = staged
        .temporary
        .take()
        .ok_or_else(|| HealthError::Storage("staged media is unavailable".to_string()))
        .and_then(|file| {
            file.close()
                .map_err(|error| media_storage_error("could not remove staged media", &error))
        });
    let journal = staged_root_portable(staged)
        .and_then(|root| remove_recovery_portable(&root, &staged.recovery));
    match (temporary, journal) {
        (Ok(()), Ok(())) => primary,
        (temporary, journal) => HealthError::Cleanup {
            primary: Box::new(primary),
            cleanup: match (temporary.err(), journal.err()) {
                (Some(_), Some(_)) => {
                    "staged media and its recovery journal could not be removed".to_string()
                }
                (Some(_), None) => "staged media could not be removed".to_string(),
                (None, Some(_)) => "media recovery journal could not be removed".to_string(),
                (None, None) => unreachable!(),
            },
            recovery: Some(Box::new(staged.recovery.clone())),
            cleanup_path: cleanup_path.map(Box::new),
        },
    }
}

#[cfg(unix)]
fn cleanup_finalized_unix(
    staged: &LocalStagedMedia,
    primary: HealthError,
    recovery: &MediaRecovery,
) -> HealthError {
    let Some(relative_path) = staged.stored.relative_path.to_str() else {
        return HealthError::Cleanup {
            primary: Box::new(primary),
            cleanup: "finalized media path was not valid Unicode".to_string(),
            recovery: Some(Box::new(recovery.clone())),
            cleanup_path: Some(Box::new(staged.stored.relative_path.clone())),
        };
    };
    match rustix::fs::unlinkat(
        &*staged.directory,
        relative_path,
        rustix::fs::AtFlags::empty(),
    ) {
        Ok(()) | Err(rustix::io::Errno::NOENT) => {
            match unlink_recovery_unix(&staged.directory, recovery) {
                Ok(()) => primary,
                Err(cleanup) => HealthError::Cleanup {
                    primary: Box::new(primary),
                    cleanup: safe_error_text(&cleanup),
                    recovery: Some(Box::new(recovery.clone())),
                    cleanup_path: Some(Box::new(staged.stored.relative_path.clone())),
                },
            }
        }
        Err(cleanup) => HealthError::Cleanup {
            primary: Box::new(primary),
            cleanup: safe_io_summary(&std::io::Error::from(cleanup)),
            recovery: Some(Box::new(recovery.clone())),
            cleanup_path: Some(Box::new(staged.stored.relative_path.clone())),
        },
    }
}

#[cfg(unix)]
fn write_recovery_unix(directory: &File, recovery: &MediaRecovery) -> HealthResult<()> {
    let bytes = serde_json::to_vec(recovery)
        .map_err(|_| HealthError::Storage("could not encode media recovery journal".to_string()))?;
    let name = recovery
        .journal_name()
        .to_str()
        .ok_or_else(invalid_media_relative_path)?;
    let descriptor = rustix::fs::openat(
        directory,
        name,
        rustix::fs::OFlags::WRONLY
            | rustix::fs::OFlags::CREATE
            | rustix::fs::OFlags::EXCL
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
    )
    .map_err(|error| {
        media_storage_error(
            "could not create media recovery journal",
            &std::io::Error::from(error),
        )
    })?;
    let mut file = File::from(descriptor);
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| media_storage_error("could not persist media recovery journal", &error))?;
    directory
        .sync_all()
        .map_err(|error| media_storage_error("could not sync media recovery journal", &error))
}

#[cfg(unix)]
fn unlink_recovery_unix(directory: &File, recovery: &MediaRecovery) -> HealthResult<()> {
    let name = recovery
        .journal_name()
        .to_str()
        .ok_or_else(invalid_media_relative_path)?;
    match rustix::fs::unlinkat(directory, name, rustix::fs::AtFlags::empty()) {
        Ok(()) | Err(rustix::io::Errno::NOENT) => Ok(()),
        Err(error) => Err(media_storage_error(
            "could not remove media recovery journal",
            &std::io::Error::from(error),
        )),
    }
}

#[cfg(unix)]
fn remove_recovery_for_path_unix(directory: &File, relative_path: &Path) -> HealthResult<()> {
    let recovery = recovery_for_path(relative_path)?;
    unlink_recovery_unix(directory, &recovery)
}

#[cfg(not(unix))]
fn write_recovery_portable(root: &Path, recovery: &MediaRecovery) -> HealthResult<()> {
    let path = root.join(recovery.journal_name());
    let bytes = serde_json::to_vec(recovery)
        .map_err(|_| HealthError::Storage("could not encode media recovery journal".to_string()))?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options
        .open(path)
        .map_err(|error| media_storage_error("could not create media recovery journal", &error))?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| media_storage_error("could not persist media recovery journal", &error))
}

#[cfg(not(unix))]
fn remove_recovery_portable(root: &Path, recovery: &MediaRecovery) -> HealthResult<()> {
    match fs::remove_file(root.join(recovery.journal_name())) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(media_storage_error(
            "could not remove media recovery journal",
            &error,
        )),
    }
}

#[cfg(not(unix))]
fn remove_recovery_for_path_portable(root: &Path, relative_path: &Path) -> HealthResult<()> {
    remove_recovery_portable(root, &recovery_for_path(relative_path)?)
}

fn recovery_for_path(relative_path: &Path) -> HealthResult<MediaRecovery> {
    validate_media_relative_path(relative_path)?;
    let file_name = relative_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(invalid_media_relative_path)?;
    let (id, _) = file_name
        .rsplit_once('.')
        .ok_or_else(invalid_media_relative_path)?;
    let stored = StoredMedia {
        id: id.to_string(),
        relative_path: relative_path.to_path_buf(),
        mime_type: String::new(),
        byte_size: 0,
        checksum_sha256: "0".repeat(64),
        recovery_staged_path: None,
    };
    Ok(MediaRecovery::for_media(&stored))
}

fn safe_error_text(error: &HealthError) -> String {
    match error {
        HealthError::Storage(_) => "media storage operation failed".to_string(),
        _ => "media cleanup failed".to_string(),
    }
}

#[cfg(all(
    unix,
    any(
        target_vendor = "apple",
        target_os = "linux",
        target_os = "android",
        target_os = "redox"
    )
))]
fn atomic_finalize_unix(
    directory: &File,
    temporary_name: &str,
    final_name: &str,
    _recovery: &MediaRecovery,
) -> HealthResult<()> {
    rustix::fs::renameat_with(
        directory,
        temporary_name,
        directory,
        final_name,
        rustix::fs::RenameFlags::NOREPLACE,
    )
    .map_err(|error| {
        if error == rustix::io::Errno::EXIST {
            HealthError::Conflict("generated media path already exists".to_string())
        } else {
            media_storage_error(
                "could not atomically finalize staged media",
                &std::io::Error::from(error),
            )
        }
    })
}

#[cfg(all(
    unix,
    not(any(
        target_vendor = "apple",
        target_os = "linux",
        target_os = "android",
        target_os = "redox"
    ))
))]
fn atomic_finalize_unix(
    directory: &File,
    temporary_name: &str,
    final_name: &str,
    recovery: &MediaRecovery,
) -> HealthResult<()> {
    rustix::fs::linkat(
        directory,
        temporary_name,
        directory,
        final_name,
        rustix::fs::AtFlags::empty(),
    )
    .map_err(|error| {
        if error == rustix::io::Errno::EXIST {
            HealthError::Conflict("generated media path already exists".to_string())
        } else {
            media_storage_error(
                "could not publish staged media",
                &std::io::Error::from(error),
            )
        }
    })?;
    if let Err(error) =
        rustix::fs::unlinkat(directory, temporary_name, rustix::fs::AtFlags::empty())
    {
        let primary = media_storage_error(
            "could not remove staged media after publishing",
            &std::io::Error::from(error),
        );
        return Err(
            match rustix::fs::unlinkat(directory, final_name, rustix::fs::AtFlags::empty()) {
                Ok(()) | Err(rustix::io::Errno::NOENT) => primary,
                Err(cleanup) => HealthError::Cleanup {
                    primary: Box::new(primary),
                    cleanup: safe_io_summary(&std::io::Error::from(cleanup)),
                    recovery: Some(Box::new(recovery.clone())),
                    cleanup_path: Some(Box::new(PathBuf::from(final_name))),
                },
            },
        );
    }
    Ok(())
}

#[cfg(unix)]
fn prepare_root_unix_with_hook(
    root: &Path,
    mut before_open: impl FnMut(bool),
) -> HealthResult<(PathBuf, File)> {
    if fs::symlink_metadata(root).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(HealthError::Storage(
            "configured media directory must not be a symlink".to_string(),
        ));
    }
    let root = normalize_root_anchor(root)?;
    let mut names = Vec::new();
    for component in root.components() {
        match component {
            Component::RootDir | Component::CurDir => {}
            Component::Normal(name) => names.push(name.to_os_string()),
            Component::ParentDir | Component::Prefix(_) => {
                return Err(HealthError::Validation {
                    field: "media.root",
                    message: "must not contain parent traversal".to_string(),
                });
            }
        }
    }
    if names.is_empty() {
        return Err(HealthError::Validation {
            field: "media.root",
            message: "must name a media directory".to_string(),
        });
    }
    let start = if root.is_absolute() { "/" } else { "." };
    let descriptor = rustix::fs::open(
        start,
        rustix::fs::OFlags::RDONLY
            | rustix::fs::OFlags::DIRECTORY
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::empty(),
    )
    .map_err(|error| {
        media_storage_error(
            "could not open the media root anchor",
            &std::io::Error::from(error),
        )
    })?;
    let mut current = File::from(descriptor);
    let count = names.len();
    for (index, name) in names.into_iter().enumerate() {
        let is_final = index + 1 == count;
        before_open(is_final);
        let flags = rustix::fs::OFlags::RDONLY
            | rustix::fs::OFlags::DIRECTORY
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::CLOEXEC;
        let descriptor = match rustix::fs::openat(&current, &name, flags, rustix::fs::Mode::empty())
        {
            Ok(descriptor) => descriptor,
            Err(rustix::io::Errno::NOENT) => {
                match rustix::fs::mkdirat(
                    &current,
                    &name,
                    rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR | rustix::fs::Mode::XUSR,
                ) {
                    Ok(()) | Err(rustix::io::Errno::EXIST) => {}
                    Err(error) => {
                        return Err(media_storage_error(
                            "could not create the configured media directory",
                            &std::io::Error::from(error),
                        ));
                    }
                }
                rustix::fs::openat(&current, &name, flags, rustix::fs::Mode::empty()).map_err(
                    |error| {
                        media_storage_error(
                            "could not safely open the configured media directory",
                            &std::io::Error::from(error),
                        )
                    },
                )?
            }
            Err(error) => {
                return Err(media_storage_error(
                    "could not safely open the configured media directory",
                    &std::io::Error::from(error),
                ));
            }
        };
        current = File::from(descriptor);
    }
    rustix::fs::fchmod(
        &current,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR | rustix::fs::Mode::XUSR,
    )
    .map_err(|error| {
        media_storage_error(
            "could not secure the configured media directory",
            &std::io::Error::from(error),
        )
    })?;
    Ok((root, current))
}

#[cfg(unix)]
fn normalize_root_anchor(root: &Path) -> HealthResult<PathBuf> {
    let absolute = if root.is_absolute() {
        root.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| media_storage_error("could not resolve current directory", &error))?
            .join(root)
    };
    let mut missing = vec![
        absolute
            .file_name()
            .ok_or_else(|| {
                HealthError::Storage("configured media path has no directory name".to_string())
            })?
            .to_os_string(),
    ];
    let mut ancestor = absolute.parent().ok_or_else(|| {
        HealthError::Storage("configured media path has no directory anchor".to_string())
    })?;
    loop {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if metadata.is_dir() => break,
            Ok(_) => {
                return Err(HealthError::Storage(
                    "configured media path crosses a non-directory".to_string(),
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let name = ancestor.file_name().ok_or_else(|| {
                    HealthError::Storage(
                        "configured media path has no directory anchor".to_string(),
                    )
                })?;
                missing.push(name.to_os_string());
                ancestor = ancestor.parent().ok_or_else(|| {
                    HealthError::Storage(
                        "configured media path has no directory anchor".to_string(),
                    )
                })?;
            }
            Err(error) => {
                return Err(media_storage_error(
                    "could not inspect the configured media directory",
                    &error,
                ));
            }
        }
    }
    let mut normalized = ancestor
        .canonicalize()
        .map_err(|error| media_storage_error("could not resolve the media root anchor", &error))?;
    for component in missing.into_iter().rev() {
        normalized.push(component);
    }
    Ok(normalized)
}

#[cfg(windows)]
fn prepare_root_windows(root: &Path) -> HealthResult<(PathBuf, File)> {
    let absolute = if root.is_absolute() {
        root.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| media_storage_error("could not resolve current directory", &error))?
            .join(root)
    };
    if absolute
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(HealthError::Validation {
            field: "media.root",
            message: "must not contain parent traversal".to_string(),
        });
    }

    let mut current = PathBuf::new();
    let mut guards = Vec::new();
    for component in absolute.components() {
        current.push(component.as_os_str());
        if !matches!(component, Component::Normal(_)) {
            continue;
        }
        match fs::create_dir(&current) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(media_storage_error(
                    "could not create the media directory",
                    &error,
                ));
            }
        }
        guards.push(open_directory_windows(&current)?);
    }
    let directory = guards.pop().ok_or_else(|| HealthError::Validation {
        field: "media.root",
        message: "must name a media directory".to_string(),
    })?;
    Ok((absolute, directory))
}

#[cfg(windows)]
fn open_directory_windows(path: &Path) -> HealthResult<File> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};

    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

    let file = fs::OpenOptions::new()
        .access_mode(0)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| media_storage_error("could not safely open media directory", &error))?;
    let metadata = file
        .metadata()
        .map_err(|error| media_storage_error("could not inspect media directory", &error))?;
    if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(HealthError::Storage(
            "configured media path crosses a reparse point or non-directory".to_string(),
        ));
    }
    Ok(file)
}

#[cfg(windows)]
fn open_regular_windows(path: &Path, label: &str) -> HealthResult<File> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};

    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

    let file = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| media_storage_error(&format!("could not safely open {label}"), &error))?;
    let metadata = file
        .metadata()
        .map_err(|error| media_storage_error(&format!("could not inspect {label}"), &error))?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(HealthError::Storage(format!(
            "{label} must be a regular non-reparse file"
        )));
    }
    Ok(file)
}

#[cfg(windows)]
fn lock_root_windows(root: &Path, expected: &File) -> HealthResult<File> {
    let actual = open_directory_windows(root)?;
    if windows_file_identity(expected)? != windows_file_identity(&actual)? {
        return Err(HealthError::Storage(
            "configured media directory was replaced".to_string(),
        ));
    }
    Ok(actual)
}

#[cfg(windows)]
fn windows_file_identity(file: &File) -> HealthResult<(u32, u64)> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
    };

    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: `file` owns a valid Windows handle and `information` is writable
    // for the duration of the call.
    let success = unsafe {
        GetFileInformationByHandle(
            file.as_raw_handle() as HANDLE,
            std::ptr::addr_of_mut!(information),
        )
    };
    if success == 0 {
        return Err(media_storage_error(
            "could not identify opened media directory",
            &std::io::Error::last_os_error(),
        ));
    }
    Ok((
        information.dwVolumeSerialNumber,
        u64::from(information.nFileIndexHigh) << 32 | u64::from(information.nFileIndexLow),
    ))
}

#[cfg(windows)]
fn staged_root_portable(staged: &LocalStagedMedia) -> HealthResult<PathBuf> {
    root_path_windows(&staged.directory)
}

#[cfg(not(any(unix, windows)))]
fn staged_root_portable(staged: &LocalStagedMedia) -> HealthResult<PathBuf> {
    Ok(staged.root.clone())
}

#[cfg(windows)]
fn root_path_windows(directory: &File) -> HealthResult<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_NAME_NORMALIZED, GetFinalPathNameByHandleW, VOLUME_NAME_DOS,
    };

    let mut buffer = vec![0_u16; 32_768];
    // SAFETY: `directory` owns a valid handle and `buffer` is writable for the
    // supplied length.
    let length = unsafe {
        GetFinalPathNameByHandleW(
            directory.as_raw_handle() as HANDLE,
            buffer.as_mut_ptr(),
            u32::try_from(buffer.len()).expect("Windows path buffer length fits u32"),
            FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
        )
    };
    if length == 0 || length as usize >= buffer.len() {
        return Err(media_storage_error(
            "could not resolve opened media directory",
            &std::io::Error::last_os_error(),
        ));
    }
    Ok(std::ffi::OsString::from_wide(&buffer[..length as usize]).into())
}

#[cfg(windows)]
fn lock_media_parents_windows(
    root: &Path,
    directory: &File,
    relative_path: &Path,
) -> HealthResult<Vec<File>> {
    let mut guards = vec![lock_root_windows(root, directory)?];
    let mut current = root.to_path_buf();
    let mut components = relative_path.components().peekable();
    while let Some(component) = components.next() {
        if components.peek().is_none() {
            break;
        }
        let Component::Normal(component) = component else {
            return Err(invalid_media_relative_path());
        };
        current.push(component);
        guards.push(open_directory_windows(&current)?);
    }
    Ok(guards)
}

#[cfg(not(any(unix, windows)))]
fn prepare_root_unsupported(_root: &Path) -> HealthResult<PathBuf> {
    Err(HealthError::Storage(
        "secure media storage requires directory-handle support on this platform".to_string(),
    ))
}

fn validate_max_bytes(max_bytes: u64) -> HealthResult<()> {
    let addressable = usize::MAX as u64;
    let database_max = i64::MAX as u64;
    if max_bytes == 0 || max_bytes > addressable.min(database_max) {
        return Err(HealthError::Validation {
            field: "media.max_bytes",
            message: "must be positive and fit memory and SQLite size bounds".to_string(),
        });
    }
    Ok(())
}

#[cfg(unix)]
fn invalid_relative_path() -> HealthError {
    invalid_media_relative_path()
}

fn media_storage_error(context: &str, error: &std::io::Error) -> HealthError {
    HealthError::Storage(format!(
        "{context} (kind={:?}, os_error={:?})",
        error.kind(),
        error.raw_os_error()
    ))
}

fn safe_io_summary(error: &std::io::Error) -> String {
    format!(
        "kind={:?}, os_error={:?}",
        error.kind(),
        error.raw_os_error()
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ImageFormat {
    Jpeg,
    Png,
    Webp,
}

impl ImageFormat {
    fn detect(content_type: &str, bytes: &[u8]) -> HealthResult<Self> {
        let sniffed = infer::get(bytes)
            .map(|kind| kind.mime_type())
            .ok_or(HealthError::UnsupportedMedia)?;
        let format = match sniffed {
            "image/jpeg" if complete_jpeg(bytes) => Self::Jpeg,
            "image/png" if complete_png(bytes) => Self::Png,
            "image/webp" if complete_webp(bytes) => Self::Webp,
            _ => return Err(HealthError::UnsupportedMedia),
        };
        if content_type != format.mime_type() {
            return Err(HealthError::UnsupportedMedia);
        }
        Ok(format)
    }

    const fn mime_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
        }
    }

    const fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Webp => "webp",
        }
    }
}

fn complete_png(bytes: &[u8]) -> bool {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    if !bytes.starts_with(SIGNATURE) {
        return false;
    }
    let mut offset = SIGNATURE.len();
    let mut saw_header = false;
    let mut saw_data = false;
    while offset.checked_add(12).is_some_and(|end| end <= bytes.len()) {
        let length = u32::from_be_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]) as usize;
        let chunk_type = &bytes[offset + 4..offset + 8];
        let Some(end) = offset
            .checked_add(12)
            .and_then(|base| base.checked_add(length))
        else {
            return false;
        };
        if end > bytes.len() {
            return false;
        }
        match chunk_type {
            b"IHDR" if offset == SIGNATURE.len() && length == 13 => saw_header = true,
            b"IDAT" if saw_header => saw_data = true,
            b"IEND" if saw_header && saw_data && length == 0 => return end == bytes.len(),
            _ => {}
        }
        offset = end;
    }
    false
}

fn complete_webp(bytes: &[u8]) -> bool {
    if bytes.len() < 20 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return false;
    }
    let declared = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    if declared.checked_add(8) != Some(bytes.len()) {
        return false;
    }
    let mut offset = 12usize;
    let mut saw_image_payload = false;
    while offset.checked_add(8).is_some_and(|end| end <= bytes.len()) {
        let chunk_type = &bytes[offset..offset + 4];
        if !matches!(
            chunk_type,
            b"VP8 " | b"VP8L" | b"VP8X" | b"ALPH" | b"ANIM" | b"ANMF" | b"ICCP" | b"EXIF" | b"XMP "
        ) {
            return false;
        }
        let chunk_length = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        let Some(next) = chunk_length
            .checked_add(chunk_length & 1)
            .and_then(|length| length.checked_add(offset + 8))
        else {
            return false;
        };
        if next > bytes.len() {
            return false;
        }
        saw_image_payload |= matches!(chunk_type, b"VP8 " | b"VP8L" | b"ANMF");
        offset = next;
    }
    saw_image_payload && offset == bytes.len()
}

fn complete_jpeg(bytes: &[u8]) -> bool {
    if bytes.len() < 4 || !bytes.starts_with(&[0xff, 0xd8]) {
        return false;
    }
    let mut offset = 2;
    let mut saw_frame = false;
    while offset < bytes.len() {
        if bytes[offset] != 0xff {
            return false;
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        if offset >= bytes.len() {
            return false;
        }
        let marker = bytes[offset];
        offset += 1;
        if marker == 0xd9 {
            return false;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let Some(length_end) = offset.checked_add(2) else {
            return false;
        };
        if length_end > bytes.len() {
            return false;
        }
        let length = u16::from_be_bytes([bytes[offset], bytes[offset + 1]]) as usize;
        if length < 2 {
            return false;
        }
        let Some(segment_end) = offset.checked_add(length) else {
            return false;
        };
        if segment_end > bytes.len() {
            return false;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) {
            saw_frame = true;
        }
        offset = segment_end;
        if marker == 0xda {
            while offset + 1 < bytes.len() {
                if bytes[offset] != 0xff {
                    offset += 1;
                    continue;
                }
                let next = bytes[offset + 1];
                match next {
                    0x00 | 0xd0..=0xd7 => offset += 2,
                    0xd9 => return saw_frame && offset + 2 == bytes.len(),
                    _ => return false,
                }
            }
            return false;
        }
    }
    false
}

#[cfg(all(test, unix))]
mod root_race_tests {
    use super::*;

    #[test]
    fn root_swap_barrier_cannot_redirect_the_opened_directory() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("media");
        fs::create_dir(&root).unwrap();
        let moved = directory.path().join("moved");
        let outside = directory.path().join("outside");
        fs::create_dir(&outside).unwrap();
        let mut swapped = false;

        let result = prepare_root_unix_with_hook(&root, |is_final| {
            if is_final && !swapped {
                fs::rename(&root, &moved).unwrap();
                std::os::unix::fs::symlink(&outside, &root).unwrap();
                swapped = true;
            }
        });

        assert!(matches!(result, Err(HealthError::Storage(_))));
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
    }
}
