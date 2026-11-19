//! `maintenance/retention.json`: `{"version":1,"enabled":true,"retention_days":30,"backup_keep":3}`.

use serde::{Deserialize, Serialize};

use super::{RetentionError, RetentionPaths, fsutil};

const VERSION: u32 = 1;
const MAX_FILE_BYTES: u64 = 4096;
pub const DAYS_RANGE: std::ops::RangeInclusive<u32> = 7..=3650;
pub const BACKUP_KEEP_RANGE: std::ops::RangeInclusive<u32> = 1..=30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RetentionSettings {
    pub enabled: bool,
    pub retention_days: u32,
    pub backup_keep: u32,
}

impl Default for RetentionSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            retention_days: 30,
            backup_keep: 3,
        }
    }
}

impl RetentionSettings {
    pub fn validate(&self) -> Result<(), RetentionError> {
        if !DAYS_RANGE.contains(&self.retention_days) {
            return Err(RetentionError::Validation {
                field: "retention_days",
            });
        }
        if !BACKUP_KEEP_RANGE.contains(&self.backup_keep) {
            return Err(RetentionError::Validation {
                field: "backup_keep",
            });
        }
        Ok(())
    }
}

/// A partial update; absent fields keep their current value.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SettingsUpdate {
    pub enabled: Option<bool>,
    pub retention_days: Option<u32>,
    pub backup_keep: Option<u32>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SettingsFile {
    version: u32,
    enabled: bool,
    retention_days: u32,
    backup_keep: u32,
}

/// Missing file => defaults. Never creates anything.
pub(crate) fn load(paths: &RetentionPaths) -> Result<RetentionSettings, RetentionError> {
    let Some(bytes) = fsutil::read_optional(&paths.settings_file(), MAX_FILE_BYTES)
        .map_err(|_| RetentionError::Storage)?
    else {
        return Ok(RetentionSettings::default());
    };
    let file: SettingsFile = serde_json::from_slice(&bytes).map_err(|_| RetentionError::Storage)?;
    if file.version != VERSION {
        return Err(RetentionError::Storage);
    }
    let settings = RetentionSettings {
        enabled: file.enabled,
        retention_days: file.retention_days,
        backup_keep: file.backup_keep,
    };
    settings.validate().map_err(|_| RetentionError::Storage)?;
    Ok(settings)
}

pub(crate) fn save(
    paths: &RetentionPaths,
    settings: &RetentionSettings,
) -> Result<(), RetentionError> {
    settings.validate()?;
    let file = SettingsFile {
        version: VERSION,
        enabled: settings.enabled,
        retention_days: settings.retention_days,
        backup_keep: settings.backup_keep,
    };
    let bytes = serde_json::to_vec_pretty(&file).map_err(|_| RetentionError::Storage)?;
    fsutil::write_atomic(&paths.settings_file(), &bytes).map_err(|_| RetentionError::Storage)
}

pub(crate) fn update(
    paths: &RetentionPaths,
    update: SettingsUpdate,
) -> Result<RetentionSettings, RetentionError> {
    let current = load(paths)?;
    let next = RetentionSettings {
        enabled: update.enabled.unwrap_or(current.enabled),
        retention_days: update.retention_days.unwrap_or(current.retention_days),
        backup_keep: update.backup_keep.unwrap_or(current.backup_keep),
    };
    next.validate()?;
    save(paths, &next)?;
    Ok(next)
}
