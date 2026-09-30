use crate::{cli::*, config::RavenPaths, errors::CliError};
use rusqlite::{Connection, OptionalExtension, params};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::process::{Command as Process, Output, Stdio};
use std::time::{Duration, Instant};

pub fn execute(
    paths: &RavenPaths,
    command: &Command,
    key: &str,
    args: &[OsString],
    timeout: Duration,
) -> anyhow::Result<()> {
    if key.is_empty()
        || key.len() > 128
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b))
    {
        return Err(CliError::new("invalid_request_key", "Request key must contain 1..128 ASCII letters, digits, dash, underscore, period, or colon.", 2, Some(false), true).into());
    }
    if !supported(command) {
        return Err(CliError::new(
            "request_key_unsupported",
            "Request keys support only create, add, and propose commands.",
            2,
            Some(false),
            true,
        )
        .into());
    }
    if args
        .iter()
        .take_while(|arg| *arg != "--")
        .any(|arg| arg == "--help" || arg == "-h")
    {
        return Err(CliError::new(
            "request_key_unsupported",
            "Request keys cannot be used for help requests.",
            2,
            Some(false),
            true,
        )
        .into());
    }
    let payload = child_args(args)?;
    let encoded = serde_json::to_string(
        &payload
            .iter()
            .map(|arg| {
                arg.to_str()
                    .ok_or_else(|| anyhow::anyhow!("non UTF-8 argument"))
            })
            .collect::<anyhow::Result<Vec<_>>>()?,
    )?;
    std::fs::create_dir_all(paths.home())?;
    let mut db = Connection::open(paths.home().join("retry.sqlite"))?;
    db.busy_timeout(std::time::Duration::from_secs(30))?;
    db.execute_batch("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS receipts (request_key TEXT PRIMARY KEY, payload TEXT NOT NULL, stdout BLOB);")?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let receipt: Option<(String, Option<Vec<u8>>)> = tx
        .query_row(
            "SELECT payload, stdout FROM receipts WHERE request_key=?1",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((saved_payload, output)) = receipt {
        if saved_payload != encoded {
            return Err(CliError::new(
                "request_key_conflict",
                "Request key already belongs to a different payload.",
                2,
                Some(false),
                false,
            )
            .into());
        }
        if let Some(output) = output {
            std::io::stdout().write_all(&output)?;
            return Ok(());
        }
        return Err(uncertain().into());
    }
    tx.execute(
        "INSERT INTO receipts(request_key,payload) VALUES (?1,?2)",
        params![key, encoded],
    )?;
    tx.commit()?;
    // Persist pending before service execution. A crash in either database leaves an uncertain receipt.
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let mut child = Process::new(std::env::current_exe()?);
    child
        .arg("--home")
        .arg(paths.home())
        .args(["--error-format", "json"])
        .args(payload)
        .env("RAVEN_CONSOLE_LOG", "off");
    let result = bounded_output(&mut child, timeout)?;
    if result.status.success() {
        tx.execute(
            "UPDATE receipts SET stdout=?2 WHERE request_key=?1",
            params![key, result.stdout],
        )?;
        tx.commit()?;
        std::io::stdout().write_all(&result.stdout)?;
        return Ok(());
    }
    let mut error =
        serde_json::from_slice::<CliError>(&result.stderr).unwrap_or_else(|_| uncertain());
    error.exit = result
        .status
        .code()
        .filter(|code| [1, 2, 4].contains(code))
        .unwrap_or(1);
    if error.committed == Some(false) && error.retryable {
        tx.execute("DELETE FROM receipts WHERE request_key=?1", [key])?;
        tx.commit()?;
    }
    Err(error.into())
}
fn uncertain() -> CliError {
    CliError::new(
        "request_outcome_unknown",
        "Previous request outcome is unknown; inspect records before issuing a new request key.",
        1,
        None,
        false,
    )
}
fn bounded_output(command: &mut Process, timeout: Duration) -> anyhow::Result<Output> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let drain = |mut pipe: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            pipe.read_to_end(&mut bytes).map(|_| bytes)
        })
    };
    let stdout = drain(Box::new(stdout));
    let stderr = drain(Box::new(stderr));
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(10))
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(CliError::new("request_timeout", "Request exceeded its execution deadline; inspect records before issuing a new request key.", 1, None, false).into());
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(anyhow::Error::new(error));
            }
        }
    };
    let stdout = stdout
        .join()
        .map_err(|_| anyhow::anyhow!("request output unavailable"))?;
    let stderr = stderr
        .join()
        .map_err(|_| anyhow::anyhow!("request output unavailable"))?;
    Ok(Output {
        status: status?,
        stdout: stdout?,
        stderr: stderr?,
    })
}
fn supported(command: &Command) -> bool {
    match command {
        Command::Todo { args } => {
            let mut args = args.iter().filter(|arg| *arg != "--");
            matches!(
                (
                    args.next().and_then(|s| s.to_str()),
                    args.next().and_then(|s| s.to_str())
                ),
                (Some("area"), Some("create"))
                    | (
                        Some("project" | "goal" | "task" | "routine" | "event"),
                        Some("propose" | "create")
                    )
            )
        }
        Command::Ledger { command } => matches!(
            command.as_ref(),
            LedgerCommand::Entry {
                command: LedgerEntryCommand::Add(_)
            } | LedgerCommand::Currency {
                command: CurrencyCommand::Create(_)
            } | LedgerCommand::AccountCategory {
                command: AccountCategoryCommand::Create(_)
            } | LedgerCommand::Account {
                command: AccountCommand::Create(_)
            } | LedgerCommand::Category {
                command: CategoryCommand::Create(_)
            }
        ),
        Command::Health { command } => matches!(
            command.as_ref(),
            HealthCommand::Diet {
                command: DietCommand::Add(_)
            } | HealthCommand::Bowel {
                command: BowelCommand::Add(_)
            } | HealthCommand::Medication {
                command: MedicationCommand::Add(_)
            }
        ),
        _ => false,
    }
}
fn child_args(args: &[OsString]) -> anyhow::Result<Vec<OsString>> {
    let mut output = Vec::new();
    let mut args = args.iter().skip(1);
    while let Some(arg) = args.next() {
        let value = arg.to_str().unwrap_or_default();
        if !value.starts_with('-') || value == "--" {
            output.push(arg.clone());
            output.extend(args.cloned());
            break;
        }
        if [
            "--request-key",
            "--error-format",
            "--home",
            "--request-timeout-seconds",
        ]
        .contains(&value)
        {
            args.next();
            continue;
        }
        if [
            "--request-key=",
            "--error-format=",
            "--home=",
            "--request-timeout-seconds=",
        ]
        .iter()
        .any(|flag| value.starts_with(flag))
        {
            continue;
        }
        output.push(arg.clone());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "child process fixture"]
    fn slow_child_fixture() {
        println!("fixture output");
        eprintln!("fixture diagnostic");
        std::thread::sleep(Duration::from_secs(10));
        panic!("deadline failed to terminate fixture");
    }

    #[test]
    fn deadline_kills_and_reaps_child() {
        let mut command = Process::new(std::env::current_exe().unwrap());
        command.args([
            "--ignored",
            "--exact",
            "retry::tests::slow_child_fixture",
            "--nocapture",
        ]);
        let started = Instant::now();
        let error = bounded_output(&mut command, Duration::from_millis(100)).unwrap_err();
        let error = error.downcast_ref::<CliError>().unwrap();
        assert_eq!(error.code, "request_timeout");
        assert_eq!(error.committed, None);
        assert!(!error.retryable);
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
