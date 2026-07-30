use std::fs::{self, File};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use sha2::{Digest, Sha256};
use uuid::{Uuid, Variant, Version};

use crate::application::error::{HealthError, HealthResult};
use crate::application::media::{DEFAULT_MAX_MEDIA_BYTES, MediaStore, StoredMedia};

const MAX_TEMP_NAME_ATTEMPTS: usize = 8;

#[derive(Debug)]
pub struct LocalMediaStore {
    #[cfg_attr(unix, allow(dead_code))]
    root: PathBuf,
    max_bytes: u64,
    #[cfg(unix)]
    directory: Arc<File>,
}

impl LocalMediaStore {
    pub fn new(root: impl AsRef<Path>) -> HealthResult<Self> {
        Self::with_limit(root, DEFAULT_MAX_MEDIA_BYTES)
    }

    pub fn with_limit(root: impl AsRef<Path>, max_bytes: u64) -> HealthResult<Self> {
        validate_max_bytes(max_bytes)?;
        let root = prepare_root(root.as_ref())?;
        #[cfg(unix)]
        let directory = Arc::new(File::open(&root).map_err(|error| {
            media_storage_error("could not open the configured media directory", &error)
        })?);
        Ok(Self {
            root,
            max_bytes,
            #[cfg(unix)]
            directory,
        })
    }

    pub const fn max_bytes(&self) -> u64 {
        self.max_bytes
    }
}

#[cfg(unix)]
#[derive(Debug)]
pub struct LocalStagedMedia {
    directory: Arc<File>,
    temporary_name: String,
    stored: StoredMedia,
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
        if !self.finalized {
            let _ = rustix::fs::unlinkat(
                &*self.directory,
                self.temporary_name.as_str(),
                rustix::fs::AtFlags::empty(),
            );
        }
    }
}

#[cfg(not(unix))]
#[derive(Debug)]
pub struct LocalStagedMedia {
    root: PathBuf,
    temporary: Option<tempfile::NamedTempFile>,
    stored: StoredMedia,
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
        };
        self.stage_bytes(bytes, stored)
    }

    fn finalize(&self, mut staged: Self::Staged) -> HealthResult<StoredMedia> {
        #[cfg(unix)]
        {
            if !Arc::ptr_eq(&self.directory, &staged.directory) {
                return Err(HealthError::Validation {
                    field: "media.staged",
                    message: "belongs to a different media store".to_string(),
                });
            }
            let result = atomic_finalize_unix(
                &self.directory,
                &staged.temporary_name,
                staged
                    .stored
                    .relative_path
                    .to_str()
                    .ok_or_else(invalid_relative_path)?,
            );
            if let Err(error) = result {
                let primary = if error == rustix::io::Errno::EXIST {
                    HealthError::Conflict("generated media path already exists".to_string())
                } else {
                    media_storage_error(
                        "could not atomically finalize staged media",
                        &std::io::Error::from(error),
                    )
                };
                return Err(primary);
            }
            staged.finalized = true;
            if let Err(error) = self.directory.sync_all() {
                let primary = media_storage_error("could not sync the media directory", &error);
                return Err(cleanup_finalized_unix(&staged, primary));
            }
            Ok(staged.stored.clone())
        }

        #[cfg(not(unix))]
        {
            if self.root != staged.root {
                return Err(HealthError::Validation {
                    field: "media.staged",
                    message: "belongs to a different media store".to_string(),
                });
            }
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
                            },
                        });
                    }
                    Ok(staged.stored)
                }
                Err(error) => {
                    let tempfile::PersistError { error, file } = error;
                    let primary = if error.kind() == std::io::ErrorKind::AlreadyExists {
                        HealthError::Conflict("generated media path already exists".to_string())
                    } else {
                        media_storage_error("could not atomically finalize staged media", &error)
                    };
                    match file.close() {
                        Ok(()) => Err(primary),
                        Err(cleanup) => Err(HealthError::Cleanup {
                            primary: Box::new(primary),
                            cleanup: safe_io_summary(&cleanup),
                        }),
                    }
                }
            }
        }
    }

    fn remove(&self, relative_path: &Path) -> HealthResult<()> {
        validate_relative_path(relative_path)?;
        #[cfg(unix)]
        {
            match rustix::fs::statat(
                &*self.directory,
                relative_path.to_str().ok_or_else(invalid_relative_path)?,
                rustix::fs::AtFlags::SYMLINK_NOFOLLOW,
            ) {
                Err(rustix::io::Errno::NOENT) => return Ok(()),
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
            match rustix::fs::unlinkat(
                &*self.directory,
                relative_path.to_str().ok_or_else(invalid_relative_path)?,
                rustix::fs::AtFlags::empty(),
            ) {
                Ok(()) | Err(rustix::io::Errno::NOENT) => Ok(()),
                Err(error) => Err(media_storage_error(
                    "could not remove media",
                    &std::io::Error::from(error),
                )),
            }
        }

        #[cfg(not(unix))]
        {
            let target = self.root.join(relative_path);
            match fs::symlink_metadata(&target) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
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
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(media_storage_error("could not remove media", &error)),
            }
        }
    }
}

impl LocalMediaStore {
    #[cfg(unix)]
    fn stage_bytes(&self, bytes: &[u8], stored: StoredMedia) -> HealthResult<LocalStagedMedia> {
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
                    },
                });
            }
            return Ok(LocalStagedMedia {
                directory: Arc::clone(&self.directory),
                temporary_name,
                stored,
                finalized: false,
            });
        }
        Err(HealthError::Conflict(
            "could not allocate a unique staged media path".to_string(),
        ))
    }

    #[cfg(not(unix))]
    fn stage_bytes(&self, bytes: &[u8], stored: StoredMedia) -> HealthResult<LocalStagedMedia> {
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root)
            .map_err(|error| media_storage_error("could not create staged media", &error))?;
        temporary
            .write_all(bytes)
            .and_then(|()| temporary.as_file().sync_all())
            .map_err(|error| media_storage_error("could not write staged media", &error))?;
        Ok(LocalStagedMedia {
            root: self.root.clone(),
            temporary: Some(temporary),
            stored,
        })
    }
}

#[cfg(unix)]
fn cleanup_finalized_unix(staged: &LocalStagedMedia, primary: HealthError) -> HealthError {
    let Some(relative_path) = staged.stored.relative_path.to_str() else {
        return HealthError::Cleanup {
            primary: Box::new(primary),
            cleanup: "finalized media path was not valid Unicode".to_string(),
        };
    };
    match rustix::fs::unlinkat(
        &*staged.directory,
        relative_path,
        rustix::fs::AtFlags::empty(),
    ) {
        Ok(()) | Err(rustix::io::Errno::NOENT) => primary,
        Err(cleanup) => HealthError::Cleanup {
            primary: Box::new(primary),
            cleanup: safe_io_summary(&std::io::Error::from(cleanup)),
        },
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
) -> Result<(), rustix::io::Errno> {
    rustix::fs::renameat_with(
        directory,
        temporary_name,
        directory,
        final_name,
        rustix::fs::RenameFlags::NOREPLACE,
    )
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
) -> Result<(), rustix::io::Errno> {
    rustix::fs::linkat(
        directory,
        temporary_name,
        directory,
        final_name,
        rustix::fs::AtFlags::empty(),
    )?;
    if let Err(error) =
        rustix::fs::unlinkat(directory, temporary_name, rustix::fs::AtFlags::empty())
    {
        let _ = rustix::fs::unlinkat(directory, final_name, rustix::fs::AtFlags::empty());
        return Err(error);
    }
    Ok(())
}

fn prepare_root(root: &Path) -> HealthResult<PathBuf> {
    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(HealthError::Storage(
                "configured media directory must not be a symlink".to_string(),
            ));
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(HealthError::Storage(
                "configured media path is not a directory".to_string(),
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(root).map_err(|error| {
                media_storage_error("could not create the configured media directory", &error)
            })?;
        }
        Err(error) => {
            return Err(media_storage_error(
                "could not inspect the configured media directory",
                &error,
            ));
        }
    }
    let metadata = fs::symlink_metadata(root).map_err(|error| {
        media_storage_error("could not verify the configured media directory", &error)
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(HealthError::Storage(
            "configured media path is not a safe directory".to_string(),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(root, fs::Permissions::from_mode(0o700));
    }
    root.canonicalize().map_err(|error| {
        media_storage_error("could not resolve the configured media directory", &error)
    })
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

fn validate_relative_path(path: &Path) -> HealthResult<()> {
    let mut components = path.components();
    let Some(Component::Normal(name)) = components.next() else {
        return Err(invalid_relative_path());
    };
    if components.next().is_some() {
        return Err(invalid_relative_path());
    }
    let Some(name) = name.to_str() else {
        return Err(invalid_relative_path());
    };
    let Some((id, extension)) = name.rsplit_once('.') else {
        return Err(invalid_relative_path());
    };
    let uuid = Uuid::parse_str(id).map_err(|_| invalid_relative_path())?;
    if uuid.get_version() != Some(Version::Random)
        || uuid.get_variant() != Variant::RFC4122
        || uuid.to_string() != id
        || !matches!(extension, "jpg" | "png" | "webp")
    {
        return Err(invalid_relative_path());
    }
    Ok(())
}

fn invalid_relative_path() -> HealthError {
    HealthError::Validation {
        field: "media.relative_path",
        message: "must be one generated UUID v4 image filename".to_string(),
    }
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
