use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow};

pub fn todo_home(explicit_home: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(home) = explicit_home {
        return Ok(home);
    }
    if let Some(home) = std::env::var_os("ORACLE_TODO_HOME") {
        return Ok(PathBuf::from(home));
    }
    let home = std::env::var_os("HOME").ok_or_else(|| anyhow!("HOME is not set"))?;
    Ok(PathBuf::from(home).join(".hermes/oracle-todo"))
}

pub fn db_path(home: &Path) -> PathBuf {
    home.join("todo.sqlite")
}

pub fn exports_dir(home: &Path) -> PathBuf {
    home.join("exports")
}
