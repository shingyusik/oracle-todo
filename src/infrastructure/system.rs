use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use time::{OffsetDateTime, UtcOffset};

pub fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init();
}

#[derive(Debug, Clone)]
pub struct FileLogger {
    path: PathBuf,
    max_bytes: u64,
}

impl FileLogger {
    pub fn new(home: &Path) -> std::io::Result<Self> {
        let log_dir = home.join("logs");
        fs::create_dir_all(&log_dir)?;
        let max_bytes = std::env::var("ORACLE_TODO_LOG_MAX_BYTES")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(1_048_576);
        Ok(Self {
            path: log_dir.join("oracle-todo.log"),
            max_bytes,
        })
    }

    pub fn info(&self, event: &str, message: &str) {
        self.write("INFO", event, message);
    }

    pub fn error(&self, event: &str, message: &str) {
        self.write("ERROR", event, message);
    }

    fn write(&self, level: &str, event: &str, message: &str) {
        let line = format!(
            "{} level={} event={} message={}\n",
            OffsetDateTime::now_utc(),
            level,
            event,
            sanitize_log_message(message)
        );
        if let Err(error) = self.rotate_if_needed(line.len() as u64).and_then(|_| {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
                .and_then(|mut file| file.write_all(line.as_bytes()))
        }) {
            tracing::warn!(%error, path = %self.path.display(), "failed to write oracle-todo log file");
        }
    }

    fn rotate_if_needed(&self, incoming_bytes: u64) -> std::io::Result<()> {
        let current_bytes = fs::metadata(&self.path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if current_bytes == 0 || current_bytes + incoming_bytes <= self.max_bytes {
            return Ok(());
        }
        let rotated = self.path.with_file_name("oracle-todo.log.1");
        if rotated.exists() {
            fs::remove_file(&rotated)?;
        }
        if self.path.exists() {
            fs::rename(&self.path, rotated)?;
        }
        Ok(())
    }
}

fn sanitize_log_message(message: &str) -> String {
    message.replace('\n', "\\n").replace('\r', "\\r")
}

pub fn local_today_string() -> String {
    let offset = UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC);
    local_date_string_at(OffsetDateTime::now_utc(), offset)
}

pub fn local_date_string_at(now_utc: OffsetDateTime, offset: UtcOffset) -> String {
    now_utc.to_offset(offset).date().to_string()
}
