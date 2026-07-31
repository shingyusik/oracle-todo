pub mod api;
pub mod health;
pub mod import;
pub mod init;
pub mod ledger;
pub mod todo;
pub mod ui;

use anyhow::Result;
use health_engine::infrastructure::sqlite::{HealthStorageHealth, SqliteHealthRepository};
use ledger_engine::infrastructure::sqlite::{LedgerHealth, SqliteLedgerRepository};
use todo_engine::interfaces::cli::TodoHealth;

use crate::cli::{Command, ImportCommand};
use crate::config::RavenPaths;

pub fn execute(paths: &RavenPaths, command: Command) -> Result<()> {
    match command {
        Command::Init => init::run(paths),
        Command::HealthCheck => health_check(paths),
        Command::Import {
            command: ImportCommand::Todo { source_home },
        } => import::run(paths, source_home),
        Command::Todo { args } => todo::run(paths, args),
        Command::Ledger { command } => ledger::run(paths, *command),
        Command::Health { command } => health::run(paths, *command),
        Command::Api => api::run(paths),
        Command::Ui(args) => ui::run(paths, args),
    }
}

fn health_check(paths: &RavenPaths) -> Result<()> {
    let todo = todo_engine::interfaces::cli::health_at(paths.home());
    let ledger = SqliteLedgerRepository::health_at(paths.ledger_db());
    let health = SqliteHealthRepository::health_at(paths.health_db());
    let media_ready = std::fs::symlink_metadata(paths.health_media_dir())
        .is_ok_and(|metadata| metadata.file_type().is_dir());
    println!(
        "{} {} {} media={}",
        todo_health_output(todo),
        ledger_health_output(ledger),
        health_storage_output(health),
        if media_ready { "ok" } else { "not_initialized" },
    );
    match (todo, ledger, health, media_ready) {
        (
            TodoHealth::Healthy { .. },
            LedgerHealth::Healthy { .. },
            HealthStorageHealth::Healthy { .. },
            true,
        ) => Ok(()),
        (TodoHealth::NotInitialized, _, _, _) => anyhow::bail!("ToDo database is not initialized"),
        (TodoHealth::Unavailable, _, _, _) => anyhow::bail!("ToDo database is unavailable"),
        (_, LedgerHealth::NotInitialized, _, _) => {
            anyhow::bail!("Ledger database is not initialized")
        }
        (_, LedgerHealth::Unavailable, _, _) => anyhow::bail!("Ledger database is unavailable"),
        (_, _, HealthStorageHealth::NotInitialized, _) => {
            anyhow::bail!("Health database is not initialized")
        }
        (_, _, HealthStorageHealth::Unavailable, _) => {
            anyhow::bail!("Health database is unavailable")
        }
        (_, _, _, false) => anyhow::bail!("Health media directory is not initialized"),
    }
}

fn todo_health_output(health: TodoHealth) -> String {
    match health {
        TodoHealth::Healthy { user_version } => format!("todo=ok user_version={user_version}"),
        TodoHealth::NotInitialized => "todo=not_initialized".to_string(),
        TodoHealth::Unavailable => "todo=unavailable".to_string(),
    }
}

fn ledger_health_output(health: LedgerHealth) -> String {
    match health {
        LedgerHealth::Healthy { user_version } => {
            format!("ledger=ok user_version={user_version}")
        }
        LedgerHealth::NotInitialized => "ledger=not_initialized".to_string(),
        LedgerHealth::Unavailable => "ledger=unavailable".to_string(),
    }
}

fn health_storage_output(health: HealthStorageHealth) -> String {
    match health {
        HealthStorageHealth::Healthy { user_version } => {
            format!("health=ok user_version={user_version}")
        }
        HealthStorageHealth::NotInitialized => "health=not_initialized".to_string(),
        HealthStorageHealth::Unavailable => "health=unavailable".to_string(),
    }
}
