//! Create-retry CLI ⇄ MCP contract (SHI-456): same-key replay and changed-input conflict.
//! Pending/timeout receipts are covered per adapter by raven-api `mcp::tests`
//! (`keyed_timeout_leaves_pending_receipt_and_never_reexecutes`) and the CLI retry tests.
#[path = "support/contract.rs"]
mod contract;

use contract::{Home, normalize};
use serde_json::{Value, json};

struct Case {
    cli: Vec<&'static str>,
    cli_changed: Vec<&'static str>,
    tool: &'static str,
    input: Value,
    changed: Value,
    count: Vec<&'static str>,
}

fn cases() -> Vec<Case> {
    vec![
        Case {
            cli: vec!["todo", "task", "create", "Retry task"],
            cli_changed: vec!["todo", "task", "create", "Other task"],
            tool: "todo_task_create",
            input: json!({"title":"Retry task"}),
            changed: json!({"title":"Other task"}),
            count: vec!["todo", "list", "--format", "json"],
        },
        Case {
            cli: vec![
                "health",
                "diet",
                "add",
                "--at",
                "2026-10-02T12:00:00+09:00",
                "--meal",
                "lunch",
                "--food",
                "Rice",
            ],
            cli_changed: vec![
                "health",
                "diet",
                "add",
                "--at",
                "2026-10-02T12:00:00+09:00",
                "--meal",
                "lunch",
                "--food",
                "Noodles",
            ],
            tool: "health_diet_create",
            input: json!({"occurred_at":"2026-10-02T12:00:00+09:00","meal_type":"lunch","food_name":"Rice"}),
            changed: json!({"occurred_at":"2026-10-02T12:00:00+09:00","meal_type":"lunch","food_name":"Noodles"}),
            count: vec!["health", "diet", "list", "--format", "json"],
        },
    ]
}

fn keyed<'a>(key: &'a str, args: &[&'a str]) -> Vec<&'a str> {
    let mut keyed = vec!["--request-key", key];
    keyed.extend(args);
    keyed
}

fn count(home: &Home, args: &[&str]) -> usize {
    home.cli(args)["items"].as_array().unwrap().len()
}

#[tokio::test]
async fn same_key_replays_and_changed_input_conflicts_on_both_adapters() {
    for case in cases() {
        let (cli, mcp) = (Home::new().await, Home::new().await);
        let first = cli.cli(&keyed("contract.retry", &case.cli));
        let mut input = case.input.clone();
        input["request_key"] = json!("contract.retry");
        let mcp_first = mcp.mcp(case.tool, input.clone()).await;
        assert_eq!(normalize(&first), normalize(&mcp_first), "{}", case.tool);
        // Replay returns the original result byte-for-byte without a second write.
        assert_eq!(cli.cli(&keyed("contract.retry", &case.cli)), first);
        assert_eq!(mcp.mcp(case.tool, input).await, mcp_first);
        // Changed input under the same key is refused, nothing is written.
        let conflict = cli.cli_err(&keyed("contract.retry", &case.cli_changed));
        let mut changed = case.changed.clone();
        changed["request_key"] = json!("contract.retry");
        let mcp_conflict = mcp.mcp_err(case.tool, changed).await;
        assert_eq!(conflict.0, 2, "{}", case.tool);
        contract::same_error(&conflict, &mcp_conflict, "request_key_conflict");
        assert_eq!(conflict.1["committed"], false);
        assert_eq!(mcp_conflict["committed"], false);
        assert_eq!(count(&cli, &case.count), 1, "{}", case.tool);
        assert_eq!(count(&mcp, &case.count), 1, "{}", case.tool);
        // Documented: CLI and MCP keep separate receipt stores, so one key does not
        // deduplicate across adapters. Callers must not share keys between them.
        mcp.cli(&keyed("contract.retry", &case.cli));
        assert_eq!(count(&mcp, &case.count), 2, "{}", case.tool);
    }
}
