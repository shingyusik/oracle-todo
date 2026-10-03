//! Durable create receipts. Domain writes still go through the application services.
use rmcp::model::CallToolResult;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::Path;

pub(super) enum Claim {
    New,
    Replay(CallToolResult),
    Conflict,
    Pending,
}

pub(super) fn fingerprint(name: &str, args: &Value) -> String {
    // serde_json maps use sorted keys. Retain only a digest, never images or create input.
    let mut hash = Sha256::new();
    hash.update(name);
    hash.update([0]);
    hash.update(serde_json::to_vec(args).expect("JSON serializes"));
    format!("{:x}", hash.finalize())
}
fn open(path: &Path) -> anyhow::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(std::time::Duration::from_secs(30))?;
    conn.execute_batch("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS mcp_receipts (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result_json TEXT);")?;
    Ok(conn)
}
pub(super) fn claim(path: &Path, key: &str, fingerprint: &str) -> anyhow::Result<Claim> {
    let mut conn = open(path)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let row: Option<(String, Option<String>)> = tx
        .query_row(
            "SELECT fingerprint,result_json FROM mcp_receipts WHERE request_key=?1",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let result = match row {
        Some((stored, _)) if stored != fingerprint => Claim::Conflict,
        Some((_, Some(result))) => Claim::Replay(serde_json::from_str(&result)?),
        Some((_, None)) => Claim::Pending,
        None => {
            tx.execute(
                "INSERT INTO mcp_receipts(request_key,fingerprint) VALUES (?1,?2)",
                params![key, fingerprint],
            )?;
            Claim::New
        }
    };
    tx.commit()?;
    Ok(result)
}
pub(super) fn finish(
    path: &Path,
    key: &str,
    fingerprint: &str,
    result: &CallToolResult,
) -> anyhow::Result<()> {
    let conn = open(path)?;
    let changed = conn.execute("UPDATE mcp_receipts SET result_json=?3 WHERE request_key=?1 AND fingerprint=?2 AND result_json IS NULL", params![key,fingerprint,serde_json::to_string(result)?])?;
    anyhow::ensure!(changed == 1, "receipt unavailable");
    Ok(())
}
pub(super) fn unknown() -> CallToolResult {
    let mut result = CallToolResult::structured(
        json!({"code":"request_outcome_unknown","message":"Create receipt is pending or unavailable. Inspect records before another create; repeating this key does not execute a pending operation.","committed":null,"retryable":false}),
    );
    result.is_error = Some(true);
    result
}
