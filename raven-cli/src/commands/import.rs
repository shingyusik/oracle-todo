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
    match temporary.close() {
        Ok(()) => primary,
        Err(cleanup) => ImportTodoError::Cleanup {
            primary: Box::new(primary),
            cleanup,
        },
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
