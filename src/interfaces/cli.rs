use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand};

use crate::application::service::{ProposeTask, TodoService};
use crate::domain::Actor;
use crate::infrastructure::paths::{db_path, todo_home};
use crate::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema, user_version};

#[derive(Debug, Parser)]
#[command(name = "oracle-todo")]
#[command(about = "Policy-enforced Oracle ToDo engine")]
struct Cli {
    /// Data home. Defaults to ORACLE_TODO_HOME or ~/.hermes/oracle-todo.
    #[arg(long, env = "ORACLE_TODO_HOME")]
    home: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Initialize the SQLite database.
    Init,
    /// Check database reachability and schema baseline.
    Health,
    /// Manage tasks.
    Task {
        #[command(subcommand)]
        command: TaskCommand,
    },
}

#[derive(Debug, Subcommand)]
enum TaskCommand {
    /// Propose a task.
    Propose(TaskProposeArgs),
}

#[derive(Debug, Args)]
struct TaskProposeArgs {
    title: String,
    #[arg(long)]
    area: Option<String>,
    #[arg(long)]
    due: Option<String>,
    #[arg(long)]
    scheduled: Option<String>,
    #[arg(long)]
    priority: Option<i64>,
    #[arg(long)]
    description: Option<String>,
    #[arg(long, default_value = "oracle", value_parser = parse_actor)]
    actor: Actor,
}

pub fn run() -> Result<()> {
    let cli = Cli::parse();
    let home = todo_home(cli.home)?;

    match cli.command {
        Command::Init => init(&home),
        Command::Health => health(&home),
        Command::Task {
            command: TaskCommand::Propose(args),
        } => task_propose(&home, args),
    }
}

fn init(home: &Path) -> Result<()> {
    std::fs::create_dir_all(home)?;
    let db_path = db_path(home);
    let conn = connect_path(&db_path)?;
    init_schema(&conn)?;
    println!("initialized {}", db_path.display());
    Ok(())
}

fn health(home: &Path) -> Result<()> {
    let db_path = db_path(home);
    let conn = connect_path(&db_path)?;
    let user_version = user_version(&conn)?;
    println!("ok db={} user_version={}", db_path.display(), user_version);
    Ok(())
}

fn task_propose(home: &Path, args: TaskProposeArgs) -> Result<()> {
    let db_path = db_path(home);
    let conn = connect_path(&db_path)?;
    init_schema(&conn)?;
    let repo = SqliteTodoRepository::new(conn);
    let mut service = TodoService::persistent(repo);
    let item = service.propose_task(
        args.title,
        ProposeTask {
            actor: args.actor,
            area: args.area,
            due: args.due,
            scheduled: args.scheduled,
            priority: args.priority,
            description: args.description,
            ..Default::default()
        },
    )?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn connect_path(path: &Path) -> Result<rusqlite::Connection> {
    let path = path
        .to_str()
        .with_context(|| format!("database path is not valid UTF-8: {}", path.display()))?;
    connect(path).map_err(Into::into)
}

fn parse_actor(value: &str) -> std::result::Result<Actor, String> {
    match value {
        "oracle" => Ok(Actor::Oracle),
        "user" => Ok(Actor::User),
        "system" => Ok(Actor::System),
        other => Err(format!(
            "invalid actor '{other}'; expected one of: oracle, user, system"
        )),
    }
}
