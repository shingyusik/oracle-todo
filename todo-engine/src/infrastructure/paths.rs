use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow};

pub fn todo_home(explicit_home: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(home) = explicit_home {
        return Ok(home);
    }
    if let Some(home) = std::env::var_os("TODO_ENGINE_HOME") {
        return Ok(PathBuf::from(home));
    }
    default_home().ok_or_else(|| anyhow!("HOME is not set"))
}

/// The default data home: `$HOME/.todo-engine`.
pub fn default_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".todo-engine"))
}

/// The pre-rebrand data home: `$HOME/.hermes/oracle-todo` (for migration warnings only).
pub fn legacy_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".hermes/oracle-todo"))
}

pub fn db_path(home: &Path) -> PathBuf {
    home.join("todo.sqlite")
}
