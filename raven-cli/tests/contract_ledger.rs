//! Ledger CLI ⇄ MCP contract (SHI-456).
#[path = "support/contract.rs"]
mod contract;

use contract::{Home, normalize, same_error};
use serde_json::{Value, json};

const KEY: &str = "018f31c0-5c2a-4e75-9c18-a14d7bddb2a1";

/// Identical master data in every home, created through the CLI.
async fn seeded() -> Home {
    let home = Home::new().await;
    for args in [
        &[
            "ledger",
            "currency",
            "create",
            "--code",
            "KRW",
            "--name",
            "Won",
            "--symbol",
            "W",
            "--decimal-places",
            "0",
        ][..],
        &["ledger", "account-category", "create", "--name", "Cash"],
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "Wallet",
            "--category",
            "Cash",
            "--currency",
            "KRW",
            "--opening-balance",
            "1000",
        ],
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "Bank",
            "--category",
            "Cash",
            "--currency",
            "KRW",
            "--opening-balance",
            "0",
        ],
        &[
            "ledger", "category", "create", "--name", "Food", "--kind", "expense",
        ],
        &[
            "ledger", "category", "create", "--name", "Salary", "--kind", "income",
        ],
    ] {
        home.cli(args);
    }
    home
}

/// Entries and audit events record which adapter wrote them (`source`, `actor`). Check that
/// provenance, then blank it so the rest of the record can be compared.
fn provenance(value: &Value, adapter: Adapter) -> Value {
    fn walk(value: &mut Value, adapter: Adapter) {
        match value {
            Value::Object(map) => {
                for (key, field) in map.iter_mut() {
                    let expected = match key.as_str() {
                        "source" => adapter.source,
                        "actor" => adapter.actor,
                        _ => {
                            walk(field, adapter);
                            continue;
                        }
                    };
                    // Archive/restore are attributed to the service on every adapter.
                    if field.is_string() && field != "ledger-service" {
                        assert_eq!(field, expected, "{key}");
                        *field = json!("<adapter>");
                    }
                }
            }
            Value::Array(items) => items.iter_mut().for_each(|item| walk(item, adapter)),
            _ => {}
        }
    }
    let mut value = normalize(value);
    walk(&mut value, adapter);
    value
}

#[derive(Clone, Copy)]
struct Adapter {
    source: &'static str,
    actor: &'static str,
}
const CLI: Adapter = Adapter {
    source: "raven-cli",
    actor: "raven-cli",
};
const MCP: Adapter = Adapter {
    source: "api",
    actor: "raven-api",
};

/// Documented DTO difference: the CLI prints minor units with resolved names
/// (`amount_minor`, `account_name`, ...); HTTP/MCP return the stored entry (`amount`) and
/// wrap transfer sides as `{entry, account_name, category_name, currency_code}`. Project
/// both onto the shared stored fields.
fn entry(value: &Value) -> Value {
    let entry = value.get("entry").unwrap_or(value);
    let mut out = serde_json::Map::new();
    for key in [
        "id",
        "date",
        "content",
        "entry_type",
        "account_id",
        "transaction_category_id",
        "currency_id",
        "transfer_group_id",
        "notes",
        "source",
        "written_at",
        "created_at",
        "updated_at",
        "deleted_at",
    ] {
        out.insert(key.into(), entry[key].clone());
    }
    let amount = entry.get("amount_minor").unwrap_or(&entry["amount"]);
    out.insert("amount_minor".into(), amount.clone());
    Value::Object(out)
}

/// Documented envelope difference: CLI pages use `next`, HTTP/MCP pages use `next_offset`.
fn page(value: &Value, item: fn(&Value) -> Value) -> Value {
    let next = value.get("next").unwrap_or(&value["next_offset"]);
    json!({
        "items": value["items"].as_array().unwrap().iter().map(item).collect::<Vec<_>>(),
        "next": next,
    })
}

fn transfer_view(value: &Value) -> Value {
    json!({
        "transfer_group_id": value["transfer_group_id"],
        "amount_minor": value["amount_minor"],
        "currency_code": value["currency_code"],
        "from_account_name": value["from_account_name"],
        "to_account_name": value["to_account_name"],
        "out_entry": entry(&value["out_entry"]),
        "in_entry": entry(&value["in_entry"]),
    })
}

/// Documented report mismatch: HTTP/MCP serialize range dates as `[year, ordinal_day]`
/// (serde default for `time::Date`) and add `decimal_places`; the CLI prints ISO dates.
fn report(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(key, _)| key.as_str() != "decimal_places")
                .map(|(key, field)| {
                    let field = match (key.as_str(), field.as_array().map(Vec::as_slice)) {
                        ("start" | "end", Some([year, day])) => json!(
                            time::Date::from_ordinal_date(
                                year.as_i64().unwrap() as i32,
                                day.as_u64().unwrap() as u16
                            )
                            .unwrap()
                            .to_string()
                        ),
                        _ => report(field),
                    };
                    (key.clone(), field)
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(report).collect()),
        other => other.clone(),
    }
}

fn account(value: &Value) -> Value {
    json!({
        "id": value["id"],
        "name": value["name"],
        "active": value["active"],
        "category_id": value.get("account_category_id").unwrap_or(&value["category_id"]),
        "currency_id": value["currency_id"],
        "opening_minor": value.get("opening_balance_minor").unwrap_or(&value["opening_balance"]),
    })
}

fn balance(value: &Value) -> Value {
    let account = value.get("account");
    json!({
        "account_id": account.map_or(&value["account_id"], |a| &a["id"]),
        "account_name": account.map_or(&value["account_name"], |a| &a["name"]),
        "currency_code": value["currency_code"],
        "current_balance_minor": value["current_balance_minor"],
        "opening_minor": account.map_or(&value["opening_balance_minor"], |a| &a["opening_balance"]),
    })
}

fn entry_input() -> Value {
    json!({"date":"2026-10-02","entry_type":"expense","amount":"120","currency":"KRW","account":"Wallet","category":"Food","content":"Lunch","notes":"team"})
}

#[tokio::test]
async fn entry_lifecycle_reads_and_audit_agree() {
    let (cli, mcp) = (seeded().await, seeded().await);
    let a = cli.cli(&[
        "ledger",
        "entry",
        "add",
        "--json",
        &entry_input().to_string(),
    ]);
    let b = mcp.mcp("ledger_entry_create", entry_input()).await;
    assert_eq!(provenance(&entry(&a), CLI), provenance(&entry(&b), MCP));
    let (a_id, b_id) = (a["id"].as_str().unwrap(), b["id"].as_str().unwrap());

    let a = cli.cli(&[
        "ledger",
        "entry",
        "update",
        a_id,
        "--json",
        r#"{"content":"Dinner","amount":"130"}"#,
    ]);
    let b = mcp
        .mcp(
            "ledger_entry_update",
            json!({"id":b_id,"content":"Dinner","amount":"130"}),
        )
        .await;
    assert_eq!(provenance(&entry(&a), CLI), provenance(&entry(&b), MCP));

    let a = cli.cli(&["ledger", "entry", "archive", a_id]);
    let b = mcp.mcp("ledger_entry_archive", json!({"id":b_id})).await;
    assert_eq!(provenance(&entry(&a), CLI), provenance(&entry(&b), MCP));
    assert!(a["deleted_at"].is_string());

    // Archived: hidden from default reads with the same meaning on both sides.
    let hidden = cli.cli_err(&["ledger", "entry", "show", a_id, "--format", "json"]);
    let mcp_hidden = mcp.mcp_err("ledger_entry_get", json!({"id":b_id})).await;
    assert_eq!(hidden.0, 4);
    same_error(&hidden, &mcp_hidden, "not_found");
    let recovered = mcp
        .mcp(
            "ledger_entry_get",
            json!({"id":b_id,"include_archived":true}),
        )
        .await;
    assert_eq!(entry(&recovered)["id"], b_id, "{recovered}");
    for (flags, input) in [
        (vec![], json!({})),
        (vec!["--include-archived"], json!({"include_archived":true})),
        (
            vec!["--include-archived", "--content", "dinner"],
            json!({"include_archived":true,"content":"dinner"}),
        ),
        (
            vec!["--include-archived", "--offset", "1"],
            json!({"include_archived":true,"offset":1}),
        ),
    ] {
        let mut args = vec!["ledger", "entry", "list", "--format", "json"];
        args.extend(flags.iter());
        let a = cli.cli(&args);
        let b = mcp.mcp("ledger_entry_list", input.clone()).await;
        assert_eq!(
            provenance(&page(&a, entry), CLI),
            provenance(&page(&b, entry), MCP),
            "{input}"
        );
        // Same home, both readers.
        assert_eq!(page(&mcp.cli(&args), entry), page(&b, entry), "{input}");
    }

    let a = cli.cli(&["ledger", "entry", "restore", a_id]);
    let b = mcp.mcp("ledger_entry_restore", json!({"id":b_id})).await;
    assert_eq!(provenance(&entry(&a), CLI), provenance(&entry(&b), MCP));
    assert_eq!(
        entry(&cli.cli(&["ledger", "entry", "show", a_id, "--format", "json"])),
        entry(&cli.mcp("ledger_entry_get", json!({"id":a_id})).await)
    );

    // Audit: CLI `next` and MCP `next_offset` carry the same page cursor.
    for (offset, limit) in [(0, 100), (0, 2), (2, 2), (4, 2)] {
        let page = |home: &Home, id: &str| {
            home.cli(&[
                "ledger",
                "audit",
                "--record-type",
                "entry",
                "--record-id",
                id,
                "--offset",
                &offset.to_string(),
                "--limit",
                &limit.to_string(),
                "--format",
                "json",
            ])
        };
        let a = page(&cli, a_id);
        let b = mcp
            .mcp(
                "ledger_audit",
                json!({"record_type":"entry","id":b_id,"offset":offset,"limit":limit}),
            )
            .await;
        assert_eq!(provenance(&a["items"], CLI), provenance(&b["items"], MCP));
        assert_eq!(a["next"], b["next_offset"], "{offset}/{limit}");
        // Same home through both readers.
        let same = page(&mcp, b_id);
        assert_eq!(same["items"], b["items"]);
        assert_eq!(same["next"], b["next_offset"]);
    }
    let all = mcp
        .mcp("ledger_audit", json!({"record_type":"entry","id":b_id}))
        .await;
    let actions: Vec<_> = all["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| event["action"].as_str().unwrap())
        .collect();
    assert_eq!(actions, ["create", "update", "archive", "restore"]);
}

fn transfer(amount: &str) -> Value {
    json!({"operation_key":KEY,"date":"2026-10-03","amount":amount,"currency":"KRW","from_account":"Wallet","to_account":"Bank","content":"Move"})
}

#[tokio::test]
async fn transfer_create_replay_conflict_update_and_audit_agree() {
    let (cli, mcp) = (seeded().await, seeded().await);
    let a = cli.cli(&["ledger", "transfer", "--json", &transfer("10").to_string()]);
    let b = mcp.mcp("ledger_transfer_create", transfer("10")).await;
    assert_eq!(normalize(&a), normalize(&b));
    // Same operation_key and payload replays the original result without a new write.
    assert_eq!(
        cli.cli(&["ledger", "transfer", "--json", &transfer("10").to_string()]),
        a
    );
    assert_eq!(mcp.mcp("ledger_transfer_create", transfer("10")).await, b);
    // Same key with a different payload is a conflict, not a second transfer.
    let conflict = cli.cli_err(&["ledger", "transfer", "--json", &transfer("11").to_string()]);
    let mcp_conflict = mcp.mcp_err("ledger_transfer_create", transfer("11")).await;
    assert_eq!(conflict.0, 2);
    same_error(&conflict, &mcp_conflict, "conflict");
    for home in [&cli, &mcp] {
        let list = home.cli(&["ledger", "entry", "list", "--format", "json"]);
        assert_eq!(list["items"].as_array().unwrap().len(), 2, "{list}");
    }

    let (a_group, b_group) = (
        a["transfer_group_id"].as_str().unwrap(),
        b["transfer_group_id"].as_str().unwrap(),
    );
    let shown = cli.cli(&["ledger", "transfer-show", a_group, "--format", "json"]);
    let got = mcp.mcp("ledger_transfer_get", json!({"id":b_group})).await;
    assert_eq!(
        provenance(&transfer_view(&shown), CLI),
        provenance(&transfer_view(&got), MCP)
    );
    assert_eq!(
        transfer_view(&mcp.cli(&["ledger", "transfer-show", b_group, "--format", "json"])),
        transfer_view(&got)
    );

    let mut update = transfer("15");
    update.as_object_mut().unwrap().remove("operation_key");
    update["content"] = json!("Move more");
    let a = cli.cli(&[
        "ledger",
        "transfer-update",
        a_group,
        "--json",
        &update.to_string(),
    ]);
    let mut input = update.clone();
    input["id"] = json!(b_group);
    let b = mcp.mcp("ledger_transfer_update", input).await;
    assert_eq!(
        provenance(&transfer_view(&a), CLI),
        provenance(&transfer_view(&b), MCP)
    );

    // Archiving one side archives the pair.
    let a_out = transfer_view(&a)["out_entry"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let b_out = transfer_view(&b)["out_entry"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    cli.cli(&["ledger", "entry", "archive", &a_out]);
    mcp.mcp("ledger_entry_archive", json!({"id":b_out})).await;
    for home in [&cli, &mcp] {
        let list = home.cli(&[
            "ledger",
            "entry",
            "list",
            "--include-archived",
            "--format",
            "json",
        ]);
        assert!(
            list["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|e| e["deleted_at"].is_string())
        );
    }

    // Transfer history lives under record_type=transfer keyed by the group id.
    let a = cli.cli(&[
        "ledger",
        "audit",
        "--record-type",
        "transfer",
        "--record-id",
        a_group,
        "--format",
        "json",
    ]);
    let b = mcp
        .mcp(
            "ledger_audit",
            json!({"record_type":"transfer","id":b_group}),
        )
        .await;
    let actions: Vec<_> = b["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| event["action"].as_str().unwrap())
        .collect();
    assert_eq!(actions, ["create", "update", "archive"], "{b}");
    assert_eq!(
        normalize(&a["items"]).as_array().unwrap().len(),
        normalize(&b["items"]).as_array().unwrap().len()
    );
    assert_eq!(
        provenance(&a["items"][0], CLI),
        provenance(&b["items"][0], MCP)
    );
}

#[tokio::test]
async fn account_category_purge_preview_and_confirm_agree() {
    let (cli, mcp) = (seeded().await, seeded().await);
    let spare = |home: &Home| {
        home.cli(&["ledger", "account-category", "create", "--name", "Spare"])["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let (a_id, b_id) = (spare(&cli), spare(&mcp));
    // CLI preview prints the confirmation on stdout and exits 2 (confirmation_mismatch) so a
    // script cannot mistake a preview for a purge; MCP preview is a successful read.
    let (code, a, error) = cli.cli_raw(&["ledger", "account-category", "purge", &a_id]);
    assert_eq!(code, 2);
    assert_eq!(error["code"], "confirmation_mismatch");
    let b = mcp
        .mcp("ledger_account_category_purge_preview", json!({"id":b_id}))
        .await;
    assert_eq!(normalize(&a), normalize(&b));
    let wrong = cli.cli_err(&[
        "ledger",
        "account-category",
        "purge",
        &a_id,
        "--confirm",
        "nope",
    ]);
    let mcp_wrong = mcp
        .mcp_err(
            "ledger_account_category_purge",
            json!({"id":b_id,"confirmation":"nope"}),
        )
        .await;
    assert_eq!(wrong.0, 2);
    // Documented: CLI keeps its specific code, HTTP/MCP report the validation class.
    assert_eq!(wrong.1["code"], "confirmation_mismatch");
    assert_eq!(mcp_wrong["code"], "validation_error");
    let a = cli.cli(&[
        "ledger",
        "account-category",
        "purge",
        &a_id,
        "--confirm",
        a["confirmation_id"].as_str().unwrap(),
    ]);
    let b = mcp
        .mcp(
            "ledger_account_category_purge",
            json!({"id":b_id,"confirmation":b["confirmation_id"]}),
        )
        .await;
    // Documented envelope: CLI {"purged":true,"id"}; HTTP 204 surfaces as MCP {"ok":true}.
    assert_eq!(a, json!({"purged":true,"id":a_id}));
    assert_eq!(b, json!({"ok":true}));
    for home in [&cli, &mcp] {
        let list = home.cli(&["ledger", "account-category", "list", "--format", "json"]);
        assert_eq!(list["items"].as_array().unwrap().len(), 1, "{list}");
    }
    // Referenced categories are refused by both adapters.
    let cash = |home: &Home| {
        home.cli(&["ledger", "account-category", "list", "--format", "json"])["items"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let (a_cash, b_cash) = (cash(&cli), cash(&mcp));
    let a = cli.cli_err(&["ledger", "account-category", "purge", &a_cash]);
    let b = mcp
        .mcp_err(
            "ledger_account_category_purge_preview",
            json!({"id":b_cash}),
        )
        .await;
    same_error(&a, &b, "conflict");
}

#[tokio::test]
async fn balances_and_reports_agree_on_one_home() {
    let home = seeded().await;
    home.cli(&[
        "ledger",
        "entry",
        "add",
        "--json",
        &entry_input().to_string(),
    ]);
    home.cli(&[
        "ledger",
        "entry",
        "add",
        "--date",
        "2026-10-05",
        "--type",
        "income",
        "--amount",
        "500",
        "--currency",
        "KRW",
        "--account",
        "Bank",
        "--category",
        "Salary",
        "--content",
        "Pay",
    ]);
    home.cli(&["ledger", "transfer", "--json", &transfer("10").to_string()]);
    let pairs = [
        (vec!["ledger", "balances"], "ledger_balances", json!({})),
        (
            vec!["ledger", "balances", "--limit", "1"],
            "ledger_balances",
            json!({"limit":1}),
        ),
        (
            vec!["ledger", "balances", "--offset", "9"],
            "ledger_balances",
            json!({"offset":9}),
        ),
        (
            vec![
                "ledger",
                "reports",
                "--from",
                "2026-10-01",
                "--to",
                "2026-10-31",
            ],
            "ledger_report_summary",
            json!({"from":"2026-10-01","to":"2026-10-31"}),
        ),
        (
            vec![
                "ledger",
                "reports",
                "--from",
                "2026-10-01",
                "--to",
                "2026-10-31",
                "--by",
                "category",
            ],
            "ledger_report_categories",
            json!({"from":"2026-10-01","to":"2026-10-31"}),
        ),
        (
            vec![
                "ledger",
                "compare",
                "--from",
                "2026-10-01",
                "--to",
                "2026-10-31",
            ],
            "ledger_report_compare",
            json!({"period":"custom","from":"2026-10-01","to":"2026-10-31"}),
        ),
    ];
    for (args, tool, input) in pairs {
        let mut args = args.clone();
        args.extend(["--format", "json"]);
        let a = home.cli(&args);
        let b = home.mcp(tool, input.clone()).await;
        let (a, b) = if tool == "ledger_balances" {
            (page(&a, balance), page(&b, balance))
        } else if tool == "ledger_report_compare" {
            // MCP adds a per-currency `currencies` delta list next to current/previous.
            assert!(b["currencies"].is_array());
            (
                report(&json!([a["current"], a["previous"]])),
                report(&json!([b["current"], b["previous"]])),
            )
        } else {
            (report(&a), report(&b))
        };
        assert_eq!(a, b, "{args:?} vs {tool} {input}");
    }
}

#[tokio::test]
async fn ledger_errors_have_the_same_meaning() {
    let home = seeded().await;
    // Invalid input: expense without category, and a non-decimal amount.
    let mut missing = entry_input();
    missing.as_object_mut().unwrap().remove("category");
    let mut bad_amount = entry_input();
    bad_amount["amount"] = json!("12x");
    for input in [missing, bad_amount] {
        let a = home.cli_err(&["ledger", "entry", "add", "--json", &input.to_string()]);
        let b = home.mcp_err("ledger_entry_create", input.clone()).await;
        assert_eq!(a.0, 2, "{input}");
        same_error(&a, &b, "validation_error");
    }
    // Unknown id.
    let unknown = "00000000-0000-4000-8000-000000000000";
    let a = home.cli_err(&["ledger", "entry", "show", unknown, "--format", "json"]);
    let b = home
        .mcp_err("ledger_entry_get", json!({"id":unknown}))
        .await;
    same_error(&a, &b, "not_found");
    let a = home.cli_err(&["ledger", "entry", "archive", unknown]);
    let b = home
        .mcp_err("ledger_entry_archive", json!({"id":unknown}))
        .await;
    same_error(&a, &b, "not_found");
    // Inactive master data cannot receive new entries.
    let wallet = home.cli(&["ledger", "account", "list", "--format", "json"])["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|account| account["name"] == "Wallet")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    home.cli(&["ledger", "account", "update", &wallet, "--active", "false"]);
    let a = home.cli_err(&[
        "ledger",
        "entry",
        "add",
        "--json",
        &entry_input().to_string(),
    ]);
    let b = home.mcp_err("ledger_entry_create", entry_input()).await;
    // Inactive references do not resolve for new writes on either adapter.
    assert_eq!(a.0, 4);
    same_error(&a, &b, "not_found");
    // Inactive masters are listed only on request, identically.
    for (flags, input) in [
        (vec![], json!({})),
        (vec!["--include-inactive"], json!({"include_inactive":true})),
    ] {
        let mut args = vec!["ledger", "account", "list", "--format", "json"];
        args.extend(flags.iter());
        assert_eq!(
            page(&home.cli(&args), account),
            page(&home.mcp("ledger_account_list", input).await, account)
        );
    }
    // Pagination past the end is an empty final page, not an error.
    let a = home.cli(&[
        "ledger", "entry", "list", "--offset", "50", "--format", "json",
    ]);
    let b = home.mcp("ledger_entry_list", json!({"offset":50})).await;
    assert_eq!(page(&a, entry), page(&b, entry));
    assert!(a["items"].as_array().unwrap().is_empty());
}
