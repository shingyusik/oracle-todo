use std::ffi::OsString;

use anyhow::Result;

use crate::config::RavenPaths;

const HELP: &str = "\
Policy-enforced personal ToDo engine

Usage: raven todo <COMMAND>

Commands:
  init          Initialize the SQLite database
  health        Check database reachability and schema baseline
  list          List items
  area          Create and maintain areas
  project       Manage projects
  goal          Manage goals
  task          Manage tasks
  routine       Manage routines
  event         Manage scheduled events and external commitments
  pause         Pause an item
  miss          Mark a task or event as missed
  postpone      Postpone a task or event
  resume        Resume a paused item
  complete      Complete an item
  archive       Archive an item
  drop          Drop an item
  cancel        Cancel an item
  update        Update item fields
  archive-list  List terminal/archive items
  pending       Show active work
  today         Show today's materialized task view
  agenda        Show items scheduled or due on a date
  date-range    Show items scheduled within an inclusive date range
  period        Show the goal-tree period view
  help          Print this message

Options:
  -h, --help  Print help
";

pub fn run<I, T>(paths: &RavenPaths, args: I) -> Result<()>
where
    I: IntoIterator<Item = T>,
    T: Into<OsString>,
{
    let args = args.into_iter().map(Into::into).collect::<Vec<_>>();
    if has_nested_home(&args) {
        return Err(clap::Error::raw(
            clap::error::ErrorKind::UnknownArgument,
            "nested `--home` is unsupported; use `raven --home <path> todo ...`",
        )
        .into());
    }
    let command = forwarded_command(&args);
    if command.is_some_and(|command| command == "--help" || command == "-h" || command == "help") {
        print!("{HELP}");
        return Ok(());
    }
    if command.is_some_and(|command| command == "api") {
        return Err(clap::Error::raw(
            clap::error::ErrorKind::InvalidSubcommand,
            "`raven todo api` is unsupported; use `raven api` or `raven ui`",
        )
        .into());
    }
    let args = std::iter::once(OsString::from("raven todo")).chain(args);
    todo_engine::interfaces::cli::run_at(paths.home(), args)
}

fn has_nested_home(args: &[OsString]) -> bool {
    forwarded_command(args).is_some_and(|arg| {
        arg == "--home"
            || arg
                .to_str()
                .is_some_and(|value| value.starts_with("--home="))
    })
}

fn forwarded_command(args: &[OsString]) -> Option<&std::ffi::OsStr> {
    args.iter()
        .find(|arg| arg.as_os_str() != "--")
        .map(OsString::as_os_str)
}
