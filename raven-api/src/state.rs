use std::fmt;
use std::path::Path;
use std::sync::Arc;

use crate::config::{AuthMode, RavenApiConfig};

#[derive(Clone)]
pub struct RavenApiState {
    config: Arc<RavenApiConfig>,
}

impl RavenApiState {
    pub fn new(config: RavenApiConfig) -> Self {
        Self {
            config: Arc::new(config),
        }
    }

    pub fn todo_db(&self) -> &Path {
        &self.config.todo_db
    }

    pub fn ledger_db(&self) -> &Path {
        &self.config.ledger_db
    }

    pub fn health_db(&self) -> &Path {
        &self.config.health_db
    }

    pub fn health_media_dir(&self) -> &Path {
        &self.config.health_media_dir
    }

    pub fn auth(&self) -> &AuthMode {
        &self.config.auth
    }
}

impl fmt::Debug for RavenApiState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RavenApiState")
            .field("config", &self.config)
            .finish()
    }
}
