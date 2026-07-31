use anyhow::Result;
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;

use crate::commands::todo;
use crate::config::RavenPaths;

pub fn run(paths: &RavenPaths) -> Result<()> {
    std::fs::create_dir_all(paths.home())?;
    std::fs::create_dir_all(paths.health_media_dir())?;
    todo::run(paths, ["init"])?;
    SqliteLedgerRepository::open(paths.ledger_db()).map_err(anyhow::Error::new)?;
    SqliteHealthRepository::open(paths.health_db()).map_err(anyhow::Error::new)?;
    LocalMediaStore::new(paths.health_media_dir()).map_err(anyhow::Error::new)?;
    Ok(())
}
