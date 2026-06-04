use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand};
use std::str::FromStr;

use crate::application::ports::ListFilter;
use crate::application::service::{
    CreateArea, ProposeEvent, ProposeProject, ProposeRoutine, ProposeTask, TodoService, UpdateItem,
};
use crate::domain::{Actor, ItemStatus, ItemType};
use crate::exports::{current_today_items, pending_items, render_items, write_current_exports};
use crate::infrastructure::paths::{db_path, exports_dir, todo_home};
use crate::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema, user_version};
use crate::infrastructure::system::{init_tracing, local_today_string};

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
    /// List items.
    List(ListArgs),
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
    /// Approve a proposed item.
    Approve(ItemTransitionArgs),
    /// Activate an approved or user-created item.
    Activate(ItemTransitionArgs),
    /// Pause an item.
    Pause(ItemTransitionArgs),
    /// Resume a paused item.
    Resume(ItemTransitionArgs),
    /// Complete an item.
    Complete(ItemTransitionArgs),
    /// Archive an item.
    Archive(ItemTransitionArgs),
    /// Drop an item.
    Drop(ItemTransitionArgs),
    /// Cancel an item.
    Cancel(ItemTransitionArgs),
    /// Update item fields.
    Update(UpdateArgs),
    /// List terminal/archive items.
    #[command(name = "archive-list")]
    ArchiveList,
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
    /// Materialize due routine tasks.
    Materialize(RoutineMaterializeArgs),
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
}

#[derive(Debug, Args)]
struct ListArgs {
    #[arg(long, value_parser = parse_status)]
    status: Option<ItemStatus>,
    #[arg(long = "type", value_parser = parse_item_type)]
    item_type: Option<ItemType>,
    #[arg(long)]
    area_id: Option<String>,
    #[arg(long)]
    project_id: Option<String>,
    #[arg(long)]
    routine_id: Option<String>,
    #[arg(long)]
    query: Option<String>,
    #[arg(long)]
    include_archived: bool,
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
    #[arg(long, default_value = "oracle", value_parser = parse_actor)]
    actor: Actor,
}

#[derive(Debug, Args)]
struct RoutineMaterializeArgs {
    #[arg(long)]
    now: Option<String>,
    #[arg(long, default_value_t = 7)]
    lookahead_days: i64,
    #[arg(long, default_value_t = 1)]
    catchup_days: i64,
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
    location: Option<String>,
    #[arg(long = "with")]
    participants: Vec<String>,
    #[arg(long, default_value = "appointment")]
    commitment_type: String,
    #[arg(long, default_value = "oracle", value_parser = parse_actor)]
    actor: Actor,
}

#[derive(Debug, Args)]
struct ItemTransitionArgs {
    item_id: String,
    #[arg(long)]
    reason: Option<String>,
}

#[derive(Debug, Args)]
struct UpdateArgs {
    item_id: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    description: Option<String>,
    #[arg(long)]
    outcome: Option<String>,
    #[arg(long)]
    definition_of_done: Option<String>,
    #[arg(long)]
    standard: Option<String>,
    #[arg(long)]
    review_cycle: Option<String>,
    #[arg(long)]
    recurrence_rule: Option<String>,
    #[arg(long)]
    materialization_policy: Option<String>,
    #[arg(long)]
    area: Option<String>,
    #[arg(long)]
    project_id: Option<String>,
    #[arg(long)]
    routine_id: Option<String>,
    #[arg(long)]
    due: Option<String>,
    #[arg(long)]
    scheduled: Option<String>,
    #[arg(long)]
    priority: Option<i64>,
    #[arg(long)]
    reason: Option<String>,
}

pub fn run() -> Result<()> {
    init_tracing();
    let cli = Cli::parse();
    let home = todo_home(cli.home)?;

    match cli.command {
        Command::Init => init(&home),
        Command::Health => health(&home),
        Command::List(args) => list(&home, args),
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
        Command::Routine {
            command: RoutineCommand::Materialize(args),
        } => routine_materialize(&home, args),
        Command::Event {
            command: EventCommand::Propose(args),
        } => event_propose(&home, args),
        Command::Approve(args) => approve(&home, args),
        Command::Activate(args) => activate(&home, args),
        Command::Pause(args) => pause(&home, args),
        Command::Resume(args) => resume(&home, args),
        Command::Complete(args) => complete(&home, args),
        Command::Archive(args) => archive(&home, args),
        Command::Drop(args) => drop_item(&home, args),
        Command::Cancel(args) => cancel(&home, args),
        Command::Update(args) => update(&home, args),
        Command::ArchiveList => archive_list(&home),
        Command::Pending => pending(&home),
        Command::Today => today(&home),
        Command::Export => export(&home),
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
            ..Default::default()
        },
    )?;
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
    })?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn area_create(home: &Path, args: AreaCreateArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.create_area(CreateArea {
        title: args.title,
        review_cycle: args.review_cycle,
        standard: args.standard,
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
    })?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn routine_materialize(home: &Path, args: RoutineMaterializeArgs) -> Result<()> {
    let mut service = service(home)?;
    let now = args.now.unwrap_or_else(today_string);
    let created = service.materialize_routines(&now, args.lookahead_days, args.catchup_days)?;
    if created.is_empty() {
        println!("No routine tasks materialized");
        return Ok(());
    }
    for item in created {
        println!("{}", serde_json::to_string(&item)?);
    }
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
        location: args.location,
        participants: args.participants,
        commitment_type: args.commitment_type,
    })?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn list(home: &Path, args: ListArgs) -> Result<()> {
    let mut service = service(home)?;
    let items = service.list_items(ListFilter {
        status: args.status,
        item_type: args.item_type,
        area_id: args.area_id,
        project_id: args.project_id,
        routine_id: args.routine_id,
        query: args.query,
        include_archived: args.include_archived,
    })?;
    println!("{}", render_items("Items", &items));
    Ok(())
}

fn approve(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.approve(&args.item_id, args.reason.as_deref())?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn activate(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.activate(&args.item_id, args.reason.as_deref())?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn pause(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.pause(&args.item_id, args.reason.as_deref())?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn resume(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.resume(&args.item_id, args.reason.as_deref())?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn complete(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.complete(&args.item_id, args.reason.as_deref())?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn archive(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.archive(&args.item_id, args.reason.as_deref())?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn drop_item(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.drop(&args.item_id, args.reason.as_deref())?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn cancel(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.cancel(&args.item_id, args.reason.as_deref())?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn update(home: &Path, args: UpdateArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.update_item(
        &args.item_id,
        UpdateItem {
            title: args.title,
            description: args.description,
            outcome: args.outcome,
            definition_of_done: args.definition_of_done,
            standard: args.standard,
            review_cycle: args.review_cycle,
            recurrence_rule: args.recurrence_rule,
            materialization_policy: args.materialization_policy,
            area: args.area,
            project_id: args.project_id,
            routine_id: args.routine_id,
            due: args.due,
            scheduled: args.scheduled,
            priority: args.priority,
            reason: args.reason,
        },
    )?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}

fn archive_list(home: &Path) -> Result<()> {
    let mut service = service(home)?;
    let items = service.archive_items()?;
    println!("{}", render_items("Archive", &items));
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

fn parse_status(value: &str) -> std::result::Result<ItemStatus, String> {
    ItemStatus::from_str(value).map_err(|_| {
        format!(
            "invalid status '{value}'; expected one of: proposed, approved, active, waiting, paused, completed, cancelled, dropped, archived, someday, rejected"
        )
    })
}

fn parse_item_type(value: &str) -> std::result::Result<ItemType, String> {
    ItemType::from_str(value).map_err(|_| {
        format!(
            "invalid type '{value}'; expected one of: area, project, routine, task, event, review, archive_item"
        )
    })
}
