mod create;
mod lifecycle;
mod markdown;
mod output;
mod views;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand};
use std::str::FromStr;

use crate::application::error::TodoError;
use crate::application::service::TodoService;
use crate::domain::{Actor, ItemStatus, ItemType};
use crate::infrastructure::paths::{db_path, todo_home};
use crate::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema, user_version};
use crate::infrastructure::system::{init_tracing, local_today_string};

#[derive(Debug, Parser)]
#[command(name = "todo-engine")]
#[command(about = "Policy-enforced personal ToDo engine")]
struct Cli {
    /// Data home. Defaults to TODO_ENGINE_HOME or ~/.todo-engine.
    #[arg(long, env = "TODO_ENGINE_HOME")]
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
    /// Serve the HTTP API.
    Api(ApiArgs),
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
    /// Manage goals.
    Goal {
        #[command(subcommand)]
        command: GoalCommand,
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
    /// Show items scheduled or due on a date (JSON).
    Agenda(AgendaArgs),
    /// Show items scheduled within an inclusive date range (JSON).
    #[command(name = "date-range")]
    DateRange(DateRangeArgs),
    /// Show the goal-tree period view for a horizon and period (JSON).
    Period(PeriodArgs),
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
enum GoalCommand {
    /// Propose a goal.
    Propose(GoalProposeArgs),
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
    #[arg(long)]
    note: Option<String>,
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
struct ApiArgs {
    #[arg(long, default_value_t = IpAddr::V4(Ipv4Addr::LOCALHOST))]
    host: IpAddr,
    #[arg(long, default_value_t = 3002)]
    port: u16,
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
    #[arg(long, default_value = "agent", value_parser = parse_actor)]
    actor: Actor,
}

#[derive(Debug, Args)]
struct GoalProposeArgs {
    title: String,
    #[arg(long)]
    horizon: String,
    #[arg(long)]
    scheduled: String,
    #[arg(long = "parent")]
    parent_id: Option<String>,
    #[arg(long)]
    note: Option<String>,
    #[arg(long, default_value = "agent", value_parser = parse_actor)]
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
    #[arg(long, default_value = "agent", value_parser = parse_actor)]
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
    #[arg(long, default_value = "agent", value_parser = parse_actor)]
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
    note: Option<String>,
    #[arg(long)]
    location: Option<String>,
    #[arg(long = "with")]
    participants: Vec<String>,
    #[arg(long, default_value = "appointment")]
    commitment_type: String,
    #[arg(long, default_value = "agent", value_parser = parse_actor)]
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
    note: Option<String>,
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

#[derive(Debug, Args)]
struct AgendaArgs {
    date: String,
}

#[derive(Debug, Args)]
struct DateRangeArgs {
    from: String,
    to: String,
}

#[derive(Debug, Args)]
struct PeriodArgs {
    #[arg(long)]
    horizon: String,
    #[arg(long)]
    period: String,
}

pub fn run() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let command_name = command_label(&cli.command);
    let home = todo_home(cli.home)?;
    init_tracing(&home);
    tracing::debug!(event = "home_resolved", home = %home.display());
    tracing::info!(
        event = "command_started",
        command = command_name,
        "command started"
    );
    let started_at = Instant::now();

    let result = match cli.command {
        Command::Init => init(&home),
        Command::Health => health(&home),
        Command::Api(args) => api(&home, args),
        Command::List(args) => views::list(&home, args),
        Command::Area {
            command: AreaCommand::Create(args),
        } => create::area_create(&home, args),
        Command::Project {
            command: ProjectCommand::Propose(args),
        } => create::project_propose(&home, args),
        Command::Goal {
            command: GoalCommand::Propose(args),
        } => create::goal_propose(&home, args),
        Command::Task {
            command: TaskCommand::Propose(args),
        } => create::task_propose(&home, args),
        Command::Routine {
            command: RoutineCommand::Propose(args),
        } => create::routine_propose(&home, args),
        Command::Routine {
            command: RoutineCommand::Materialize(args),
        } => views::routine_materialize(&home, args),
        Command::Event {
            command: EventCommand::Propose(args),
        } => create::event_propose(&home, args),
        Command::Approve(args) => lifecycle::approve(&home, args),
        Command::Activate(args) => lifecycle::activate(&home, args),
        Command::Pause(args) => lifecycle::pause(&home, args),
        Command::Resume(args) => lifecycle::resume(&home, args),
        Command::Complete(args) => lifecycle::complete(&home, args),
        Command::Archive(args) => lifecycle::archive(&home, args),
        Command::Drop(args) => lifecycle::drop_item(&home, args),
        Command::Cancel(args) => lifecycle::cancel(&home, args),
        Command::Update(args) => lifecycle::update(&home, args),
        Command::ArchiveList => views::archive_list(&home),
        Command::Pending => views::pending(&home),
        Command::Today => views::today(&home),
        Command::Agenda(args) => views::agenda(&home, args),
        Command::DateRange(args) => views::date_range(&home, args),
        Command::Period(args) => views::period(&home, args),
    };

    let duration_ms = elapsed_millis(started_at);
    match &result {
        Ok(()) => tracing::info!(
            event = "command_completed",
            command = command_name,
            duration_ms,
            exit_code = 0_i32,
            "command completed"
        ),
        Err(error) => tracing::error!(
            event = "command_failed",
            command = command_name,
            duration_ms,
            exit_code = TodoError::cli_exit_code_from_error(error),
            error = %format!("{error:#}"),
            "command failed"
        ),
    }
    result
}

fn command_label(command: &Command) -> &'static str {
    match command {
        Command::Init => "init",
        Command::Health => "health",
        Command::Api(_) => "api",
        Command::List(_) => "list",
        Command::Area {
            command: AreaCommand::Create(_),
        } => "area create",
        Command::Project {
            command: ProjectCommand::Propose(_),
        } => "project propose",
        Command::Goal {
            command: GoalCommand::Propose(_),
        } => "goal propose",
        Command::Task {
            command: TaskCommand::Propose(_),
        } => "task propose",
        Command::Routine {
            command: RoutineCommand::Propose(_),
        } => "routine propose",
        Command::Routine {
            command: RoutineCommand::Materialize(_),
        } => "routine materialize",
        Command::Event {
            command: EventCommand::Propose(_),
        } => "event propose",
        Command::Approve(_) => "approve",
        Command::Activate(_) => "activate",
        Command::Pause(_) => "pause",
        Command::Resume(_) => "resume",
        Command::Complete(_) => "complete",
        Command::Archive(_) => "archive",
        Command::Drop(_) => "drop",
        Command::Cancel(_) => "cancel",
        Command::Update(_) => "update",
        Command::ArchiveList => "archive-list",
        Command::Pending => "pending",
        Command::Today => "today",
        Command::Agenda(_) => "agenda",
        Command::DateRange(_) => "date-range",
        Command::Period(_) => "period",
    }
}

fn elapsed_millis(started_at: Instant) -> u64 {
    started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

fn init(home: &Path) -> Result<()> {
    std::fs::create_dir_all(home)?;
    let db_path = db_path(home);
    tracing::debug!(event = "database_path_resolved", path = %db_path.display());
    let conn = connect_path(&db_path)?;
    tracing::debug!(event = "database_opened", path = %db_path.display());
    init_schema(&conn)?;
    tracing::debug!(event = "schema_initialized", path = %db_path.display());
    println!("initialized {}", db_path.display());
    Ok(())
}

fn health(home: &Path) -> Result<()> {
    let db_path = db_path(home);
    tracing::debug!(event = "database_path_resolved", path = %db_path.display());
    let conn = connect_path(&db_path)?;
    tracing::debug!(event = "database_opened", path = %db_path.display());
    let user_version = user_version(&conn)?;
    println!("ok db={} user_version={}", db_path.display(), user_version);
    Ok(())
}

fn api(home: &Path, args: ApiArgs) -> Result<()> {
    std::fs::create_dir_all(home)?;
    let db_path = db_path(home);
    tracing::debug!(event = "database_path_resolved", path = %db_path.display());
    let conn = connect_path(&db_path)?;
    init_schema(&conn)?;
    drop(conn);

    let addr = SocketAddr::new(args.host, args.port);
    let router = crate::interfaces::api::router(&db_path)?;
    println!("serving http://{addr}");
    tokio::runtime::Runtime::new()?.block_on(async {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        axum::serve(listener, router).await?;
        anyhow::Ok(())
    })
}

pub(super) fn service(home: &Path) -> Result<TodoService> {
    let db_path = db_path(home);
    tracing::debug!(event = "database_path_resolved", path = %db_path.display());
    let conn = connect_path(&db_path)?;
    tracing::debug!(event = "database_opened", path = %db_path.display());
    init_schema(&conn)?;
    tracing::debug!(event = "schema_initialized", path = %db_path.display());
    tracing::debug!(event = "service_ready", path = %db_path.display());
    Ok(TodoService::persistent(SqliteTodoRepository::new(conn)))
}

pub(super) fn connect_path(path: &Path) -> Result<rusqlite::Connection> {
    let path = path
        .to_str()
        .with_context(|| format!("database path is not valid UTF-8: {}", path.display()))?;
    connect(path).map_err(Into::into)
}

pub(super) fn today_string() -> String {
    local_today_string()
}

fn parse_actor(value: &str) -> std::result::Result<Actor, String> {
    Actor::from_str(value)
        .map_err(|_| format!("invalid actor '{value}'; expected one of: agent, user, system"))
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
