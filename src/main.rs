use anyhow::Result;
use clap::{Parser, Subcommand};
use rusqlite::Connection;
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "oracle-todo")]
#[command(about = "Policy-enforced Oracle ToDo engine")]
struct Cli {
    /// Data home. Defaults to ORACLE_TODO_HOME or ~/.hermes/oracle-todo.
    #[arg(long, env = "ORACLE_TODO_HOME")]
    home: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Initialize the SQLite database.
    Init,
    /// Check database reachability and schema baseline.
    Health,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let home = resolve_home(cli.home)?;
    let db_path = home.join("todo.sqlite");

    match cli.command {
        Command::Init => {
            std::fs::create_dir_all(&home)?;
            let conn = Connection::open(&db_path)?;
            init_schema(&conn)?;
            println!("initialized {}", db_path.display());
        }
        Command::Health => {
            let conn = Connection::open(&db_path)?;
            let user_version: i64 =
                conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
            println!("ok db={} user_version={}", db_path.display(), user_version);
        }
    }

    Ok(())
}

fn resolve_home(home: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(home) = home {
        return Ok(home);
    }
    if let Some(home) = std::env::var_os("ORACLE_TODO_HOME") {
        return Ok(PathBuf::from(home));
    }
    let home = std::env::var_os("HOME").ok_or_else(|| anyhow::anyhow!("HOME is not set"))?;
    Ok(PathBuf::from(home).join(".hermes/oracle-todo"))
}

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA user_version = 1;
        CREATE TABLE IF NOT EXISTS engine_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        INSERT OR REPLACE INTO engine_meta(key, value)
        VALUES ('engine', 'oracle-todo-rust-refactor');
        "#,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_sets_schema_baseline() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
    }
}
