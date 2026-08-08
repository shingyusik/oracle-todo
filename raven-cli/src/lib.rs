pub mod cli;
pub mod commands;
pub mod config;
pub mod logging;

use std::ffi::OsString;
use std::time::Instant;

use anyhow::Result;
use clap::Parser;

use crate::cli::Cli;
use crate::config::RavenPaths;

pub fn run() -> Result<()> {
    load_dotenv()?;
    run_from(std::env::args_os())
}

pub fn run_from<I, T>(args: I) -> Result<()>
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    let cli = Cli::parse_from(args);
    let paths = RavenPaths::resolve(cli.home)?;
    logging::init(&paths);

    let command = cli.command.label();
    let engine = cli.command.engine();
    tracing::info!(
        event = "command_started",
        command,
        engine,
        "command started"
    );
    let started_at = Instant::now();
    let result = commands::execute(&paths, cli.command);
    let duration_ms = elapsed_millis(started_at);

    match &result {
        Ok(()) => tracing::info!(
            event = "command_completed",
            command,
            engine,
            duration_ms,
            exit_code = 0_i32,
            "command completed"
        ),
        Err(error) if exit_code(error) == 0 => tracing::info!(
            event = "command_completed",
            command,
            engine,
            duration_ms,
            exit_code = 0_i32,
            "command completed"
        ),
        Err(error) => tracing::error!(
            event = "command_failed",
            command,
            engine,
            duration_ms,
            exit_code = exit_code(error),
            "command failed"
        ),
    }

    result
}

pub fn exit_code(error: &anyhow::Error) -> i32 {
    if let Some(error) = error.downcast_ref::<clap::Error>() {
        return error.exit_code();
    }
    if let Some(error) = error.downcast_ref::<commands::import::ImportTodoError>() {
        return error.cli_exit_code();
    }
    if let Some(error) = error.downcast_ref::<commands::api::ApiCommandError>() {
        return error.cli_exit_code();
    }
    if let Some(error) = error.downcast_ref::<commands::ui::UiCommandError>() {
        return error.cli_exit_code();
    }
    if let Some(error) = error.downcast_ref::<ledger_engine::application::error::LedgerError>() {
        return match error {
            ledger_engine::application::error::LedgerError::Validation { .. }
            | ledger_engine::application::error::LedgerError::Conflict(_)
            | ledger_engine::application::error::LedgerError::ConfirmationMismatch => 2,
            ledger_engine::application::error::LedgerError::NotFound(_) => 4,
            ledger_engine::application::error::LedgerError::Busy(_)
            | ledger_engine::application::error::LedgerError::Storage(_)
            | ledger_engine::application::error::LedgerError::Migration(_) => 1,
        };
    }
    if let Some(error) = error.downcast_ref::<health_engine::application::error::HealthError>() {
        use health_engine::application::error::HealthError;
        return match error {
            HealthError::Validation { .. }
            | HealthError::Conflict(_)
            | HealthError::UnsupportedMedia
            | HealthError::MediaTooLarge
            | HealthError::ConfirmationMismatch => 2,
            HealthError::NotFound(_) => 4,
            HealthError::Busy(_)
            | HealthError::Storage(_)
            | HealthError::Migration(_)
            | HealthError::Cleanup { .. }
            | HealthError::CleanupPending { .. } => 1,
        };
    }
    todo_engine::application::error::TodoError::cli_exit_code_from_error(error).unwrap_or(1)
}

fn elapsed_millis(started_at: Instant) -> u64 {
    started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

fn load_dotenv() -> Result<()> {
    match dotenvy::dotenv() {
        Ok(_) => Ok(()),
        Err(error) if error.not_found() => Ok(()),
        Err(error) => Err(anyhow::Error::new(error).context(
            "failed to parse .env (single-quote values containing backslashes, e.g. \
             RAVEN_HOME='C:\\path\\to\\home')",
        )),
    }
}
