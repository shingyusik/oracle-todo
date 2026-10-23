//! Health CLI ⇄ MCP contract (SHI-456).
#[path = "support/contract.rs"]
mod contract;

use contract::{Home, normalize, same_error};
use serde_json::{Value, json};

/// Audit events name the writing adapter; check it, then blank it for comparison.
fn provenance(value: &Value, actor: &str) -> Value {
    let mut value = normalize(value);
    for event in value["items"].as_array_mut().unwrap() {
        // Archive/restore are attributed to the service ("local") on every adapter.
        if event["actor"] != "local" {
            assert_eq!(event["actor"], actor, "{event}");
            event["actor"] = json!("<adapter>");
        }
    }
    value
}

/// Documented mismatch, kept for compatibility: HTTP/MCP `health_audit` serializes event
/// `occurred_at` with the serde default for `time::OffsetDateTime`
/// (`[year, ordinal, hour, minute, second, nanosecond, offset_h, offset_m, offset_s]`); the
/// CLI prints RFC 3339. Decode the tuple so both encode-the-same-instant can be compared.
fn rfc3339_audit_times(page: &Value) -> Value {
    let mut page = page.clone();
    for event in page["items"].as_array_mut().unwrap() {
        if let Some(parts) = event["occurred_at"].as_array() {
            let n: Vec<i64> = parts.iter().map(|part| part.as_i64().unwrap()).collect();
            let [year, day, hour, minute, second, nanos, oh, om, os] = n[..] else {
                panic!("unexpected tuple {parts:?}");
            };
            let at = time::PrimitiveDateTime::new(
                time::Date::from_ordinal_date(year as i32, day as u16).unwrap(),
                time::Time::from_hms_nano(hour as u8, minute as u8, second as u8, nanos as u32)
                    .unwrap(),
            )
            .assume_offset(time::UtcOffset::from_hms(oh as i8, om as i8, os as i8).unwrap());
            event["occurred_at"] = json!(
                at.format(&time::format_description::well_known::Rfc3339)
                    .unwrap()
            );
        }
    }
    page
}

/// Documented envelope difference: CLI pages use `next`, HTTP/MCP pages use `next_offset`.
fn cursor(page: &Value) -> &Value {
    page.get("next").unwrap_or(&page["next_offset"])
}

async fn audit_agrees(cli: &Home, mcp: &Home, record_type: &str, a_id: &str, b_id: &str) {
    for (offset, limit) in [(0, 100), (0, 1), (1, 1), (2, 1), (3, 1), (9, 1)] {
        let (offset, limit) = (offset.to_string(), limit.to_string());
        let args = |id: &str| {
            [
                "health",
                "audit",
                record_type,
                id,
                "--offset",
                &offset,
                "--limit",
                &limit,
                "--format",
                "json",
            ]
            .map(str::to_owned)
        };
        let a = cli.cli(&args(a_id).each_ref().map(String::as_str));
        let input = json!({"record_type":record_type,"id":b_id,"offset":offset.parse::<u32>().unwrap(),"limit":limit.parse::<u32>().unwrap()});
        let b = mcp.mcp("health_audit", input.clone()).await;
        assert!(
            b["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|e| e["occurred_at"].is_array())
        );
        let b_items = rfc3339_audit_times(&json!({"items":b["items"]}));
        assert_eq!(
            provenance(&json!({"items":a["items"]}), "raven-cli"),
            provenance(&b_items, "raven-api"),
            "{input}"
        );
        assert_eq!(cursor(&a), cursor(&b), "{input}");
        let same = mcp.cli(&args(b_id).each_ref().map(String::as_str));
        assert_eq!(
            rfc3339_audit_times(&json!({"items":same["items"]})),
            b_items,
            "{input}"
        );
    }
}

#[tokio::test]
async fn diet_lifecycle_and_audit_agree() {
    let (cli, mcp) = (Home::new().await, Home::new().await);
    let a = cli.cli(&[
        "health", "diet", "add", "--json",
        r#"{"at":"2026-10-02T12:00:00+09:00","meal":"lunch","food":"Rice","tags":["rice","grain"],"note":"warm"}"#,
    ]);
    let b = mcp
        .mcp(
            "health_diet_create",
            json!({"occurred_at":"2026-10-02T12:00:00+09:00","meal_type":"lunch","food_name":"Rice","tags":["rice","grain"],"note":"warm"}),
        )
        .await;
    assert_eq!(normalize(&a), normalize(&b));
    let (a_id, b_id) = (a["id"].as_str().unwrap(), b["id"].as_str().unwrap());

    let a = cli.cli(&[
        "health",
        "diet",
        "update",
        a_id,
        "--food",
        "Rice bowl",
        "--clear-note",
        "--expected-updated-at",
        a["updated_at"].as_str().unwrap(),
    ]);
    let b = mcp
        .mcp(
            "health_diet_update",
            json!({"id":b_id,"food_name":"Rice bowl","note":null,"expected_updated_at":b["updated_at"]}),
        )
        .await;
    assert_eq!(normalize(&a), normalize(&b));

    let a = cli.cli(&[
        "health",
        "diet",
        "archive",
        a_id,
        "--expected-updated-at",
        a["updated_at"].as_str().unwrap(),
    ]);
    let b = mcp
        .mcp(
            "health_diet_archive",
            json!({"id":b_id,"expected_updated_at":b["updated_at"]}),
        )
        .await;
    assert_eq!(normalize(&a), normalize(&b));
    assert!(a["deleted_at"].is_string());

    // Documented difference: CLI `show` returns archived versions directly; MCP requires
    // include_archived=true and otherwise reports not_found.
    let shown = cli.cli(&["health", "diet", "show", a_id, "--format", "json"]);
    assert_eq!(shown, a);
    let hidden = mcp.mcp_err("health_diet_get", json!({"id":b_id})).await;
    assert_eq!(hidden["code"], "not_found");
    let got = mcp
        .mcp(
            "health_diet_get",
            json!({"id":b_id,"include_archived":true}),
        )
        .await;
    assert_eq!(normalize(&got), normalize(&shown));
    // Archived rows leave the default list on both sides.
    let list = mcp.cli(&["health", "diet", "list", "--format", "json"]);
    assert_eq!(list, json!({"items":[],"next":null}));

    let a = cli.cli(&[
        "health",
        "diet",
        "restore",
        a_id,
        "--expected-updated-at",
        a["updated_at"].as_str().unwrap(),
    ]);
    let b = mcp
        .mcp(
            "health_diet_restore",
            json!({"id":b_id,"expected_updated_at":b["updated_at"]}),
        )
        .await;
    assert_eq!(normalize(&a), normalize(&b));
    audit_agrees(&cli, &mcp, "diet_entry", a_id, b_id).await;
}

#[tokio::test]
async fn bowel_and_medication_events_agree() {
    let (cli, mcp) = (Home::new().await, Home::new().await);
    for (args, tool, input, update_args, update) in [
        (
            vec![
                "health",
                "bowel",
                "add",
                "--at",
                "2026-10-02T08:00:00+09:00",
                "--bristol",
                "4",
                "--blood-visible",
            ],
            "health_bowel_create",
            json!({"occurred_at":"2026-10-02T08:00:00+09:00","details":{"kind":"bowel","bristol_scale":4,"blood_visible":true}}),
            vec![
                "health",
                "bowel",
                "update",
                "--bristol",
                "5",
                "--note",
                "after lunch",
            ],
            json!({"details":{"kind":"bowel","bristol_scale":5,"blood_visible":true},"note":"after lunch"}),
        ),
        (
            vec![
                "health",
                "medication",
                "add",
                "--at",
                "2026-10-02T09:00:00+09:00",
                "--name",
                "Vitamin D",
                "--dose",
                "2",
                "--unit",
                "tablet",
            ],
            "health_medication_create",
            json!({"occurred_at":"2026-10-02T09:00:00+09:00","details":{"kind":"medication","medication_name":"Vitamin D","dose":2,"unit":"tablet"}}),
            vec!["health", "medication", "update", "--dose", "1"],
            json!({"details":{"kind":"medication","medication_name":"Vitamin D","dose":1,"unit":"tablet"}}),
        ),
    ] {
        let a = cli.cli(&args);
        let b = mcp.mcp(tool, input).await;
        assert_eq!(normalize(&a), normalize(&b), "{args:?}");
        let (a_id, b_id) = (a["id"].as_str().unwrap(), b["id"].as_str().unwrap());
        let mut cli_update = update_args.clone();
        cli_update.insert(3, a_id);
        cli_update.extend(["--expected-updated-at", a["updated_at"].as_str().unwrap()]);
        let a = cli.cli(&cli_update);
        let mut input = update;
        input["id"] = json!(b_id);
        input["expected_updated_at"] = b["updated_at"].clone();
        let tool = tool.replace("_create", "_update");
        let b = mcp.mcp(&tool, input).await;
        assert_eq!(normalize(&a), normalize(&b), "{cli_update:?}");
        let kind = args[1];
        let a = cli.cli(&[
            "health",
            kind,
            "archive",
            a_id,
            "--expected-updated-at",
            a["updated_at"].as_str().unwrap(),
        ]);
        let b = mcp
            .mcp(
                "health_event_archive",
                json!({"id":b_id,"expected_updated_at":b["updated_at"]}),
            )
            .await;
        assert_eq!(normalize(&a), normalize(&b), "{kind} archive");
        let a = cli.cli(&[
            "health",
            kind,
            "restore",
            a_id,
            "--expected-updated-at",
            a["updated_at"].as_str().unwrap(),
        ]);
        let b = mcp
            .mcp(
                "health_event_restore",
                json!({"id":b_id,"expected_updated_at":b["updated_at"]}),
            )
            .await;
        assert_eq!(normalize(&a), normalize(&b), "{kind} restore");
        assert_eq!(
            mcp.cli(&["health", kind, "show", b_id, "--format", "json"]),
            mcp.mcp("health_event_get", json!({"id":b_id})).await
        );
        audit_agrees(&cli, &mcp, "health_event", a_id, b_id).await;
    }
    // A kind-specific update tool cannot edit the other kind.
    let bowel = mcp.cli(&["health", "bowel", "list", "--format", "json"])["items"][0].clone();
    let wrong = mcp
        .mcp_err(
            "health_medication_update",
            json!({"id":bowel["id"],"expected_updated_at":bowel["updated_at"],"note":"x"}),
        )
        .await;
    assert_eq!(wrong["code"], "validation_error");
}

#[tokio::test]
async fn daily_metrics_and_reports_agree() {
    let (cli, mcp) = (Home::new().await, Home::new().await);
    let a = cli.cli(&[
        "health", "metric", "daily-upsert", "--json",
        r#"[{"at":"2026-10-02T07:00:00+09:00","category":"weight","value":70.5},{"at":"2026-10-02T07:00:00+09:00","category":"lab","key":"crp","name":"CRP","value":1.2,"unit":"mg/L"}]"#,
    ]);
    let b = mcp
        .mcp(
            "health_daily_upsert",
            json!({"metrics":[
                {"occurred_at":"2026-10-02T07:00:00+09:00","details":{"kind":"weight","value":70.5,"unit":"kg"}},
                {"occurred_at":"2026-10-02T07:00:00+09:00","details":{"kind":"lab","key":"crp","name":"CRP","value":1.2,"unit":"mg/L"}}
            ]}),
        )
        .await;
    let a_items = a.get("items").unwrap_or(&a);
    assert_eq!(normalize(a_items), normalize(&b["items"]));
    // Same-day upsert updates the existing row on both adapters.
    let weight = |items: &Value| {
        items
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["metric_key"] == "body_weight")
            .unwrap()
            .clone()
    };
    let (a_weight, b_weight) = (weight(a_items), weight(&b["items"]));
    let a2 = cli.cli(&[
        "health", "metric", "daily-upsert", "--json",
        &json!([{"at":"2026-10-02T20:00:00+09:00","category":"weight","value":71,"expected_updated_at":a_weight["updated_at"]}]).to_string(),
    ]);
    let b2 = mcp
        .mcp(
            "health_daily_upsert",
            json!({"metrics":[{"occurred_at":"2026-10-02T20:00:00+09:00","details":{"kind":"weight","value":71,"unit":"kg"},"expected_updated_at":b_weight["updated_at"]}]}),
        )
        .await;
    let a2 = a2.get("items").unwrap_or(&a2);
    assert_eq!(normalize(a2), normalize(&b2["items"]));
    assert_eq!(a2[0]["id"], a_weight["id"]);
    // A stale version is a conflict on both sides.
    let stale = cli.cli_err(&[
        "health", "metric", "daily-upsert", "--json",
        &json!([{"at":"2026-10-02T07:00:00+09:00","category":"weight","value":72,"expected_updated_at":a_weight["updated_at"]}]).to_string(),
    ]);
    let mcp_stale = mcp
        .mcp_err(
            "health_daily_upsert",
            json!({"metrics":[{"occurred_at":"2026-10-02T07:00:00+09:00","details":{"kind":"weight","value":72,"unit":"kg"},"expected_updated_at":b_weight["updated_at"]}]}),
        )
        .await;
    same_error(&stale, &mcp_stale, "conflict");
    for (offset, limit) in [(0, 100), (0, 1), (1, 1), (2, 1)] {
        let a = cli.cli(&[
            "health",
            "metric",
            "list",
            "--offset",
            &offset.to_string(),
            "--limit",
            &limit.to_string(),
            "--format",
            "json",
        ]);
        let b = mcp
            .mcp(
                "health_event_list",
                json!({"metrics_only":true,"offset":offset,"limit":limit}),
            )
            .await;
        assert_eq!(
            normalize(&a["items"]),
            normalize(&b["items"]),
            "{offset}/{limit}"
        );
        // Documented: the CLI probes for an exact cursor; health_event_list may point at a
        // final empty page, which then returns next_offset null.
        if cursor(&a) != cursor(&b) {
            assert!(cursor(&a).is_null(), "{offset}/{limit}");
            let last = mcp
                .mcp(
                    "health_event_list",
                    json!({"metrics_only":true,"offset":cursor(&b),"limit":limit}),
                )
                .await;
            assert_eq!(last, json!({"items":[],"next_offset":null}));
        }
    }
    let a = mcp.cli(&[
        "health",
        "reports",
        "--from",
        "2026-10-01",
        "--to",
        "2026-10-31",
        "--format",
        "json",
    ]);
    let b = mcp
        .mcp(
            "health_reports",
            json!({"from":"2026-10-01","to":"2026-10-31"}),
        )
        .await;
    assert_eq!(a, b);
}

#[tokio::test]
async fn records_and_audit_pages_end_with_a_null_cursor() {
    let home = Home::new().await;
    for food in ["A", "B", "C"] {
        home.cli(&[
            "health",
            "diet",
            "add",
            "--at",
            "2026-10-02T12:00:00+09:00",
            "--meal",
            "lunch",
            "--food",
            food,
        ]);
    }
    // Follow next_offset from the first page until null; every record is seen once and
    // no request is needed past the last page.
    let mut seen = Vec::new();
    let mut offset = json!(0);
    while let Some(next) = offset.as_u64() {
        let page = home
            .mcp("health_records", json!({"offset":next,"limit":2}))
            .await;
        assert!(page.get("next_offset").is_some(), "{page}");
        let items = page["items"].as_array().unwrap();
        assert!(!items.is_empty(), "final empty page: {page}");
        seen.extend(items.iter().cloned());
        offset = page["next_offset"].clone();
    }
    assert_eq!(seen.len(), 3);
    let id = seen[0]["record"]["id"]
        .as_str()
        .unwrap_or_else(|| panic!("{}", seen[0]));
    let page = home
        .mcp(
            "health_audit",
            json!({"record_type":"diet_entry","id":id,"limit":1}),
        )
        .await;
    assert_eq!(page["next_offset"], Value::Null, "{page}");
    for name in ["health_records", "health_audit", "ledger_audit"] {
        let tool = home.tool(name).await;
        let description = tool["description"].as_str().unwrap();
        assert!(description.contains("next_offset"), "{name}: {description}");
    }
}

#[tokio::test]
async fn health_errors_have_the_same_meaning() {
    let home = Home::new().await;
    let unknown = "00000000-0000-4000-8000-000000000000";
    let a = home.cli_err(&["health", "diet", "show", unknown, "--format", "json"]);
    let b = home.mcp_err("health_diet_get", json!({"id":unknown})).await;
    assert_eq!(a.0, 4);
    same_error(&a, &b, "not_found");
    let a = home.cli_err(&["health", "bowel", "show", unknown, "--format", "json"]);
    let b = home
        .mcp_err("health_event_get", json!({"id":unknown}))
        .await;
    same_error(&a, &b, "not_found");
    // Invalid input: unsupported meal / out-of-range scale.
    let a = home.cli_err(&[
        "health",
        "diet",
        "add",
        "--json",
        r#"{"at":"2026-10-02T12:00:00+09:00","meal":"brunch","food":"x"}"#,
    ]);
    let b = home
        .mcp_err(
            "health_diet_create",
            json!({"occurred_at":"2026-10-02T12:00:00+09:00","meal_type":"brunch","food_name":"x"}),
        )
        .await;
    assert_eq!(a.0, 2);
    same_error(&a, &b, "validation_error");
    let a = home.cli_err(&[
        "health",
        "bowel",
        "add",
        "--at",
        "2026-10-02T08:00:00+09:00",
        "--bristol",
        "9",
    ]);
    let b = home
        .mcp_err(
            "health_bowel_create",
            json!({"occurred_at":"2026-10-02T08:00:00+09:00","details":{"kind":"bowel","bristol_scale":9}}),
        )
        .await;
    assert_eq!(a.0, 2);
    same_error(&a, &b, "validation_error");
    // Stale guarded edit.
    let diet = home.cli(&[
        "health",
        "diet",
        "add",
        "--at",
        "2026-10-02T12:00:00+09:00",
        "--meal",
        "lunch",
        "--food",
        "Original",
    ]);
    let id = diet["id"].as_str().unwrap();
    home.cli(&["health", "diet", "update", id, "--food", "Current"]);
    let a = home.cli_err(&[
        "health",
        "diet",
        "update",
        id,
        "--food",
        "Stale",
        "--expected-updated-at",
        diet["updated_at"].as_str().unwrap(),
    ]);
    let b = home
        .mcp_err(
            "health_diet_update",
            json!({"id":id,"food_name":"Stale","expected_updated_at":diet["updated_at"]}),
        )
        .await;
    same_error(&a, &b, "conflict");
    // Past-the-end list page.
    let a = home.cli(&[
        "health", "diet", "list", "--offset", "50", "--format", "json",
    ]);
    assert_eq!(a, json!({"items":[],"next":null}));
    let b = home.mcp("health_event_list", json!({"offset":50})).await;
    assert_eq!(b, json!({"items":[],"next_offset":null}));
}
