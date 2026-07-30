use std::path::{Path, PathBuf};

use crate::application::error::HealthResult;

pub const DEFAULT_MAX_MEDIA_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMedia {
    pub(crate) id: String,
    pub(crate) relative_path: PathBuf,
    pub(crate) mime_type: String,
    pub(crate) byte_size: u64,
    pub(crate) checksum_sha256: String,
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
    fn remove(&self, relative_path: &Path) -> HealthResult<()>;
}
