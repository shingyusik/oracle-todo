use std::ffi::OsString;
use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
    name = "raven",
    about = "Raven unified personal engine",
    arg_required_else_help = true
)]
pub struct Cli {
    #[arg(long, env = "RAVEN_HOME")]
    pub home: Option<PathBuf>,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Initialize Raven's data home and available engines.
    Init,
    /// Report the initialization and health of each engine.
    HealthCheck,
    /// Run an existing ToDo command.
    #[command(disable_help_flag = true)]
    Todo {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<OsString>,
    },
}

impl Command {
    pub(crate) fn label(&self) -> &'static str {
        match self {
            Self::Init => "init",
            Self::HealthCheck => "health-check",
            Self::Todo { .. } => "todo",
        }
    }

    pub(crate) fn engine(&self) -> &'static str {
        match self {
            Self::Todo { .. } => "todo",
            Self::Init | Self::HealthCheck => "raven",
        }
    }
}
