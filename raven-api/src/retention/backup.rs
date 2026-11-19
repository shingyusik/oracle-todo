//! Pre-purge backups: `VACUUM INTO` per affected store plus the Health photos to be
//! deleted, verified, then published by an atomic rename.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Instant;

use health_engine::infrastructure::media::LocalMediaStore;
use rusqlite::{Connection, OpenFlags};
use serde_json::json;
use time::OffsetDateTime;
use time::macros::format_description;

use super::plan::EnginePlan;
use super::state::format_instant;
use super::{Domain, LOG_TARGET, RetentionPaths, fsutil};

const BUSY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const MEDIA_DIR: &str = "media";

/// Classified failure; the kind is safe to log.
#[derive(Debug)]
pub(crate) struct BackupError(pub &'static str);

impl From<io::Error> for BackupError {
    fn from(_: io::Error) -> Self {
        BackupError("io")
    }
}

impl From<rusqlite::Error> for BackupError {
    fn from(_: rusqlite::Error) -> Self {
        BackupError("sqlite")
    }
}

/// `YYYYMMDDTHHMMSSZ`, the only folder shape rotation ever touches.
pub(crate) fn is_backup_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() == 16
        && bytes[8] == b'T'
        && bytes[15] == b'Z'
        && bytes[..8].iter().all(u8::is_ascii_digit)
        && bytes[9..15].iter().all(u8::is_ascii_digit)
}

pub(crate) fn backup_name(at: OffsetDateTime) -> String {
    at.to_offset(time::UtcOffset::UTC)
        .format(format_description!(
            "[year][month][day]T[hour][minute][second]Z"
        ))
        .unwrap_or_default()
}

/// Relative paths of the Health photos `apply` would delete.
pub(crate) fn health_media_paths(paths: &RetentionPaths, plan: &EnginePlan) -> Vec<PathBuf> {
    let EnginePlan::Health(plan) = plan else {
        return Vec::new();
    };
    if !plan
        .candidates
        .iter()
        .any(|candidate| candidate.kind == health_engine::application::retention::KIND_MEDIA)
    {
        return Vec::new();
    }
    let Ok(repository) =
        health_engine::infrastructure::sqlite::SqliteHealthRepository::open_read_only(
            &paths.health_db,
        )
    else {
        return Vec::new();
    };
    let Ok(store) = LocalMediaStore::open_existing(&paths.health_media_dir) else {
        return Vec::new();
    };
    health_engine::application::service::HealthService::new(repository, store)
        .retention_media_paths(plan)
}

/// Bytes the backup is expected to need: store files (+WAL) and photos.
pub(crate) fn estimate_bytes(
    paths: &RetentionPaths,
    due: &[(Domain, &EnginePlan)],
    media: &[PathBuf],
) -> u64 {
    let size = |path: &Path| fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let mut total = 0_u64;
    for (domain, _) in due {
        let db = paths.db(*domain);
        total = total.saturating_add(size(db));
        let mut wal = db.as_os_str().to_owned();
        wal.push("-wal");
        total = total.saturating_add(size(Path::new(&wal)));
    }
    for relative in media {
        total = total.saturating_add(size(&paths.health_media_dir.join(relative)));
    }
    total
}

pub(crate) struct CreateRequest<'a> {
    pub run_id: &'a str,
    pub now: OffsetDateTime,
    pub retention_days: u32,
    pub due: &'a [(Domain, &'a EnginePlan)],
    pub media: &'a [PathBuf],
}

/// Creates and publishes one backup folder; returns its name.
pub(crate) fn create(
    paths: &RetentionPaths,
    request: &CreateRequest<'_>,
) -> Result<String, BackupError> {
    let root = paths.backups_dir();
    if let Some(parent) = root.parent() {
        fsutil::ensure_private_dir(parent)?;
    }
    fsutil::ensure_private_dir(&root)?;
    let temp = root.join(format!(".tmp-{}", request.run_id));
    fs::create_dir(&temp)?;
    fsutil::restrict_dir(&temp)?;
    let result = fill(paths, &temp, request).and_then(|()| publish(&root, &temp, request.now));
    if result.is_err() {
        let _ = fs::remove_dir_all(&temp);
    }
    result
}

fn fill(
    paths: &RetentionPaths,
    temp: &Path,
    request: &CreateRequest<'_>,
) -> Result<(), BackupError> {
    let mut domains = BTreeMap::new();
    for (domain, plan) in request.due {
        let started = Instant::now();
        let file = temp.join(format!("{}.sqlite", domain.as_str()));
        let user_version = vacuum_into(paths.db(*domain), &file)?;
        let bytes = fs::metadata(&file)?.len();
        tracing::info!(
            target: LOG_TARGET,
            event = "retention_backup_created",
            domain = domain.as_str(),
            bytes,
            elapsed_ms = elapsed_ms(started),
            "retention backup created"
        );
        domains.insert(
            domain.as_str(),
            json!({
                "user_version": user_version,
                "bytes": bytes,
                "candidates": plan.kind_counts(),
            }),
        );
    }
    let mut media_files = 0_u64;
    let mut media_bytes = 0_u64;
    if !request.media.is_empty() {
        let started = Instant::now();
        let store = LocalMediaStore::open_existing(&paths.health_media_dir)
            .map_err(|_| BackupError("media"))?;
        let dest = temp.join(MEDIA_DIR);
        fsutil::ensure_private_dir(&dest)?;
        for relative in request.media {
            if let Some(bytes) = store
                .copy_media_for_backup(relative, &dest)
                .map_err(|_| BackupError("media"))?
            {
                media_files += 1;
                media_bytes = media_bytes.saturating_add(bytes);
            }
        }
        tracing::info!(
            target: LOG_TARGET,
            event = "retention_backup_created",
            domain = "health_media",
            bytes = media_bytes,
            elapsed_ms = elapsed_ms(started),
            "retention backup created"
        );
    }
    let manifest = json!({
        "version": 1,
        "created_at": format_instant(request.now),
        "retention_days": request.retention_days,
        "domains": domains,
        "media": { "files": media_files, "bytes": media_bytes },
    });
    let manifest_path = temp.join("manifest.json");
    let mut file = fsutil::create_private_file(&manifest_path)?;
    io::Write::write_all(
        &mut file,
        &serde_json::to_vec_pretty(&manifest).map_err(|_| BackupError("manifest"))?,
    )?;
    file.sync_all()?;
    Ok(())
}

/// Copies a consistent snapshot and verifies it. Returns the schema version.
fn vacuum_into(source: &Path, dest: &Path) -> Result<i64, BackupError> {
    let connection = Connection::open_with_flags(
        source,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    connection.busy_timeout(BUSY_TIMEOUT)?;
    let source_version: i64 = connection.pragma_query_value(None, "user_version", |r| r.get(0))?;
    let dest_text = dest.to_str().ok_or(BackupError("path"))?;
    connection.execute("VACUUM INTO ?1", [dest_text])?;
    drop(connection);
    fsutil::restrict_file(dest)?;

    let copy = Connection::open_with_flags(
        dest,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let check: Vec<String> = copy
        .prepare("PRAGMA quick_check")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<_, _>>()?;
    if check != ["ok"] {
        return Err(BackupError("quick_check"));
    }
    let copy_version: i64 = copy.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if copy_version != source_version {
        return Err(BackupError("user_version"));
    }
    Ok(source_version)
}

fn publish(root: &Path, temp: &Path, now: OffsetDateTime) -> Result<String, BackupError> {
    fsutil::sync_dir(temp)?;
    for offset in 0..60 {
        let name = backup_name(now + time::Duration::seconds(offset));
        let target = root.join(&name);
        if fs::symlink_metadata(&target).is_ok() {
            continue;
        }
        fs::rename(temp, &target)?;
        fsutil::sync_dir(root)?;
        return Ok(name);
    }
    Err(BackupError("name"))
}

/// Keeps the newest `keep` backup folders; anything not matching the name shape is ignored.
pub(crate) fn rotate(paths: &RetentionPaths, keep: u32) -> io::Result<usize> {
    let root = paths.backups_dir();
    let mut names = Vec::new();
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if is_backup_name(&name) && fs::symlink_metadata(entry.path())?.is_dir() {
            names.push(name);
        }
    }
    names.sort_unstable_by(|left, right| right.cmp(left));
    let mut removed = 0;
    for name in names.into_iter().skip(keep as usize) {
        fs::remove_dir_all(root.join(name))?;
        removed += 1;
    }
    Ok(removed)
}

pub(crate) fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}
