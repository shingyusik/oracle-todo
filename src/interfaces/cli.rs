use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand};
use std::str::FromStr;

use crate::application::error::TodoError;
use crate::application::service::{
    CreateArea, ProposeEvent, ProposeProject, ProposeRoutine, ProposeTask, TodoService,
};
use crate::domain::Actor;
use crate::exports::{current_today_items, pending_items, render_items, write_current_exports};
use crate::infrastructure::paths::{db_path, exports_dir, todo_home};
use crate::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema, user_version};
use crate::infrastructure::system::{OperationalLogger, init_tracing, local_today_string};

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
    /// Create and maintain areas.
    Area {
        #[command(subcommand)]
        command: AreaCommand,
    },
    /// Manage projects.
    Project {
        #[command(subcommand)]
        command: ProjectCommand,
    },
    /// Manage tasks.
    Task {
        #[command(subcommand)]
        command: TaskCommand,
    },
    /// Manage routines.
    Routine {
        #[command(subcommand)]
        command: RoutineCommand,
    },
    /// Manage scheduled events and external commitments.
    Event {
        #[command(subcommand)]
        command: EventCommand,
    },
    /// Activate an approved or user-created item.
    Activate(ActivateArgs),
    /// Show proposed, approved, and active work.
    Pending,
    /// Show today's materialized task view.
    Today,
    /// Write markdown exports.
    Export,
}

#[derive(Debug, Subcommand)]
enum AreaCommand {
    /// Create an active area.
    Create(AreaCreateArgs),
}

#[derive(Debug, Subcommand)]
enum ProjectCommand {
    /// Propose a project.
    Propose(ProjectProposeArgs),
}

#[derive(Debug, Subcommand)]
enum TaskCommand {
    /// Propose a task.
    Propose(TaskProposeArgs),
}

#[derive(Debug, Subcommand)]
enum RoutineCommand {
    /// Propose a routine.
    Propose(RoutineProposeArgs),
}

#[derive(Debug, Subcommand)]
enum EventCommand {
    /// Propose an event.
    Propose(EventProposeArgs),
}

#[derive(Debug, Args)]
struct AreaCreateArgs {
    title: String,
    #[arg(long)]
    review_cycle: Option<String>,
    #[arg(long)]
    standard: Option<String>,
    #[arg(long)]
    note: Option<String>,
}

#[derive(Debug, Args)]
struct ProjectProposeArgs {
    title: String,
    #[arg(long)]
    area: Option<String>,
    #[arg(long)]
    definition_of_done: Option<String>,
    #[arg(long)]
    outcome: Option<String>,
    #[arg(long)]
    due: Option<String>,
    #[arg(long)]
    note: Option<String>,
    #[arg(long, default_value = "oracle", value_parser = parse_actor)]
    actor: Actor,
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
    #[arg(long)]
    note: Option<String>,
    #[arg(long, default_value = "oracle", value_parser = parse_actor)]
    actor: Actor,
}

#[derive(Debug, Args)]
struct RoutineProposeArgs {
    title: String,
    #[arg(long)]
    area: Option<String>,
    #[arg(long)]
    recurrence_rule: Option<String>,
    #[arg(long, default_value = "single_open")]
    materialization_policy: String,
    #[arg(long)]
    note: Option<String>,
    #[arg(long, default_value = "oracle", value_parser = parse_actor)]
    actor: Actor,
}

#[derive(Debug, Args)]
struct EventProposeArgs {
    title: String,
    scheduled: String,
    #[arg(long)]
    area: Option<String>,
    #[arg(long)]
    project_id: Option<String>,
    #[arg(long)]
    due: Option<String>,
    #[arg(long)]
    priority: Option<i64>,
    #[arg(long)]
    description: Option<String>,
    #[arg(long)]
    note: Option<String>,
    #[arg(long)]
    location: Option<String>,
    #[arg(long = "with")]
    participants: Vec<String>,
    #[arg(long, default_value = "appointment")]
    commitment_type: String,
    #[arg(long, default_value = "oracle", value_parser = parse_actor)]
    actor: Actor,
}

#[derive(Debug, Args)]
struct ActivateArgs {
    item_id: String,
}

pub fn run() -> Result<()> {
    init_tracing();
    let cli = Cli::parse();
    let command_name = command_label(&cli.command);
    let home = todo_home(cli.home)?;
    let logger = OperationalLogger::new(&home)?;
    logger.command_start(command_name);
    let started_at = Instant::now();

    let result = match cli.command {
        Command::Init => init(&home),
        Command::Health => health(&home),
        Command::Area {
            command: AreaCommand::Create(args),
        } => area_create(&home, args),
        Command::Project {
            command: ProjectCommand::Propose(args),
        } => project_propose(&home, args),
        Command::Task {
            command: TaskCommand::Propose(args),
        } => task_propose(&home, args),
        Command::Routine {
            command: RoutineCommand::Propose(args),
        } => routine_propose(&home, args),
        Command::Event {
            command: EventCommand::Propose(args),
        } => event_propose(&home, args),
        Command::Activate(args) => activate(&home, args),
        Command::Pending => pending(&home),
        Command::Today => today(&home),
        Command::Export => export(&home),
    };

    let duration_ms = elapsed_millis(started_at);
    match &result {
        Ok(()) => logger.command_success(command_name, duration_ms),
        Err(error) => logger.command_error(
            command_name,
            &format!("{error:#}"),
            TodoError::cli_exit_code_from_error(error),
            duration_ms,
        ),
    }
    result
}

fn command_label(command: &Command) -> &'static str {
    match command {
        Command::Init => "init",
        Command::Health => "health",
        Command::Area {
            command: AreaCommand::Create(_),
        } => "area create",
        Command::Project {
            command: ProjectCommand::Propose(_),
        } => "project propose",
        Command::Task {
            command: TaskCommand::Propose(_),
        } => "task propose",
        Command::Routine {
            command: RoutineCommand::Propose(_),
        } => "routine propose",
        Command::Event {
            command: EventCommand::Propose(_),
        } => "event propose",
        Command::Activate(_) => "activate",
        Command::Pending => "pending",
        Command::Today => "today",
        Command::Export => "export",
    }
}

fn elapsed_millis(started_at: Instant) -> u64 {
    started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
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
    let mut service = service(home)?;
    let item = service.propose_task(
        args.title,
        ProposeTask {
            actor: args.actor,
            area: args.area,
            due: args.due,
            scheduled: args.scheduled,
            priority: args.priority,
            description: args.description,
            note: args.note,
            ..Default::default()
        },
    )?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn area_create(home: &Path, args: AreaCreateArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.create_area(CreateArea {
        title: args.title,
        review_cycle: args.review_cycle,
        standard: args.standard,
        note: args.note,
    })?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn project_propose(home: &Path, args: ProjectProposeArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.propose_project(ProposeProject {
        title: args.title,
        area: args.area,
        definition_of_done: args.definition_of_done,
        outcome: args.outcome,
        due: args.due,
        actor: args.actor,
        note: args.note,
    })?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn routine_propose(home: &Path, args: RoutineProposeArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.propose_routine(ProposeRoutine {
        title: args.title,
        area: args.area,
        actor: args.actor,
        recurrence_rule: args.recurrence_rule,
        materialization_policy: args.materialization_policy,
        note: args.note,
    })?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn event_propose(home: &Path, args: EventProposeArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.propose_event(ProposeEvent {
        title: args.title,
        actor: args.actor,
        scheduled: Some(args.scheduled),
        area: args.area,
        project_id: args.project_id,
        due: args.due,
        priority: args.priority,
        description: args.description,
        note: args.note,
        location: args.location,
        participants: args.participants,
        commitment_type: args.commitment_type,
    })?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn activate(home: &Path, args: ActivateArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.activate(&args.item_id, None)?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn pending(home: &Path) -> Result<()> {
    let mut service = service(home)?;
    let items = pending_items(&mut service)?;
    println!("{}", render_items("Pending", &items));
    Ok(())
}

fn today(home: &Path) -> Result<()> {
    let today = today_string();
    let mut service = service(home)?;
    let items = current_today_items(&mut service, &today)?;
    println!("{}", render_items("Today", &items));
    Ok(())
}

fn export(home: &Path) -> Result<()> {
    let today = today_string();
    let mut service = service(home)?;
    for path in write_current_exports(&mut service, &exports_dir(home), &today)? {
        println!("{}", path.display());
    }
    Ok(())
}

fn service(home: &Path) -> Result<TodoService> {
    let db_path = db_path(home);
    let conn = connect_path(&db_path)?;
    init_schema(&conn)?;
    Ok(TodoService::persistent(SqliteTodoRepository::new(conn)))
}

fn connect_path(path: &Path) -> Result<rusqlite::Connection> {
    let path = path
        .to_str()
        .with_context(|| format!("database path is not valid UTF-8: {}", path.display()))?;
    connect(path).map_err(Into::into)
}

fn today_string() -> String {
    local_today_string()
}

fn parse_actor(value: &str) -> std::result::Result<Actor, String> {
    Actor::from_str(value)
        .map_err(|_| format!("invalid actor '{value}'; expected one of: oracle, user, system"))
}
