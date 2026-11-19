//! `maintenance/retention-state.json`: the last recorded run summary (counts only).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::{RetentionError, RetentionPaths, fsutil};

const VERSION: u32 = 1;
const MAX_FILE_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LastRun {
    pub run_id: String,
    pub trigger: String,
    pub started_at: String,
    pub finished_at: String,
    pub outcome: String,
    pub domains: BTreeMap<String, DomainRun>,
    pub backup: Option<BackupRef>,
    pub media_cleanup_pending: u64,
}

impl LastRun {
    pub fn finished_at(&self) -> Option<OffsetDateTime> {
        OffsetDateTime::parse(&self.finished_at, &Rfc3339).ok()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomainRun {
    pub status: String,
    pub purged: BTreeMap<String, u64>,
    pub skipped: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupRef {
    pub name: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct StateFile {
    pub version: u32,
    pub last_run: Option<LastRun>,
}

pub(crate) fn load(paths: &RetentionPaths) -> Result<StateFile, RetentionError> {
    let Some(bytes) = fsutil::read_optional(&paths.state_file(), MAX_FILE_BYTES)
        .map_err(|_| RetentionError::Storage)?
    else {
        return Ok(StateFile {
            version: VERSION,
            last_run: None,
        });
    };
    let state: StateFile = serde_json::from_slice(&bytes).map_err(|_| RetentionError::Storage)?;
    if state.version != VERSION {
        return Err(RetentionError::Storage);
    }
    Ok(state)
}

pub(crate) fn save(paths: &RetentionPaths, last_run: &LastRun) -> Result<(), RetentionError> {
    let state = StateFile {
        version: VERSION,
        last_run: Some(last_run.clone()),
    };
    let bytes = serde_json::to_vec_pretty(&state).map_err(|_| RetentionError::Storage)?;
    fsutil::write_atomic(&paths.state_file(), &bytes).map_err(|_| RetentionError::Storage)
}

pub(crate) fn format_instant(at: OffsetDateTime) -> Option<String> {
    at.to_offset(time::UtcOffset::UTC).format(&Rfc3339).ok()
}
