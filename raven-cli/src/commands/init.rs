use anyhow::Result;

use crate::commands::todo;
use crate::config::RavenPaths;

pub fn run(paths: &RavenPaths) -> Result<()> {
    std::fs::create_dir_all(paths.home())?;
    std::fs::create_dir_all(paths.health_media_dir())?;
    todo::run(paths, ["init"])
}
