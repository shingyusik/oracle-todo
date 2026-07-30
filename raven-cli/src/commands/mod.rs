pub mod import;
pub mod init;
pub mod ledger;
pub mod todo;

use anyhow::Result;
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
    }
}

fn health_check(paths: &RavenPaths) -> Result<()> {
    let todo = todo_engine::interfaces::cli::health_at(paths.home());
    let ledger = SqliteLedgerRepository::health_at(paths.ledger_db());
    println!(
        "{} {} health=not_initialized",
        todo_health_output(todo),
        ledger_health_output(ledger)
    );
    match (todo, ledger) {
        (TodoHealth::Healthy { .. }, LedgerHealth::Healthy { .. }) => Ok(()),
        (TodoHealth::NotInitialized, _) => anyhow::bail!("ToDo database is not initialized"),
        (TodoHealth::Unavailable, _) => anyhow::bail!("ToDo database is unavailable"),
        (_, LedgerHealth::NotInitialized) => anyhow::bail!("Ledger database is not initialized"),
        (_, LedgerHealth::Unavailable) => anyhow::bail!("Ledger database is unavailable"),
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
