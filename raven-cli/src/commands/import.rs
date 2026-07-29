use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags};

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
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Todo(#[from] todo_engine::application::error::TodoError),
}

pub fn import_todo(
    source_home: &Path,
    paths: &RavenPaths,
) -> Result<ImportReport, ImportTodoError> {
    let source_path = source_home.join("todo.sqlite");
    let destination_path = paths.todo_db();
    let source = Connection::open_with_flags(&source_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;

    std::fs::create_dir_all(paths.home())?;
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination_path)
    {
        Ok(file) => drop(file),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(ImportTodoError::DestinationExists(destination_path));
        }
        Err(error) => return Err(error.into()),
    }

    match copy_and_validate(&source, &destination_path) {
        Ok(integrity_check) => Ok(ImportReport {
            source: source_path,
            destination: destination_path,
            integrity_check,
        }),
        Err(error) => {
            std::fs::remove_file(&destination_path)?;
            Err(error)
        }
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
    todo_engine::infrastructure::sqlite::init_schema(&destination)?;
    let integrity_check = destination.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity_check != "ok" {
        return Err(ImportTodoError::Integrity(integrity_check));
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
