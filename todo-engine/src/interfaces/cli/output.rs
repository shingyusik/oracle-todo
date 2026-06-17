use anyhow::Result;
use serde::Serialize;

/// Print a value as a single JSON line to stdout (the CLI's machine-readable result).
pub(super) fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string(value)?);
    Ok(())
}
