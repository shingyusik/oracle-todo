use std::fmt;
use std::net::SocketAddr;
use std::path::PathBuf;
use time::UtcOffset;

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
    pub local_offset: UtcOffset,
    pub auth: AuthMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServerBind {
    pub addr: SocketAddr,
    pub allow_unsafe_cleartext: bool,
}

impl fmt::Debug for RavenApiConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RavenApiConfig")
            .field("todo_db", &"<redacted>")
            .field("ledger_db", &"<redacted>")
            .field("health_db", &"<redacted>")
            .field("health_media_dir", &"<redacted>")
            .field("local_offset", &self.local_offset)
            .field("auth", &self.auth)
            .finish()
    }
}
