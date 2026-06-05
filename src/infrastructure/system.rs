use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};

pub fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init();
}

const DEFAULT_LOG_MAX_BYTES: u64 = 1_048_576;
const DEFAULT_LOG_MAX_FILES: usize = 3;

#[derive(Debug, Clone)]
pub struct OperationalLogger {
    path: PathBuf,
    max_bytes: u64,
    max_files: usize,
    pid: u32,
}

#[derive(Debug, Serialize)]
struct LogRecord<'a> {
    timestamp: String,
    level: &'a str,
    event: &'a str,
    command: &'a str,
    message: &'a str,
    pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u64>,
}

impl OperationalLogger {
    pub fn new(home: &Path) -> std::io::Result<Self> {
        let log_dir = home.join("logs");
        fs::create_dir_all(&log_dir)?;
        Ok(Self {
            path: log_dir.join("oracle-todo.jsonl"),
            max_bytes: log_max_bytes_from_env(),
            max_files: log_max_files_from_env(),
            pid: std::process::id(),
        })
    }

    pub fn command_start(&self, command: &str) {
        self.write(LogRecord {
            timestamp: timestamp(),
            level: "INFO",
            event: "command_start",
            command,
            message: "command started",
            pid: self.pid,
            exit_code: None,
            duration_ms: None,
        });
    }

    pub fn command_success(&self, command: &str, duration_ms: u64) {
        self.write(LogRecord {
            timestamp: timestamp(),
            level: "INFO",
            event: "command_success",
            command,
            message: "command completed",
            pid: self.pid,
            exit_code: Some(0),
            duration_ms: Some(duration_ms),
        });
    }

    pub fn command_error(
        &self,
        command: &str,
        message: &str,
        exit_code: Option<i32>,
        duration_ms: u64,
    ) {
        self.write(LogRecord {
            timestamp: timestamp(),
            level: "ERROR",
            event: "command_error",
            command,
            message,
            pid: self.pid,
            exit_code,
            duration_ms: Some(duration_ms),
        });
    }

    fn write(&self, record: LogRecord<'_>) {
        let Ok(mut line) = serde_json::to_string(&record) else {
            tracing::warn!("failed to serialize oracle-todo log record");
            return;
        };
        line.push('\n');
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

        if self.max_files == 0 {
            if self.path.exists() {
                fs::remove_file(&self.path)?;
            }
            return Ok(());
        }

        let oldest = self.rotated_path(self.max_files);
        if oldest.exists() {
            fs::remove_file(oldest)?;
        }

        for index in (1..self.max_files).rev() {
            let source = self.rotated_path(index);
            if source.exists() {
                fs::rename(source, self.rotated_path(index + 1))?;
            }
        }

        if self.path.exists() {
            fs::rename(&self.path, self.rotated_path(1))?;
        }
        Ok(())
    }

    fn rotated_path(&self, index: usize) -> PathBuf {
        let file_name = self
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("oracle-todo.jsonl");
        self.path.with_file_name(format!("{file_name}.{index}"))
    }
}

fn timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| OffsetDateTime::now_utc().to_string())
}

fn log_max_bytes_from_env() -> u64 {
    std::env::var("ORACLE_TODO_LOG_MAX_BYTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_LOG_MAX_BYTES)
}

fn log_max_files_from_env() -> usize {
    std::env::var("ORACLE_TODO_LOG_MAX_FILES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(DEFAULT_LOG_MAX_FILES)
}

pub fn local_today_string() -> String {
    let offset = UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC);
    local_date_string_at(OffsetDateTime::now_utc(), offset)
}

pub fn local_date_string_at(now_utc: OffsetDateTime, offset: UtcOffset) -> String {
    now_utc.to_offset(offset).date().to_string()
}
