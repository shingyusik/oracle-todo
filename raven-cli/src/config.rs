use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RavenPaths {
    home: PathBuf,
}

impl RavenPaths {
    pub fn from_home(home: impl Into<PathBuf>) -> Self {
        Self { home: home.into() }
    }

    pub fn resolve(explicit: Option<PathBuf>) -> anyhow::Result<Self> {
        let env_home = std::env::var_os("RAVEN_HOME").map(PathBuf::from);
        Self::resolve_with_default(explicit, env_home)
    }

    pub fn resolve_with_default(
        explicit: Option<PathBuf>,
        env_home: Option<PathBuf>,
    ) -> anyhow::Result<Self> {
        let home = explicit
            .or(env_home)
            .or_else(|| {
                std::env::var_os("HOME")
                    .filter(|value| !value.is_empty())
                    .map(|value| PathBuf::from(value).join(".raven"))
            })
            .or_else(|| {
                if cfg!(windows) {
                    std::env::var_os("USERPROFILE")
                        .filter(|value| !value.is_empty())
                        .map(|value| PathBuf::from(value).join(".raven"))
                } else {
                    None
                }
            })
            .ok_or_else(|| anyhow::anyhow!("Home directory is not set"))?;

        Ok(Self { home })
    }

    pub fn todo_db(&self) -> PathBuf {
        self.home.join("todo.sqlite")
    }

    pub fn ledger_db(&self) -> PathBuf {
        self.home.join("ledger.sqlite")
    }

    pub fn health_db(&self) -> PathBuf {
        self.home.join("health.sqlite")
    }

    pub fn health_media_dir(&self) -> PathBuf {
        self.home.join("media/health")
    }

    pub fn log_file(&self) -> PathBuf {
        self.home.join("logs/raven.log.jsonl")
    }

    pub fn home(&self) -> &Path {
        &self.home
    }
}
