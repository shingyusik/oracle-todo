mod create;
mod lifecycle;
mod markdown;
mod options;
mod output;
mod table;
#[cfg(test)]
mod tests;
mod views;

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result};
use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand, ValueEnum};
use rusqlite::{Connection, OpenFlags};
use std::str::FromStr;

use crate::application::error::TodoError;
use crate::application::service::TodoService;
use crate::domain::{Actor, ItemStatus, ItemType};
use crate::infrastructure::paths::{db_path, todo_home};
use crate::infrastructure::sqlite::{
    SqliteTodoRepository, connect, connect_read_only, init_schema, user_version,
};
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
    /// List items.
    List(ListArgs),
    /// Query UI tables and their relation/filter lookups as JSON.
    Table {
        #[command(subcommand)]
        command: TableCommand,
    },
    /// Discover fixed enums and lifecycle transitions as JSON; optionally narrow by type or item.
    Options(OptionsArgs),
    /// Show an item as JSON.
    Show { item_id: String },
    /// Reopen a completed task or event.
    Reopen(ItemTransitionArgs),
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
    /// Pause a nonterminal project, goal, routine, or event (areas and tasks cannot pause).
    Pause(ItemTransitionArgs),
    /// Mark an active task or event as missed.
    Miss(ItemTransitionArgs),
    /// Postpone an active task or event by marking it missed and creating a follow-up.
    Postpone(PostponeArgs),
    /// Resume a paused item except an area; routines require a recurrence rule.
    Resume(ItemTransitionArgs),
    /// Complete a nonterminal item except an area.
    Complete(ItemTransitionArgs),
    /// Archive an item.
    Archive(ItemTransitionArgs),
    /// Update item fields.
    Update(Box<UpdateArgs>),
    /// List terminal/archive items.
    #[command(name = "archive-list")]
    ArchiveList(ReadArgs),
    /// Show active work.
    Pending(ReadArgs),
    /// Show today's existing task view.
    Today(ReadArgs),
}

#[derive(Debug, Subcommand)]
enum AreaCommand {
    /// Create an active area.
    Create(AreaCreateArgs),
}

#[derive(Debug, Subcommand)]
enum TableCommand {
    /// Run the UI table query JSON, including typed filters, sorts, groups, and context.
    #[command(
        after_help = r#"Required body fields: scope, sorts, group_by, group_settings, context. Optional: offset (0), limit (1..50, default 50), filter_mode (and|or), filters.
Workspace scopes: workspace.area, workspace.project, workspace.goal, workspace.routine, workspace.task, workspace.event. Planner and linked scopes use the UI API names.
Each filter: {field,operator,value}; value is {text}, {list}, {range:{start,end}}, {relative:{amount,unit}} or {empty:true}. Relative units: day|week|month; requires context.reference_date (YYYY-MM-DD).
Operators by field type: is, is_not, contains, does_not_contain, starts_with, ends_with, is_before, is_after, is_on_or_before, is_on_or_after, is_between, is_relative_to_today, greater_than, less_than, is_empty, is_not_empty.
Common fields: title,status,tags,note. Area has only common fields; Project: area,due; Goal: horizon,scheduled,parent; Routine: area,project,recurrence_rule,materialization_policy,priority,description; Task: area,project,routine,scheduled,due,priority,description; Event: area,project,scheduled,due,priority,location,participants,commitment_type,description. Fields/operators are checked against scope.
Sorts: [{field,direction:"asc"|"desc"}]. group_by is none or a supported relation, tag, status, month or weekday for the scope. group_settings: {sort:"manual"|"alphabetical"|"reverse_alphabetical",hide_empty,manual_order:[],hidden_group_keys:[]}.
Workspace context: {} or {reference_date}; Planner: {from,to,reference_date}; Linked: {parent_type,parent_id,reference_date}.
Example:
  --json '{"scope":"workspace.task","filters":[{"field":"title","operator":"contains","value":{"text":"dentist"}}],"sorts":[],"group_by":"none","group_settings":{"sort":"manual","hide_empty":true,"manual_order":[],"hidden_group_keys":[]},"context":{}}'
Output: {items,next_offset}. Reuse the same query with offset=next_offset until null. Lookup IDs: todo table lookups --scope <scope>. Fixed values: todo options --type <type>."#
    )]
    Query {
        #[arg(long)]
        json: String,
    },
    /// Return UI relation/filter lookup choices as {items}; --id narrows valid goal parents.
    Lookups {
        /// UI table scope, such as workspace.task, workspace.goal, or linked.goal.task.
        #[arg(long, value_parser = parse_table_scope)]
        scope: crate::application::table::TodoTableScope,
        #[arg(long)]
        id: Option<String>,
        /// Goal scope only: parent choices for the new week, month, or year horizon.
        #[arg(long, value_parser = ["week", "month", "year"])]
        horizon: Option<String>,
    },
}

#[derive(Debug, Args)]
struct OptionsArgs {
    /// Item type: area, project, goal, routine, task, event; historical: review, archive_item.
    #[arg(long = "type", value_parser = parse_item_type, conflicts_with = "id")]
    item_type: Option<ItemType>,
    /// Existing item ID; report only transitions allowed for its current state.
    #[arg(long)]
    id: Option<String>,
}

#[derive(Debug, Subcommand)]
enum ProjectCommand {
    /// Create an active project.
    #[command(name = "create", visible_alias = "propose")]
    Propose(ProjectProposeArgs),
}

#[derive(Debug, Subcommand)]
enum GoalCommand {
    /// Create an active goal.
    #[command(name = "create", visible_alias = "propose")]
    Propose(GoalProposeArgs),
}

#[derive(Debug, Subcommand)]
enum TaskCommand {
    /// Create an active task.
    #[command(name = "create", visible_alias = "propose")]
    Propose(TaskProposeArgs),
}

#[derive(Debug, Subcommand)]
enum RoutineCommand {
    /// Create an active routine.
    #[command(name = "create", visible_alias = "propose")]
    Propose(Box<RoutineProposeArgs>),
    /// Materialize due routine tasks.
    Materialize(RoutineMaterializeArgs),
}

#[derive(Debug, Subcommand)]
enum EventCommand {
    /// Propose an event.
    #[command(name = "create", visible_alias = "propose")]
    Propose(EventProposeArgs),
}

#[derive(Debug, Args)]
struct AreaCreateArgs {
    #[arg(long = "tag")]
    tags: Vec<String>,
    title: String,
    /// Area review cycle: daily, weekly, monthly, quarterly.
    #[arg(long)]
    review_cycle: Option<String>,
    #[arg(long)]
    standard: Option<String>,
    #[arg(long)]
    note: Option<String>,
}

#[derive(Debug, Args)]
struct ListArgs {
    #[arg(long)]
    parent_id: Option<String>,
    /// Goal horizon: week, month, year.
    #[arg(long)]
    horizon: Option<String>,
    #[arg(long)]
    scheduled: Option<String>,
    #[command(flatten)]
    read: ReadArgs,
    /// Read filter: active, waiting, paused, completed, cancelled, dropped, archived, missed, rejected. Historical statuses are readable; lifecycle commands determine writable transitions.
    #[arg(long, value_parser = parse_status)]
    status: Option<ItemStatus>,
    /// Read type: area, project, goal, routine, task, event, review, archive_item. Review and archive_item are historical types.
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

#[derive(Debug, Clone, Copy, ValueEnum)]
enum ReadFormat {
    Markdown,
    Json,
}
#[derive(Debug, Args)]
struct ReadArgs {
    #[arg(long, value_enum, default_value = "markdown")]
    format: ReadFormat,
    #[arg(long, default_value_t = 0, value_parser = clap::value_parser!(u32))]
    offset: u32,
    #[arg(long, default_value_t = 100, value_parser = clap::value_parser!(u32).range(1..=1000))]
    limit: u32,
}

#[derive(Debug, Args)]
struct ProjectProposeArgs {
    #[arg(long = "tag")]
    tags: Vec<String>,
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
    #[arg(long = "tag")]
    tags: Vec<String>,
    title: String,
    /// Goal period: week, month, year.
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
    #[arg(long)]
    project_id: Option<String>,
    #[arg(long = "tag")]
    tags: Vec<String>,
    title: String,
    #[arg(long)]
    area: Option<String>,
    #[arg(long)]
    due: Option<String>,
    #[arg(long)]
    scheduled: Option<String>,
    /// Priority: 1..10 (task, routine, and event only).
    #[arg(long, value_parser = clap::value_parser!(i64).range(1..=10))]
    priority: Option<i64>,
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
    project_id: Option<String>,
    /// Priority: 1..10 (task, routine, and event only).
    #[arg(long, value_parser = clap::value_parser!(i64).range(1..=10))]
    priority: Option<i64>,
    #[arg(long)]
    recurrence_rule: Option<String>,
    /// Routine task generation: single_open, per_occurrence.
    #[arg(long, default_value = "single_open")]
    materialization_policy: String,
    #[arg(long, default_value_t = crate::domain::DEFAULT_FUTURE_OCCURRENCES)]
    future_occurrences: i64,
    #[arg(long)]
    note: Option<String>,
    #[arg(long = "tag")]
    tags: Vec<String>,
    #[arg(long, default_value = "agent", value_parser = parse_actor)]
    actor: Actor,
}

#[derive(Debug, Args)]
struct RoutineMaterializeArgs {
    /// Routine to materialize; omit to materialize all due routines.
    item_id: Option<String>,
    #[arg(long, requires = "item_id")]
    future_occurrences: Option<i64>,
}

#[derive(Debug, Args)]
struct EventProposeArgs {
    #[arg(long = "tag")]
    tags: Vec<String>,
    title: String,
    scheduled: String,
    #[arg(long)]
    area: Option<String>,
    #[arg(long)]
    project_id: Option<String>,
    #[arg(long)]
    due: Option<String>,
    /// Priority: 1..10 (task, routine, and event only).
    #[arg(long, value_parser = clap::value_parser!(i64).range(1..=10))]
    priority: Option<i64>,
    #[arg(long)]
    note: Option<String>,
    #[arg(long)]
    location: Option<String>,
    #[arg(long = "with")]
    participants: Vec<String>,
    /// Event commitment kind; free text, defaults to appointment.
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
struct PostponeArgs {
    item_id: String,
    #[arg(long)]
    scheduled: Option<String>,
    #[arg(long)]
    reason: Option<String>,
}

#[derive(Debug, Args)]
struct UpdateArgs {
    /// Reject the update if the item's RFC 3339 version has changed.
    #[arg(long)]
    expected_updated_at: Option<String>,
    #[arg(long, conflicts_with = "tags")]
    clear_tags: bool,
    /// Event only: location.
    #[arg(long)]
    location: Option<String>,
    /// Event only: participants.
    #[arg(long = "with")]
    participants: Vec<String>,
    #[arg(long, conflicts_with = "participants")]
    clear_participants: bool,
    /// Event only: free-text commitment kind.
    #[arg(long)]
    commitment_type: Option<String>,
    /// Goal only: week, month, year.
    #[arg(long)]
    horizon: Option<String>,
    item_id: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    note: Option<String>,
    /// Project only: outcome.
    #[arg(long)]
    outcome: Option<String>,
    /// Project only: nonblank completion criteria.
    #[arg(long)]
    definition_of_done: Option<String>,
    /// Area only: responsibility standard.
    #[arg(long)]
    standard: Option<String>,
    /// Area only: daily, weekly, monthly, quarterly.
    #[arg(long)]
    review_cycle: Option<String>,
    /// Routine only: supported RRULE.
    #[arg(long)]
    recurrence_rule: Option<String>,
    /// Routine only: single_open, per_occurrence.
    #[arg(long)]
    materialization_policy: Option<String>,
    /// Project, routine, task, or event: area ID or title; empty clears.
    #[arg(long)]
    area: Option<String>,
    /// Routine, task, or event: project ID; empty clears.
    #[arg(long)]
    project_id: Option<String>,
    /// Goal or task: goal parent ID; empty clears.
    #[arg(long = "parent-id")]
    parent_id: Option<String>,
    /// Project, task, or event: ISO due date; empty clears.
    #[arg(long)]
    due: Option<String>,
    /// Goal, task, or event: ISO schedule; events also accept RFC 3339 and cannot clear.
    #[arg(long)]
    scheduled: Option<String>,
    /// Task, routine, or event: priority 1..10.
    #[arg(long, value_parser = clap::value_parser!(i64).range(1..=10))]
    priority: Option<i64>,
    /// Task, routine, or event: clear priority.
    #[arg(long, conflicts_with = "priority")]
    clear_priority: bool,
    #[arg(long = "tag")]
    tags: Vec<String>,
    #[arg(long)]
    reason: Option<String>,
}

pub fn run() -> Result<()> {
    load_dotenv()?;
    run_from(std::env::args_os())
}

pub fn run_from<I, T>(args: I) -> Result<()>
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    let cli = Cli::parse_from(args);
    let home = todo_home(cli.home)?;
    execute(home, cli.command)
}

pub fn run_at<I, T>(home: &Path, args: I) -> Result<()>
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    let cli = Cli::try_parse_from(args).map_err(anyhow::Error::new)?;
    execute(home.to_path_buf(), cli.command)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TodoHealth {
    Healthy { user_version: i64 },
    NotInitialized,
    Unavailable,
}

pub const TODO_SCHEMA_VERSION: i64 = 1;

pub fn health_at(home: &Path) -> TodoHealth {
    health_db_at(&db_path(home))
}

pub fn health_db_at(path: &Path) -> TodoHealth {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {}
        Ok(_) => return TodoHealth::Unavailable,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return TodoHealth::NotInitialized;
        }
        Err(_) => return TodoHealth::Unavailable,
    }

    let Some(path) = path.to_str() else {
        return TodoHealth::Unavailable;
    };
    let Ok(connection) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return TodoHealth::Unavailable;
    };

    match user_version(&connection) {
        Ok(0) => TodoHealth::NotInitialized,
        Ok(user_version) if user_version == TODO_SCHEMA_VERSION => {
            TodoHealth::Healthy { user_version }
        }
        Ok(_) | Err(_) => TodoHealth::Unavailable,
    }
}

fn execute(home: PathBuf, command: Command) -> Result<()> {
    let command_name = command_label(&command);
    init_tracing(&home);
    tracing::debug!(event = "home_resolved", home = %home.display());
    tracing::info!(
        event = "command_started",
        command = command_name,
        "command started"
    );
    let started_at = Instant::now();

    let result = match command {
        Command::Init => init(&home),
        Command::Health => health(&home),
        Command::List(args) => views::list(&home, args),
        Command::Table { command } => table::run(&home, command),
        Command::Options(args) => options::run(&home, args),
        Command::Show { item_id } => views::show(&home, &item_id),
        Command::Reopen(args) => lifecycle::reopen(&home, args),
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
        } => create::routine_propose(&home, *args),
        Command::Routine {
            command: RoutineCommand::Materialize(args),
        } => views::routine_materialize(&home, args),
        Command::Event {
            command: EventCommand::Propose(args),
        } => create::event_propose(&home, args),
        Command::Pause(args) => lifecycle::pause(&home, args),
        Command::Miss(args) => lifecycle::miss(&home, args),
        Command::Postpone(args) => lifecycle::postpone(&home, args),
        Command::Resume(args) => lifecycle::resume(&home, args),
        Command::Complete(args) => lifecycle::complete(&home, args),
        Command::Archive(args) => lifecycle::archive(&home, args),
        Command::Update(args) => lifecycle::update(&home, *args),
        Command::ArchiveList(args) => views::archive_list(&home, args),
        Command::Pending(args) => views::pending(&home, args),
        Command::Today(args) => views::today(&home, args),
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
        Command::List(_) => "list",
        Command::Table {
            command: TableCommand::Query { .. },
        } => "table query",
        Command::Table {
            command: TableCommand::Lookups { .. },
        } => "table lookups",
        Command::Options(_) => "options",
        Command::Show { .. } => "show",
        Command::Reopen(_) => "reopen",
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
        Command::Pause(_) => "pause",
        Command::Miss(_) => "miss",
        Command::Postpone(_) => "postpone",
        Command::Resume(_) => "resume",
        Command::Complete(_) => "complete",
        Command::Archive(_) => "archive",
        Command::Update(_) => "update",
        Command::ArchiveList(_) => "archive-list",
        Command::Pending(_) => "pending",
        Command::Today(_) => "today",
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
    let conn = connect_read_only(db_path.to_str().context("invalid database path")?)?;
    let user_version = user_version(&conn)?;
    println!("ok db={} user_version={}", db_path.display(), user_version);
    Ok(())
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

pub(super) fn read_service(home: &Path) -> Result<TodoService> {
    let path = db_path(home);
    let conn = connect_read_only(path.to_str().context("invalid database path")?)?;
    Ok(TodoService::persistent(SqliteTodoRepository::new(conn)))
}

pub fn run_raven_at<I, T>(home: &Path, args: I) -> Result<()>
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    let matches = raven_command()
        .try_get_matches_from(args)
        .map_err(anyhow::Error::new)?;
    let command = Command::from_arg_matches(&matches).map_err(anyhow::Error::new)?;
    execute(home.to_path_buf(), command)
}

/// Validate delegated arguments without resolving a home or opening a store.
pub fn validate_raven_args<I, T>(args: I) -> Result<()>
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    raven_command()
        .try_get_matches_from(args)
        .map_err(anyhow::Error::new)?;
    Ok(())
}

fn raven_command() -> clap::Command {
    let original = Cli::command();
    let subcommands = original.get_subcommands().cloned().collect::<Vec<_>>();
    clap::Command::new("raven todo")
        .about("Policy-enforced personal ToDo engine")
        .subcommand_required(true)
        .arg_required_else_help(true)
        .subcommands(subcommands)
}

pub(super) fn connect_path(path: &Path) -> Result<rusqlite::Connection> {
    let path = path
        .to_str()
        .with_context(|| format!("database path is not valid UTF-8: {}", path.display()))?;
    connect(path).map_err(Into::into)
}

/// Load `.env` if there is one.
///
/// A missing file is the normal case and stays silent. A malformed one is not:
/// swallowing it drops `TODO_ENGINE_HOME` and silently falls back to the default
/// data home, which reads as "my config was ignored for no reason". Note that
/// dotenv treats `\` as an escape, so a bare Windows path fails to parse -- it
/// has to be single-quoted or written with forward slashes.
fn load_dotenv() -> Result<()> {
    match dotenvy::dotenv() {
        Ok(_) => Ok(()),
        Err(error) if error.not_found() => Ok(()),
        Err(error) => Err(anyhow::Error::new(error).context(
            "failed to parse .env (single-quote values containing backslashes, e.g. \
             TODO_ENGINE_HOME='C:\\path\\to\\home')",
        )),
    }
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
            "invalid status '{value}'; expected one of: active, waiting, paused, completed, cancelled, dropped, archived, missed, rejected"
        )
    })
}

fn parse_item_type(value: &str) -> std::result::Result<ItemType, String> {
    ItemType::from_str(value).map_err(|_| {
        format!(
            "invalid type '{value}'; expected one of: area, project, goal, routine, task, event, review, archive_item"
        )
    })
}

fn parse_table_scope(
    value: &str,
) -> std::result::Result<crate::application::table::TodoTableScope, String> {
    crate::interfaces::api::decode_table_scope(value).map_err(|error| error.to_string())
}
