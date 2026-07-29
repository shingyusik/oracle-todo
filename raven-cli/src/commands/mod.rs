pub mod init;
pub mod todo;

use anyhow::Result;

use crate::cli::Command;
use crate::config::RavenPaths;

pub fn execute(paths: &RavenPaths, command: Command) -> Result<()> {
    match command {
        Command::Init => init::run(paths),
        Command::HealthCheck => health_check(paths),
        Command::Todo { args } => todo::run(paths, args),
    }
}

fn health_check(paths: &RavenPaths) -> Result<()> {
    todo::run(paths, ["health"])?;
    println!(
        "ledger={} health={}",
        database_status(paths.ledger_db().exists()),
        database_status(paths.health_db().exists())
    );
    Ok(())
}

fn database_status(initialized: bool) -> &'static str {
    if initialized {
        "available"
    } else {
        "not_initialized"
    }
}
