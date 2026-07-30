use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::{Uuid, Variant, Version};

use crate::application::error::{HealthError, HealthResult};

pub const DEFAULT_MAX_MEDIA_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMedia {
    pub(crate) id: String,
    pub(crate) relative_path: PathBuf,
    pub(crate) mime_type: String,
    pub(crate) byte_size: u64,
    pub(crate) checksum_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaRecovery {
    media_id: String,
    relative_path: PathBuf,
    journal_name: PathBuf,
    checksum_sha256: String,
}

impl MediaRecovery {
    pub fn media_id(&self) -> &str {
        &self.media_id
    }

    pub fn relative_path(&self) -> &Path {
        &self.relative_path
    }

    pub fn journal_name(&self) -> &Path {
        &self.journal_name
    }

    pub fn checksum_sha256(&self) -> &str {
        &self.checksum_sha256
    }

    pub(crate) fn for_media(media: &StoredMedia) -> Self {
        Self {
            media_id: media.id.clone(),
            relative_path: media.relative_path.clone(),
            journal_name: PathBuf::from(format!(".raven-recovery-{}.json", media.id)),
            checksum_sha256: media.checksum_sha256.clone(),
        }
    }

    pub(crate) fn validate(&self) -> HealthResult<()> {
        validate_media_relative_path(&self.relative_path)?;
        let expected = format!(".raven-recovery-{}.json", self.media_id);
        if self.journal_name != Path::new(&expected)
            || self.checksum_sha256.len() != 64
            || !self
                .checksum_sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(HealthError::Storage(
                "invalid media recovery journal".to_string(),
            ));
        }
        Ok(())
    }
}

impl StoredMedia {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn relative_path(&self) -> &Path {
        &self.relative_path
    }

    pub fn mime_type(&self) -> &str {
        &self.mime_type
    }

    pub const fn byte_size(&self) -> u64 {
        self.byte_size
    }

    pub fn checksum_sha256(&self) -> &str {
        &self.checksum_sha256
    }
}

pub trait MediaStore {
    type Staged;

    fn stage(&self, content_type: &str, bytes: &[u8]) -> HealthResult<Self::Staged>;
    fn finalize(&self, staged: Self::Staged) -> HealthResult<StoredMedia>;
    fn confirm(&self, stored: &StoredMedia) -> HealthResult<()>;
    fn remove(&self, relative_path: &Path) -> HealthResult<()>;
}

pub(crate) fn validate_media_relative_path(path: &Path) -> HealthResult<()> {
    let relative = path.to_str().ok_or_else(invalid_media_relative_path)?;
    if relative.is_empty()
        || relative.trim() != relative
        || relative.contains('\\')
        || relative.contains('\0')
        || path.is_absolute()
    {
        return Err(invalid_media_relative_path());
    }
    let mut components = relative.split('/').peekable();
    let mut final_name = None;
    while let Some(component) = components.next() {
        if component.is_empty() || matches!(component, "." | "..") {
            return Err(invalid_media_relative_path());
        }
        if components.peek().is_none() {
            final_name = Some(component);
        }
    }
    let Some((id, extension)) = final_name.and_then(|name| name.rsplit_once('.')) else {
        return Err(invalid_media_relative_path());
    };
    let uuid = Uuid::parse_str(id).map_err(|_| invalid_media_relative_path())?;
    if uuid.get_version() != Some(Version::Random)
        || uuid.get_variant() != Variant::RFC4122
        || uuid.to_string() != id
        || !matches!(extension, "jpg" | "png" | "webp")
    {
        return Err(invalid_media_relative_path());
    }
    Ok(())
}

pub(crate) fn invalid_media_relative_path() -> HealthError {
    HealthError::Validation {
        field: "media.relative_path",
        message: "must be a canonical relative path ending in a generated UUID v4 image filename"
            .to_string(),
    }
}
