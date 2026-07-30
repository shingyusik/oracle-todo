use std::ffi::OsString;

use anyhow::Result;

use crate::config::RavenPaths;

pub fn run<I, T>(paths: &RavenPaths, args: I) -> Result<()>
where
    I: IntoIterator<Item = T>,
    T: Into<OsString>,
{
    let args = args.into_iter().map(Into::into).collect::<Vec<_>>();
    if forwarded_command(&args).is_some_and(|command| command == "api") {
        return Err(clap::Error::raw(
            clap::error::ErrorKind::InvalidSubcommand,
            "`raven todo api` is unsupported; use `raven api` or `raven ui`",
        )
        .into());
    }
    let args = std::iter::once(OsString::from("todo-engine")).chain(args);
    todo_engine::interfaces::cli::run_at(paths.home(), args)
}

fn forwarded_command(args: &[OsString]) -> Option<&std::ffi::OsStr> {
    let mut index = 0;
    while let Some(arg) = args.get(index) {
        if arg == "--home" {
            index += 2;
        } else if arg
            .to_str()
            .is_some_and(|value| value.starts_with("--home="))
        {
            index += 1;
        } else if arg == "--" {
            return args.get(index + 1).map(OsString::as_os_str);
        } else {
            return Some(arg);
        }
    }
    None
}
