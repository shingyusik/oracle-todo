use std::ffi::OsString;

use anyhow::Result;

use crate::config::RavenPaths;

pub fn run<I, T>(paths: &RavenPaths, args: I) -> Result<()>
where
    I: IntoIterator<Item = T>,
    T: Into<OsString>,
{
    let args =
        std::iter::once(OsString::from("todo-engine")).chain(args.into_iter().map(Into::into));
    todo_engine::interfaces::cli::run_at(paths.home(), args)
}
