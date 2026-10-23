//! ToDo CLI ⇄ MCP contract (SHI-456).
#[path = "support/contract.rs"]
mod contract;

use contract::{Home, day, normalize, same_error};
use serde_json::{Value, json};

/// Active, scheduled, overdue, searchable and terminal items, created through the CLI.
fn seed(home: &Home) -> Value {
    let area = home.cli(&["todo", "area", "create", "Health"]);
    let area_id = area["id"].as_str().unwrap();
    let today = day(0);
    let overdue = day(-2);
    let dentist = home.cli(&[
        "todo",
        "task",
        "create",
        "Dentist checkup",
        "--area",
        area_id,
        "--scheduled",
        &today,
        "--priority",
        "3",
        "--tag",
        "care",
    ]);
    let late = home.cli(&[
        "todo",
        "task",
        "create",
        "Late report",
        "--scheduled",
        &overdue,
    ]);
    let done = home.cli(&["todo", "task", "create", "Done chore"]);
    home.cli(&["todo", "complete", done["id"].as_str().unwrap()]);
    let archived = home.cli(&["todo", "task", "create", "Old dentist note"]);
    home.cli(&["todo", "archive", archived["id"].as_str().unwrap()]);
    home.cli(&[
        "todo",
        "event",
        "create",
        "Standup",
        &format!("{today}T09:00:00Z"),
    ]);
    json!({"area":area,"dentist":dentist,"late":late,"done":done,"archived":archived})
}

#[tokio::test]
async fn list_pending_today_archive_and_filters_agree() {
    let home = Home::new().await;
    let fixture = seed(&home);
    let today = day(0);
    for (cli, mcp) in [
        (vec!["todo", "list"], json!({})),
        (
            vec!["todo", "list", "--include-archived"],
            json!({"include_archived":true}),
        ),
        (
            vec!["todo", "list", "--query", "dentist"],
            json!({"query":"dentist"}),
        ),
        (
            vec!["todo", "list", "--query", "dentist", "--include-archived"],
            json!({"query":"dentist","include_archived":true}),
        ),
        (
            vec!["todo", "list", "--type", "event"],
            json!({"type":"event"}),
        ),
        (
            vec!["todo", "list", "--status", "completed"],
            json!({"status":"completed"}),
        ),
        (
            vec![
                "todo",
                "list",
                "--area-id",
                fixture["area"]["id"].as_str().unwrap(),
            ],
            json!({"area_id":fixture["area"]["id"]}),
        ),
        (vec!["todo", "pending"], json!({"status":"active"})),
        (
            vec!["todo", "today"],
            json!({"scope":"today","today":today}),
        ),
        (vec!["todo", "archive-list"], json!({"scope":"archive"})),
        (vec!["todo", "list", "--limit", "2"], json!({"limit":2})),
        (
            vec!["todo", "list", "--limit", "2", "--offset", "4"],
            json!({"limit":2,"offset":4}),
        ),
        (vec!["todo", "list", "--offset", "99"], json!({"offset":99})),
    ] {
        let mut args = cli.clone();
        args.extend(["--format", "json"]);
        let cli_page = home.cli(&args);
        let mcp_page = home.mcp("todo_list", mcp.clone()).await;
        assert_eq!(cli_page, mcp_page, "{cli:?} vs {mcp}");
    }
    // Spot-check that the filters are meaningful, not vacuously equal.
    let dentist = home.mcp("todo_list", json!({"query":"dentist"})).await;
    assert_eq!(dentist["items"].as_array().unwrap().len(), 1);
    let with_archived = home
        .mcp(
            "todo_list",
            json!({"query":"dentist","include_archived":true}),
        )
        .await;
    assert_eq!(with_archived["items"].as_array().unwrap().len(), 2);
    let paged = home.mcp("todo_list", json!({"limit":2})).await;
    assert_eq!(paged["next"], 2);
    let end = home.mcp("todo_list", json!({"offset":99})).await;
    assert_eq!(end, json!({"items":[],"next":null}));
    // The archive search tool reads the same terminal page as archive-list.
    let archive = home.mcp("todo_archive_search", json!({})).await;
    let cli_archive = home.cli(&["todo", "archive-list", "--format", "json"]);
    assert_eq!(archive["items"], cli_archive["items"]);
    let id = fixture["dentist"]["id"].as_str().unwrap();
    assert_eq!(
        home.cli(&["todo", "show", id]),
        home.mcp("todo_get", json!({"id":id})).await
    );
}

#[tokio::test]
async fn create_results_actor_and_history_agree() {
    let cli = Home::new().await;
    let mcp = Home::new().await;
    for (args, tool, input) in [
        (
            vec![
                "todo",
                "task",
                "create",
                "Agent task",
                "--priority",
                "4",
                "--tag",
                "x",
            ],
            "todo_task_create",
            json!({"title":"Agent task","priority":4,"tags":["x"]}),
        ),
        (
            vec!["todo", "task", "create", "User task", "--actor", "user"],
            "todo_task_create",
            json!({"title":"User task","actor":"user"}),
        ),
        (
            vec![
                "todo",
                "project",
                "create",
                "Ship",
                "--definition-of-done",
                "Shipped",
            ],
            "todo_project_create",
            json!({"title":"Ship","definition_of_done":"Shipped"}),
        ),
    ] {
        let from_cli = cli.cli(&args);
        let from_mcp = mcp.mcp(tool, input).await;
        assert_eq!(normalize(&from_cli), normalize(&from_mcp), "{args:?}");
        // History is read through MCP for both homes: CLI has no history reader.
        let cli_history = cli.mcp("todo_history", json!({"id":from_cli["id"]})).await;
        let mcp_history = mcp.mcp("todo_history", json!({"id":from_mcp["id"]})).await;
        assert_eq!(normalize(&cli_history), normalize(&mcp_history), "{args:?}");
        let event = &cli_history["items"][0];
        assert_eq!(event["actor"], from_cli["proposed_by"], "{cli_history}");
    }
    let agent = mcp.mcp("todo_list", json!({"query":"Agent task"})).await;
    assert_eq!(agent["items"][0]["proposed_by"], "agent");
    let user = mcp.mcp("todo_list", json!({"query":"User task"})).await;
    assert_eq!(user["items"][0]["proposed_by"], "user");
}

/// Run the same postpone on two identically seeded homes; returns (CLI, MCP) outcomes.
async fn postpone_both(
    scheduled: Option<String>,
    source: &str,
) -> (
    Home,
    Home,
    Result<Value, (i32, Value)>,
    Result<Value, Value>,
) {
    let cli = Home::new().await;
    let mcp = Home::new().await;
    let seeded_cli = seed(&cli);
    let seeded_mcp = seed(&mcp);
    let cli_id = seeded_cli[source]["id"].as_str().unwrap().to_owned();
    let mut args = vec!["todo", "postpone", cli_id.as_str()];
    if let Some(date) = scheduled.as_deref() {
        args.extend(["--scheduled", date]);
    }
    let (code, out) = contract::raven(&cli.path, &args);
    let cli_result = if code == 0 {
        Ok(serde_json::from_str(&out).unwrap())
    } else {
        Err((code, serde_json::from_str(out.trim()).unwrap()))
    };
    let input = json!({
        "id": seeded_mcp[source]["id"],
        "action": "postpone",
        "today": day(0),
        // MCP has no clock default: the caller sends tomorrow explicitly.
        "scheduled": scheduled.unwrap_or_else(|| day(1)),
    });
    let result = mcp.call("todo_transition", input).await;
    let mcp_result = if result["isError"] == false {
        Ok(result["structuredContent"].clone())
    } else {
        Err(result["structuredContent"].clone())
    };
    (cli, mcp, cli_result, mcp_result)
}

async fn same_store(cli: &Home, mcp: &Home) {
    let all = json!({"include_archived":true});
    let left = cli.mcp("todo_list", all.clone()).await;
    let right = mcp.mcp("todo_list", all).await;
    assert_eq!(normalize(&left), normalize(&right));
    for (l, r) in left["items"]
        .as_array()
        .unwrap()
        .iter()
        .zip(right["items"].as_array().unwrap())
    {
        let lh = cli.mcp("todo_history", json!({"id":l["id"]})).await;
        let rh = mcp.mcp("todo_history", json!({"id":r["id"]})).await;
        assert_eq!(normalize(&lh), normalize(&rh), "history of {}", l["title"]);
    }
}

#[tokio::test]
async fn postpone_success_paths_agree() {
    for (scheduled, source, follow_up_date) in [
        (None, "dentist", day(1)),
        (Some(day(3)), "dentist", day(3)),
        // Overdue sources may move to today.
        (Some(day(0)), "late", day(0)),
    ] {
        let (cli, mcp, cli_result, mcp_result) = postpone_both(scheduled.clone(), source).await;
        let (cli_result, mcp_result) = (cli_result.unwrap(), mcp_result.unwrap());
        assert_eq!(
            normalize(&cli_result),
            normalize(&mcp_result),
            "{scheduled:?}"
        );
        assert_eq!(cli_result["source"]["status"], "missed");
        assert_eq!(cli_result["follow_up"]["status"], "active");
        assert_eq!(cli_result["follow_up"]["scheduled"], follow_up_date);
        same_store(&cli, &mcp).await;
    }
}

#[tokio::test]
async fn postpone_rejections_agree_and_are_atomic() {
    // Policy rejections keep the CLI's TodoError::api_code ("policy_error"); the HTTP/MCP
    // adapter folds every 400 class into "validation_error". Documented, not changed: both
    // codes are existing public contracts with the same meaning (exit 2 / HTTP 400, nothing
    // committed).
    for (scheduled, source, cli_code) in [
        // Not overdue: today is not a valid target.
        (Some(day(0)), "dentist", "validation_error"),
        (Some(day(-1)), "late", "validation_error"),
        (Some("2026-13-40".to_owned()), "dentist", "validation_error"),
        // Terminal source.
        (Some(day(1)), "done", "policy_error"),
        // Wrong type: areas cannot be postponed.
        (Some(day(1)), "area", "policy_error"),
    ] {
        let (cli, mcp, cli_result, mcp_result) = postpone_both(scheduled.clone(), source).await;
        let cli_error = cli_result.expect_err("CLI accepted invalid postpone");
        let mcp_error = mcp_result.expect_err("MCP accepted invalid postpone");
        assert_eq!(cli_error.0, 2, "{scheduled:?} {source}");
        assert_eq!(cli_error.1["code"], cli_code, "{scheduled:?} {source}");
        assert_eq!(cli_error.1["committed"], false);
        assert_eq!(
            mcp_error["code"], "validation_error",
            "{scheduled:?} {source}"
        );
        // Atomic: neither adapter left a follow-up or a changed source behind.
        for home in [&cli, &mcp] {
            let all = home
                .mcp("todo_list", json!({"include_archived":true}))
                .await;
            assert_eq!(all["items"].as_array().unwrap().len(), 6, "{all}");
            assert!(
                all["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|item| item["status"] != "missed")
            );
        }
        same_store(&cli, &mcp).await;
    }
    let (_cli, _mcp, cli_result, mcp_result) = {
        let cli = Home::new().await;
        let mcp = Home::new().await;
        let cli_result = cli.cli_err(&["todo", "postpone", "task_000000000000"]);
        let mcp_result = mcp
            .mcp_err(
                "todo_transition",
                json!({"id":"task_000000000000","action":"postpone","today":day(0),"scheduled":day(1)}),
            )
            .await;
        (cli, mcp, cli_result, mcp_result)
    };
    assert_eq!(cli_result.0, 4);
    same_error(&cli_result, &mcp_result, "not_found");
}

#[tokio::test]
async fn routine_postpone_splits_follow_up_and_backfills_the_same_way() {
    let cli = Home::new().await;
    let mcp = Home::new().await;
    for home in [&cli, &mcp] {
        home.cli(&[
            "todo",
            "routine",
            "create",
            "Daily walk",
            "--recurrence-rule",
            "RRULE:FREQ=DAILY",
            "--future-occurrences",
            "2",
        ]);
        home.cli(&["todo", "routine", "materialize"]);
    }
    let pick = |home: &Home| {
        let page = home.cli(&[
            "todo", "list", "--type", "task", "--status", "active", "--format", "json",
        ]);
        page["items"][0].clone()
    };
    let (cli_task, mcp_task) = (pick(&cli), pick(&mcp));
    assert!(cli_task["routine_id"].is_string(), "{cli_task}");
    let scheduled = mcp_task["scheduled"].as_str().unwrap().to_owned();
    let target = (time::Date::parse(
        &scheduled,
        &time::format_description::well_known::Iso8601::DATE,
    )
    .unwrap()
        + time::Duration::days(5))
    .to_string();
    let from_cli = cli.cli(&[
        "todo",
        "postpone",
        cli_task["id"].as_str().unwrap(),
        "--scheduled",
        &target,
    ]);
    let from_mcp = mcp
        .mcp(
            "todo_transition",
            json!({"id":mcp_task["id"],"action":"postpone","today":day(0),"scheduled":target}),
        )
        .await;
    assert_eq!(normalize(&from_cli), normalize(&from_mcp));
    assert!(from_cli["follow_up"]["routine_id"].is_null());
    assert!(from_cli["follow_up"]["occurrence_key"].is_null());
    assert_eq!(
        from_cli["follow_up"]["metadata_"]["postponed_from"],
        cli_task["id"]
    );
    // Backfill: materializing again keeps the missed occurrence and refills the series.
    // Envelope differs by adapter (documented): CLI prints the created array, MCP wraps it
    // as {"created": [...]} like the HTTP route.
    let cli_more = cli.cli(&["todo", "routine", "materialize"]);
    let mcp_more = mcp.mcp("todo_routines_materialize", json!({})).await;
    assert_eq!(normalize(&cli_more), normalize(&mcp_more["created"]));
    let routine = |home: &Home| {
        home.cli(&["todo", "list", "--type", "routine", "--format", "json"])["items"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let cli_one = cli.cli(&[
        "todo",
        "routine",
        "materialize",
        &routine(&cli),
        "--future-occurrences",
        "4",
    ]);
    let mcp_one = mcp
        .mcp(
            "todo_routine_materialize",
            json!({"id":routine(&mcp),"future_occurrences":4}),
        )
        .await;
    // Single-routine MCP results also carry the updated routine (documented envelope).
    assert_eq!(normalize(&cli_one), normalize(&mcp_one["created"]));
    assert_eq!(mcp_one["routine"]["future_occurrences"], 4);
    same_store(&cli, &mcp).await;
}

#[tokio::test]
async fn transition_discovery_states_conditional_postpone_inputs() {
    let home = Home::new().await;
    let tool = home.tool("todo_transition").await;
    let schema = &tool["inputSchema"];
    assert_eq!(
        schema["required"],
        json!(["id", "action"]),
        "backward-compatible shape"
    );
    for field in ["today", "scheduled"] {
        let description = schema["properties"][field]["description"]
            .as_str()
            .unwrap_or_else(|| panic!("{field} has no description: {schema}"));
        assert!(
            description.contains("Required when action is postpone"),
            "{description}"
        );
    }
    // Omitting them is still rejected with the same validation meaning as a bad date.
    let created = home.mcp("todo_task_create", json!({"title":"Probe"})).await;
    let missing = home
        .mcp_err(
            "todo_transition",
            json!({"id":created["id"],"action":"postpone"}),
        )
        .await;
    assert_eq!(missing["code"], "validation_error", "{missing}");
    let list = home.tool("todo_list").await;
    let today = list["inputSchema"]["properties"]["today"]["description"]
        .as_str()
        .unwrap_or_default();
    assert!(today.contains("Required when scope is today"), "{list}");
    let missing = home.mcp_err("todo_list", json!({"scope":"today"})).await;
    assert_eq!(missing["code"], "validation_error");
}
