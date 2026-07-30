use std::fmt;
use std::path::PathBuf;

#[derive(Clone, PartialEq, Eq)]
pub enum AuthMode {
    Bearer { token: String },
    UiSession { token: String },
}

impl fmt::Debug for AuthMode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Bearer { .. } => "Bearer { token: <redacted> }",
            Self::UiSession { .. } => "UiSession { token: <redacted> }",
        })
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct RavenApiConfig {
    pub todo_db: PathBuf,
    pub ledger_db: PathBuf,
    pub health_db: PathBuf,
    pub health_media_dir: PathBuf,
    pub auth: AuthMode,
}

impl fmt::Debug for RavenApiConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RavenApiConfig")
            .field("todo_db", &"<redacted>")
            .field("ledger_db", &"<redacted>")
            .field("health_db", &"<redacted>")
            .field("health_media_dir", &"<redacted>")
            .field("auth", &self.auth)
            .finish()
    }
}
