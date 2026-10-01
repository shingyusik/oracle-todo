use std::ffi::OsString;

use anyhow::Result;

use crate::config::RavenPaths;

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
    let help_target = forwarded_help_target(&args);
    if command.is_some_and(|command| command == "api")
        || help_target.is_some_and(|command| command == "api")
    {
        return Err(clap::Error::raw(
            clap::error::ErrorKind::InvalidSubcommand,
            "`raven todo api` is unsupported; use `raven api` or `raven ui`",
        )
        .into());
    }
    let args = std::iter::once(OsString::from("raven todo")).chain(args);
    todo_engine::interfaces::cli::run_raven_at(paths.home(), args)
}

pub fn validate_args(args: &[OsString]) -> Result<()> {
    let args = std::iter::once(OsString::from("raven todo")).chain(args.iter().cloned());
    todo_engine::interfaces::cli::validate_raven_args(args)
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

fn forwarded_help_target(args: &[OsString]) -> Option<&std::ffi::OsStr> {
    let mut args = args.iter().filter(|arg| arg.as_os_str() != "--");
    if args.next().is_some_and(|command| command == "help") {
        args.next().map(OsString::as_os_str)
    } else {
        None
    }
}
