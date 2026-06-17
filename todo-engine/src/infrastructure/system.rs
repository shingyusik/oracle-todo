use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::json;
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};
use tracing_subscriber::Layer;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

pub fn init_tracing(home: &Path) {
    let console_level = level_from_env("TODO_ENGINE_CONSOLE_LOG", LevelFilter::INFO);
    let file_level = level_from_env("TODO_ENGINE_FILE_LOG", LevelFilter::DEBUG);
    let file_writer = RotatingJsonlMakeWriter::new(
        home.join("logs/todo-engine.log.jsonl"),
        log_max_bytes_from_env(),
        log_max_files_from_env(),
        file_level,
    );

    let console_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_filter(console_level);
    let file_layer = tracing_subscriber::fmt::layer()
        .json()
        .flatten_event(false)
        .with_writer(file_writer)
        .with_filter(file_level);

    let _ = tracing_subscriber::registry()
        .with(console_layer)
        .with(file_layer)
        .try_init();
}

const DEFAULT_LOG_MAX_BYTES: u64 = 1_048_576;
const DEFAULT_LOG_MAX_FILES: usize = 3;

#[derive(Debug, Clone)]
struct RotatingJsonlMakeWriter {
    state: Arc<Mutex<RotatingJsonlState>>,
}

#[derive(Debug)]
struct RotatingJsonlState {
    path: PathBuf,
    max_bytes: u64,
    max_files: usize,
    level: LevelFilter,
}

#[derive(Debug)]
struct RotatingJsonlWriter {
    state: Arc<Mutex<RotatingJsonlState>>,
    buffer: Vec<u8>,
}

impl RotatingJsonlMakeWriter {
    fn new(path: PathBuf, max_bytes: u64, max_files: usize, level: LevelFilter) -> Self {
        Self {
            state: Arc::new(Mutex::new(RotatingJsonlState {
                path,
                max_bytes,
                max_files,
                level,
            })),
        }
    }
}

impl<'a> MakeWriter<'a> for RotatingJsonlMakeWriter {
    type Writer = RotatingJsonlWriter;

    fn make_writer(&'a self) -> Self::Writer {
        RotatingJsonlWriter {
            state: Arc::clone(&self.state),
            buffer: Vec::new(),
        }
    }
}

impl Write for RotatingJsonlWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.buffer.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for RotatingJsonlWriter {
    fn drop(&mut self) {
        if self.buffer.is_empty() {
            return;
        }
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if let Err(error) = state.write_event(&self.buffer) {
            eprintln!("{}", log_write_fallback_warning(&state.path, &error));
        }
    }
}

impl RotatingJsonlState {
    fn write_event(&mut self, bytes: &[u8]) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        let rotated = self.rotate_if_needed(bytes.len() as u64)?;
        if rotated && self.should_write_rotation_record() {
            self.write_rotation_record()?;
        }

        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?
            .write_all(bytes)
    }

    fn rotate_if_needed(&self, incoming_bytes: u64) -> io::Result<bool> {
        let current_bytes = fs::metadata(&self.path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if current_bytes == 0 || current_bytes + incoming_bytes <= self.max_bytes {
            return Ok(false);
        }

        if self.max_files == 0 {
            if self.path.exists() {
                fs::remove_file(&self.path)?;
            }
            return Ok(true);
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
        Ok(true)
    }

    fn write_rotation_record(&self) -> io::Result<()> {
        let record = json!({
            "timestamp": timestamp(),
            "level": "INFO",
            "fields": {
                "message": "log file rotated",
                "event": "log_rotated",
                "backup_count": self.max_files,
            },
            "target": "todo_engine::infrastructure::system",
        });
        let mut line = serde_json::to_vec(&record)?;
        line.push(b'\n');
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?
            .write_all(&line)
    }

    fn rotated_path(&self, index: usize) -> PathBuf {
        let file_name = self
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("todo-engine.log.jsonl");
        self.path.with_file_name(format!("{file_name}.{index}"))
    }

    fn should_write_rotation_record(&self) -> bool {
        matches!(
            self.level,
            LevelFilter::INFO | LevelFilter::DEBUG | LevelFilter::TRACE
        )
    }
}

fn level_from_env(name: &str, default: LevelFilter) -> LevelFilter {
    std::env::var(name)
        .ok()
        .and_then(|value| match value.to_ascii_lowercase().as_str() {
            "off" => Some(LevelFilter::OFF),
            "error" => Some(LevelFilter::ERROR),
            "warn" | "warning" => Some(LevelFilter::WARN),
            "info" => Some(LevelFilter::INFO),
            "debug" => Some(LevelFilter::DEBUG),
            "trace" => Some(LevelFilter::TRACE),
            _ => None,
        })
        .unwrap_or(default)
}

fn timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| OffsetDateTime::now_utc().to_string())
}

fn log_write_fallback_warning(path: &Path, error: &io::Error) -> String {
    format!(
        "WARN todo_engine::infrastructure::system: failed to write log file path=\"{}\" error=\"{}\"",
        path.display(),
        error
    )
}

fn log_max_bytes_from_env() -> u64 {
    std::env::var("TODO_ENGINE_LOG_MAX_BYTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_LOG_MAX_BYTES)
}

fn log_max_files_from_env() -> usize {
    std::env::var("TODO_ENGINE_LOG_MAX_FILES")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_record_respects_file_log_level() {
        for level in [LevelFilter::OFF, LevelFilter::ERROR, LevelFilter::WARN] {
            let state = RotatingJsonlState {
                path: PathBuf::from("todo-engine.log.jsonl"),
                max_bytes: 1,
                max_files: 1,
                level,
            };
            assert!(!state.should_write_rotation_record());
        }

        for level in [LevelFilter::INFO, LevelFilter::DEBUG, LevelFilter::TRACE] {
            let state = RotatingJsonlState {
                path: PathBuf::from("todo-engine.log.jsonl"),
                max_bytes: 1,
                max_files: 1,
                level,
            };
            assert!(state.should_write_rotation_record());
        }
    }

    #[test]
    fn log_write_fallback_warning_includes_path_and_error() {
        let error = io::Error::new(io::ErrorKind::PermissionDenied, "permission denied");
        let warning = log_write_fallback_warning(Path::new("/tmp/te/log.jsonl"), &error);

        assert!(warning.contains("failed to write log file"));
        assert!(warning.contains("path=\"/tmp/te/log.jsonl\""));
        assert!(warning.contains("error=\"permission denied\""));
    }
}
