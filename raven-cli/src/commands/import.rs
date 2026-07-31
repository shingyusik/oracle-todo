use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags};
use tempfile::NamedTempFile;
use todo_engine::interfaces::cli::{TODO_SCHEMA_VERSION, TodoHealth};

use crate::config::RavenPaths;

#[derive(Debug, PartialEq, Eq)]
pub struct ImportReport {
    pub source: PathBuf,
    pub destination: PathBuf,
    pub integrity_check: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ImportTodoError {
    #[error("destination already exists: {0}")]
    DestinationExists(PathBuf),
    #[error("imported database failed integrity_check: {0}")]
    Integrity(String),
    #[error("unsupported ToDo schema version: {0}")]
    UnsupportedSchemaVersion(i64),
    #[error("imported database failed ToDo schema health validation")]
    SchemaHealth,
    #[error(
        "imported database WAL checkpoint incomplete: busy={busy}, log={log}, checkpointed={checkpointed}"
    )]
    WalCheckpoint {
        busy: i64,
        log: i64,
        checkpointed: i64,
    },
    #[error("imported database journal mode remained {0}")]
    JournalMode(String),
    #[error("import-owned WAL remained non-empty after close: {0} bytes")]
    NonEmptyWal(u64),
    #[error("import-owned {0} sidecar was not a regular file")]
    SidecarOwnership(&'static str),
    #[error("import-owned sidecar cleanup failed: {0}")]
    SidecarCleanup(std::io::Error),
    #[error("{primary}; temporary import cleanup also failed: {cleanup}")]
    Cleanup {
        primary: Box<ImportTodoError>,
        cleanup: std::io::Error,
    },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Todo(#[from] todo_engine::application::error::TodoError),
}

impl ImportTodoError {
    pub(crate) fn cli_exit_code(&self) -> i32 {
        match self {
            Self::DestinationExists(_) => 2,
            Self::Cleanup { primary, .. } => primary.cli_exit_code(),
            Self::Integrity(_)
            | Self::UnsupportedSchemaVersion(_)
            | Self::SchemaHealth
            | Self::WalCheckpoint { .. }
            | Self::JournalMode(_)
            | Self::NonEmptyWal(_)
            | Self::SidecarOwnership(_)
            | Self::SidecarCleanup(_)
            | Self::Io(_)
            | Self::Sqlite(_)
            | Self::Todo(_) => 1,
        }
    }
}

pub fn import_todo(
    source_home: &Path,
    paths: &RavenPaths,
) -> Result<ImportReport, ImportTodoError> {
    import_todo_before_publish(source_home, paths, || {})
}

fn import_todo_before_publish(
    source_home: &Path,
    paths: &RavenPaths,
    before_publish: impl FnOnce(),
) -> Result<ImportReport, ImportTodoError> {
    let source_path = source_home.join("todo.sqlite");
    let destination_path = paths.todo_db();
    match std::fs::symlink_metadata(&destination_path) {
        Ok(_) => {
            return Err(ImportTodoError::DestinationExists(destination_path));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }

    let source = Connection::open_with_flags(&source_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    // A read-only WAL reader may update SQLite's shared-memory WAL index
    // (`-shm`), but it never initializes or writes durable source data.
    std::fs::create_dir_all(paths.home())?;
    let temporary = NamedTempFile::new_in(paths.home())?;

    let integrity_check = match copy_and_validate(&source, temporary.path()) {
        Ok(integrity_check) => integrity_check,
        Err(error) => {
            return Err(cleanup_after_error(temporary, error));
        }
    };
    if let Err(error) = remove_empty_owned_sidecars(temporary.path()) {
        return Err(cleanup_after_error(temporary, error));
    }
    before_publish();

    match temporary.persist_noclobber(&destination_path) {
        Ok(file) => {
            drop(file);
            Ok(ImportReport {
                source: source_path,
                destination: destination_path,
                integrity_check,
            })
        }
        Err(error) => {
            let tempfile::PersistError { error, file } = error;
            let primary = if error.kind() == std::io::ErrorKind::AlreadyExists {
                ImportTodoError::DestinationExists(destination_path)
            } else {
                ImportTodoError::Io(error)
            };
            Err(cleanup_after_error(file, primary))
        }
    }
}

fn cleanup_after_error(temporary: NamedTempFile, primary: ImportTodoError) -> ImportTodoError {
    let mut failures = Vec::new();
    if let Err(error) = remove_owned_sidecars(temporary.path()) {
        failures.push(safe_io_summary("sidecars", &error));
    }
    if let Err(error) = temporary.close() {
        failures.push(safe_io_summary("temporary main", &error));
    }
    if failures.is_empty() {
        primary
    } else {
        ImportTodoError::Cleanup {
            primary: Box::new(primary),
            cleanup: std::io::Error::other(failures.join("; ")),
        }
    }
}

fn safe_io_summary(label: &str, error: &std::io::Error) -> String {
    format!(
        "{label} cleanup failed (kind={:?}, os_error={:?})",
        error.kind(),
        error.raw_os_error()
    )
}

fn sidecar_path(main: &Path, suffix: &str) -> PathBuf {
    let mut path = main.as_os_str().to_os_string();
    path.push(suffix);
    PathBuf::from(path)
}

fn sidecar_metadata(
    path: &Path,
    label: &'static str,
) -> Result<Option<std::fs::Metadata>, ImportTodoError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(Some(metadata)),
        Ok(_) => Err(ImportTodoError::SidecarOwnership(label)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ImportTodoError::SidecarCleanup(error)),
    }
}

fn remove_empty_owned_sidecars(main: &Path) -> Result<(), ImportTodoError> {
    let wal = sidecar_path(main, "-wal");
    if let Some(metadata) = sidecar_metadata(&wal, "WAL")? {
        if metadata.len() != 0 {
            return Err(ImportTodoError::NonEmptyWal(metadata.len()));
        }
    }
    remove_owned_sidecars(main).map_err(ImportTodoError::SidecarCleanup)?;
    for (label, path) in [
        ("WAL", sidecar_path(main, "-wal")),
        ("SHM", sidecar_path(main, "-shm")),
    ] {
        if sidecar_metadata(&path, label)?.is_some() {
            return Err(ImportTodoError::SidecarCleanup(std::io::Error::other(
                format!("{label} sidecar remained after cleanup"),
            )));
        }
    }
    Ok(())
}

fn remove_owned_sidecars(main: &Path) -> std::io::Result<()> {
    let mut failures = Vec::new();
    for (label, path) in [
        ("WAL", sidecar_path(main, "-wal")),
        ("SHM", sidecar_path(main, "-shm")),
    ] {
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_file() => {
                if let Err(error) = std::fs::remove_file(&path) {
                    failures.push(safe_io_summary(label, &error));
                }
            }
            Ok(_) => failures.push(format!("{label} sidecar was not a regular file")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => failures.push(safe_io_summary(label, &error)),
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(std::io::Error::other(failures.join("; ")))
    }
}

fn copy_and_validate(
    source: &Connection,
    destination_path: &Path,
) -> Result<String, ImportTodoError> {
    let mut destination =
        Connection::open_with_flags(destination_path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    rusqlite::backup::Backup::new(source, &mut destination)?.run_to_completion(
        64,
        Duration::from_millis(10),
        None,
    )?;
    let source_schema_version = todo_engine::infrastructure::sqlite::user_version(&destination)?;
    if !matches!(source_schema_version, 0 | TODO_SCHEMA_VERSION) {
        return Err(ImportTodoError::UnsupportedSchemaVersion(
            source_schema_version,
        ));
    }
    todo_engine::infrastructure::sqlite::init_schema(&destination)?;
    normalize_to_self_contained_main(&destination)?;
    let integrity_check = destination.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity_check != "ok" {
        return Err(ImportTodoError::Integrity(integrity_check));
    }
    drop(destination);
    if todo_engine::interfaces::cli::health_db_at(destination_path)
        != (TodoHealth::Healthy {
            user_version: TODO_SCHEMA_VERSION,
        })
    {
        return Err(ImportTodoError::SchemaHealth);
    }
    Ok(integrity_check)
}

fn normalize_to_self_contained_main(destination: &Connection) -> Result<(), ImportTodoError> {
    let (busy, log, checkpointed) =
        destination.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
    if busy != 0 || log != checkpointed {
        return Err(ImportTodoError::WalCheckpoint {
            busy,
            log,
            checkpointed,
        });
    }
    let journal_mode: String =
        destination.query_row("PRAGMA journal_mode = DELETE", [], |row| row.get(0))?;
    if !journal_mode.eq_ignore_ascii_case("delete") {
        return Err(ImportTodoError::JournalMode(journal_mode));
    }
    Ok(())
}

pub fn run(paths: &RavenPaths, source_home: Option<PathBuf>) -> Result<()> {
    let source_home = source_home
        .or_else(todo_engine::infrastructure::paths::default_home)
        .context("HOME is not set")?;
    let report = import_todo(&source_home, paths)?;
    println!(
        "todo import ok source={} destination={} integrity_check={}",
        report.source.display(),
        report.destination.display(),
        report.integrity_check
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_preserves_primary_error_and_does_not_remove_unowned_sidecar() {
        let home = tempfile::tempdir().unwrap();
        let temporary = NamedTempFile::new_in(home.path()).unwrap();
        let temporary_path = temporary.path().to_path_buf();
        let unowned_wal = sidecar_path(&temporary_path, "-wal");
        std::fs::create_dir(&unowned_wal).unwrap();
        let marker = unowned_wal.join("protected");
        std::fs::write(&marker, b"protected sidecar data").unwrap();

        let error = cleanup_after_error(temporary, ImportTodoError::UnsupportedSchemaVersion(999));

        let ImportTodoError::Cleanup { primary, cleanup } = error else {
            panic!("cleanup failure must retain the primary error");
        };
        assert!(matches!(
            *primary,
            ImportTodoError::UnsupportedSchemaVersion(999)
        ));
        assert!(cleanup.to_string().contains("sidecars cleanup failed"));
        assert_eq!(
            std::fs::read(marker).unwrap(),
            b"protected sidecar data",
            "non-regular sidecars are not import-owned cleanup targets"
        );
        assert!(!temporary_path.exists());
    }

    #[test]
    fn publication_conflict_preserves_intervening_destination_file() {
        let source = tempfile::tempdir().unwrap();
        todo_engine::interfaces::cli::run_at(source.path(), ["todo-engine", "init"]).unwrap();
        let destination = tempfile::tempdir().unwrap();
        let paths = RavenPaths::from_home(destination.path());
        let destination_path = paths.todo_db();
        let intervening = b"intervening Raven data";

        let error = import_todo_before_publish(source.path(), &paths, || {
            std::fs::write(&destination_path, intervening).unwrap();
        })
        .unwrap_err();

        assert!(matches!(
            error,
            ImportTodoError::DestinationExists(path) if path == destination_path
        ));
        assert_eq!(std::fs::read(&destination_path).unwrap(), intervening);
        assert_eq!(
            std::fs::read_dir(destination.path()).unwrap().count(),
            1,
            "the import-owned temporary database must be cleaned up"
        );
    }

    #[cfg(unix)]
    #[test]
    fn publication_conflict_preserves_intervening_destination_symlink() {
        use std::os::unix::fs::symlink;

        let source = tempfile::tempdir().unwrap();
        todo_engine::interfaces::cli::run_at(source.path(), ["todo-engine", "init"]).unwrap();
        let destination = tempfile::tempdir().unwrap();
        let paths = RavenPaths::from_home(destination.path());
        let destination_path = paths.todo_db();
        let protected = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(protected.path(), b"protected Raven data").unwrap();

        let error = import_todo_before_publish(source.path(), &paths, || {
            symlink(protected.path(), &destination_path).unwrap();
        })
        .unwrap_err();

        assert!(matches!(
            error,
            ImportTodoError::DestinationExists(path) if path == destination_path
        ));
        assert!(
            std::fs::symlink_metadata(&destination_path)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(
            std::fs::read(protected.path()).unwrap(),
            b"protected Raven data"
        );
        assert_eq!(
            std::fs::read_dir(destination.path()).unwrap().count(),
            1,
            "the import-owned temporary database must be cleaned up"
        );
    }
}
