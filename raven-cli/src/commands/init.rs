use anyhow::Result;
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;

use crate::commands::todo;
use crate::config::RavenPaths;

pub fn run(paths: &RavenPaths) -> Result<()> {
    std::fs::create_dir_all(paths.home())?;
    std::fs::create_dir_all(paths.health_media_dir())?;
    todo::run(paths, ["init"])?;
    SqliteLedgerRepository::open(paths.ledger_db()).map_err(anyhow::Error::new)?;
    Ok(())
}
