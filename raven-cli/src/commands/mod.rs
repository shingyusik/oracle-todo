pub mod import;
pub mod init;
pub mod todo;

use anyhow::Result;
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
    }
}

fn health_check(paths: &RavenPaths) -> Result<()> {
    match todo_engine::interfaces::cli::health_at(paths.home()) {
        TodoHealth::Healthy { user_version } => {
            println!(
                "todo=ok user_version={user_version} \
                 ledger=not_initialized health=not_initialized"
            );
            Ok(())
        }
        TodoHealth::NotInitialized => {
            println!("todo=not_initialized ledger=not_initialized health=not_initialized");
            anyhow::bail!("ToDo database is not initialized")
        }
        TodoHealth::Unavailable => {
            println!("todo=unavailable ledger=not_initialized health=not_initialized");
            anyhow::bail!("ToDo database is unavailable")
        }
    }
}
