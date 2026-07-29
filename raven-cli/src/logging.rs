use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tracing_subscriber::Layer;
use tracing_subscriber::filter::{LevelFilter, Targets};
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::config::RavenPaths;

const DEFAULT_LOG_MAX_BYTES: u64 = 1_048_576;
const DEFAULT_LOG_MAX_FILES: usize = 3;

pub fn init(paths: &RavenPaths) {
    let console_level = level_from_env("RAVEN_CONSOLE_LOG", LevelFilter::INFO);
    let file_level = level_from_env("RAVEN_FILE_LOG", LevelFilter::DEBUG);
    let file_writer = RotatingJsonlMakeWriter::new(
        paths.log_file(),
        log_max_bytes_from_env(),
        log_max_files_from_env(),
        warning_enabled(console_level),
    );

    let console_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_filter(raven_targets(console_level));
    let file_layer = tracing_subscriber::fmt::layer()
        .json()
        .flatten_event(false)
        .with_writer(file_writer)
        .with_filter(raven_targets(file_level));

    let _ = tracing_subscriber::registry()
        .with(console_layer)
        .with(file_layer)
        .try_init();
}

fn raven_targets(level: LevelFilter) -> Targets {
    Targets::new()
        .with_default(LevelFilter::OFF)
        .with_target("raven_cli", level)
}

fn warning_enabled(level: LevelFilter) -> bool {
    matches!(
        level,
        LevelFilter::WARN | LevelFilter::INFO | LevelFilter::DEBUG | LevelFilter::TRACE
    )
}

#[derive(Debug, Clone)]
struct RotatingJsonlMakeWriter {
    state: Arc<Mutex<RotatingJsonlState>>,
}

#[derive(Debug)]
struct RotatingJsonlState {
    path: PathBuf,
    max_bytes: u64,
    max_files: usize,
    warning_enabled: bool,
}

#[derive(Debug)]
struct RotatingJsonlWriter {
    state: Arc<Mutex<RotatingJsonlState>>,
    buffer: Vec<u8>,
}

impl RotatingJsonlMakeWriter {
    fn new(path: PathBuf, max_bytes: u64, max_files: usize, warning_enabled: bool) -> Self {
        Self {
            state: Arc::new(Mutex::new(RotatingJsonlState {
                path,
                max_bytes,
                max_files,
                warning_enabled,
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
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.buffer.extend_from_slice(bytes);
        Ok(bytes.len())
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
        let Ok(state) = self.state.lock() else {
            return;
        };
        if state.write_event(&self.buffer).is_err() && state.warning_enabled {
            eprintln!("WARN raven_cli::logging: Raven file logging unavailable");
        }
    }
}

impl RotatingJsonlState {
    fn write_event(&self, bytes: &[u8]) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        self.rotate_if_needed(bytes.len() as u64)?;
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?
            .write_all(bytes)
    }

    fn rotate_if_needed(&self, incoming_bytes: u64) -> io::Result<()> {
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
            .unwrap_or("raven.log.jsonl");
        self.path.with_file_name(format!("{file_name}.{index}"))
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

fn log_max_bytes_from_env() -> u64 {
    std::env::var("RAVEN_LOG_MAX_BYTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_LOG_MAX_BYTES)
}

fn log_max_files_from_env() -> usize {
    std::env::var("RAVEN_LOG_MAX_FILES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(DEFAULT_LOG_MAX_FILES)
}
