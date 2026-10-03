use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use tower::ServiceExt;

fn config(temp: &tempfile::TempDir) -> RavenApiConfig {
    RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: temp.path().join("ledger.sqlite"),
        health_db: temp.path().join("health.sqlite"),
        health_media_dir: temp.path().join("media"),
        local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
        auth: crate::AuthMode::Bearer {
            token: "discarded-test-token".into(),
        },
    }
}

#[tokio::test]
async fn archive_search_has_no_table_scope_and_post_queries_are_read_only() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    let conn = todo_engine::infrastructure::sqlite::connect(cfg.todo_db.to_str().unwrap()).unwrap();
    todo_engine::infrastructure::sqlite::init_schema(&conn).unwrap();
    drop(conn);
    let adapter = McpAdapter::new(cfg).unwrap();
    let archived = adapter.call("todo_archive_search", json!({})).await;
    assert_eq!(archived.is_error, Some(false), "{archived:?}");
    for name in [
        "todo_search",
        "ledger_search",
        "health_search",
        "ledger_analysis",
    ] {
        let tool = adapter
            .catalog
            .iter()
            .find(|s| s.tool.name == name)
            .unwrap();
        assert_eq!(
            serde_json::to_value(&tool.tool.annotations).unwrap()["readOnlyHint"],
            true,
            "{name}"
        );
    }
}

#[tokio::test]
async fn ledger_search_omitted_sort_uses_ui_defaults() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    ledger_engine::infrastructure::sqlite::SqliteLedgerRepository::open(&cfg.ledger_db).unwrap();
    let adapter = McpAdapter::new(cfg).unwrap();
    for scope in schema::LEDGER_SCOPES {
        let result = adapter.call("ledger_search", json!({"scope":scope})).await;
        assert_eq!(result.is_error, Some(false), "{scope}: {result:?}");
    }
}

#[test]
fn todo_relation_fields_can_be_cleared_without_clearing_required_goal_anchor() {
    for kind in ["task", "goal"] {
        let schema = schema::object(
            &schema::todo_fields(kind, true),
            &["id", "expected_updated_at"],
        );
        assert!(
            jsonschema::is_valid(
                &schema,
                &json!({"id":"existing-id","expected_updated_at":"2026-10-02T00:00:00Z","parent_id":""})
            ),
            "{kind}"
        );
        if kind == "goal" {
            assert!(!jsonschema::is_valid(
                &schema,
                &json!({"id":"existing-id","expected_updated_at":"2026-10-02T00:00:00Z","scheduled":""})
            ));
        }
    }
}

#[test]
fn discovery_restricts_analysis_scope_and_scope_context() {
    let tools = catalog::build();
    let analysis = tools
        .iter()
        .find(|s| s.tool.name == "ledger_analysis")
        .unwrap();
    assert!(
        !analysis
            .validator
            .is_valid(&json!({"scope":"ledger.accounts"}))
    );
    let planner = schema::table_for_scope("planner.weekly-week-goals");
    assert!(!jsonschema::is_valid(
        &planner,
        &json!({"scope":"planner.weekly-week-goals"})
    ));
    assert!(jsonschema::is_valid(
        &planner,
        &json!({"scope":"planner.weekly-week-goals","context":{"from":"2026-09-28","to":"2026-10-04"}})
    ));
    let linked = schema::table_for_scope("linked.goal.task");
    assert!(!jsonschema::is_valid(
        &linked,
        &json!({"scope":"linked.goal.task","context":{"parent_type":"area","parent_id":"known-id"}})
    ));
}

#[tokio::test]
async fn bounded_read_response_does_not_report_a_committed_mutation() {
    let temp = tempfile::tempdir().unwrap();
    let mut adapter = McpAdapter::new(config(&temp)).unwrap();
    adapter.api = Router::new().route(
        "/api/v1/health/table/query",
        axum::routing::post(|| async { "x".repeat(MAX_RESPONSE_BYTES + 1) }),
    );
    let result = adapter
        .call("health_search", json!({"scope":"health.diet"}))
        .await;
    let error = result.structured_content.unwrap();
    assert_eq!(error["code"], "response_unavailable");
    assert_eq!(error["committed"], false);
}

#[tokio::test]
async fn every_tool_route_exists_and_probe_never_initializes_stores() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    let adapter = McpAdapter::new(cfg.clone()).unwrap();
    // Inspect ToDo routing before its composed adapter normalizes method errors.
    let todo_api = todo_engine::interfaces::api::raven_router(&cfg.todo_db);
    for spec in adapter.catalog.iter() {
        let actions = if spec.path.contains("{action}") {
            vec![
                "pause", "miss", "postpone", "resume", "complete", "reopen", "archive",
            ]
        } else {
            vec!["complete"]
        };
        for action in actions {
            let path = spec
                .path
                .replace("{id}", "probe-id")
                .replace("{record_type}", "probe-type")
                .replace("{action}", action);
            let (target, route_path) = if let Some(route_path) = path.strip_prefix("/api/v1/todo") {
                (todo_api.clone(), route_path)
            } else {
                (adapter.api.clone(), path.as_str())
            };
            let request = Request::builder()
                .method("OPTIONS")
                .uri(route_path)
                .header(header::AUTHORIZATION, adapter.authorization.clone())
                .body(Body::empty())
                .unwrap();
            let response = target.oneshot(request).await.unwrap();
            assert_eq!(
                response.status(),
                StatusCode::METHOD_NOT_ALLOWED,
                "{}: {path}",
                spec.tool.name
            );
        }
    }
    assert!(!cfg.todo_db.exists());
    assert!(!cfg.ledger_db.exists());
    assert!(!cfg.health_db.exists());
    assert!(!cfg.health_media_dir.exists());
}

#[tokio::test]
async fn todo_mutation_uses_the_existing_service_and_audit() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    let connection =
        todo_engine::infrastructure::sqlite::connect(cfg.todo_db.to_str().unwrap()).unwrap();
    todo_engine::infrastructure::sqlite::init_schema(&connection).unwrap();
    drop(connection);
    let adapter = McpAdapter::new(cfg).unwrap();
    let created = adapter
        .call("todo_task_create", json!({"title":"MCP task"}))
        .await;
    assert_eq!(created.is_error, Some(false), "{created:?}");
    let item = created.structured_content.unwrap();
    assert_eq!(item["status"], "active");
    let history = adapter.call("todo_history", json!({"id":item["id"]})).await;
    assert_eq!(history.is_error, Some(false));
    assert_eq!(
        history.structured_content.unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn missing_store_reads_do_not_create_stores_or_expose_paths() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    let adapter = McpAdapter::new(cfg.clone()).unwrap();
    let result = adapter
        .call("health_choices", json!({"scope":"health.diet"}))
        .await;
    assert_eq!(result.is_error, Some(true));
    assert_eq!(result.structured_content.unwrap()["code"], "internal_error");
    assert!(!cfg.health_db.exists());
    assert!(!cfg.todo_db.exists());
    assert!(!cfg.ledger_db.exists());
    assert!(!cfg.health_media_dir.exists());
}

async fn rpc(
    app: &axum::Router,
    token: Option<&str>,
    method: &str,
    params: Value,
) -> axum::response::Response {
    let mut request = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("host", "mcp.example.com")
        .header("accept", "application/json, text/event-stream")
        .header("content-type", "application/json")
        .header("mcp-protocol-version", "2025-11-25");
    if let Some(token) = token {
        request = request.header("cf-access-jwt-assertion", token);
    }
    app.clone()
        .oneshot(
            request
                .body(Body::from(
                    json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn authenticated_http_negotiates_and_lists_typed_tools_without_ui_cookie() {
    let temp = tempfile::tempdir().unwrap();
    let (auth, token) = access::tests::auth_and_token();
    let app = router_with_auth(config(&temp), auth).unwrap();
    let initialize = json!({"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}});
    assert_eq!(
        rpc(&app, None, "initialize", initialize.clone())
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        rpc(
            &app,
            Some("fake-assertion"),
            "initialize",
            initialize.clone()
        )
        .await
        .status(),
        StatusCode::UNAUTHORIZED
    );
    let response = rpc(&app, Some(&token), "initialize", initialize).await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let result: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(result["result"]["serverInfo"]["name"], "raven");
    let response = rpc(&app, Some(&token), "tools/list", json!({})).await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let result: Value = serde_json::from_slice(&bytes).unwrap();
    let tools = result["result"]["tools"].as_array().unwrap();
    assert!(
        tools
            .iter()
            .any(|tool| tool["name"] == "health_daily_upsert")
    );
    assert!(!tools.iter().any(|tool| tool["name"] == "health_metric_add"));
    assert!(
        tools
            .iter()
            .all(|tool| tool["inputSchema"]["additionalProperties"] == false)
    );
    let response = rpc(
        &app,
        Some(&token),
        "tools/call",
        json!({"name":"health_choices","arguments":{"scope":"health.diet"}}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let result: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(result["result"]["isError"], true);
    assert_eq!(
        result["result"]["structuredContent"]["code"],
        "internal_error"
    );
}

#[tokio::test]
async fn health_event_edits_preserve_kind_and_use_update_guards() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    health_engine::infrastructure::sqlite::SqliteHealthRepository::open(&cfg.health_db).unwrap();
    health_engine::infrastructure::media::LocalMediaStore::new(&cfg.health_media_dir).unwrap();
    let adapter = McpAdapter::new(cfg).unwrap();
    let created = adapter.call("health_bowel_create",json!({"occurred_at":"2026-10-02T09:00:00+09:00","details":{"kind":"bowel","bristol_scale":4}})).await.structured_content.unwrap();
    let edit =
        json!({"id":created["id"],"expected_updated_at":created["updated_at"],"note":"edited"});
    let rejected = adapter.call("health_medication_update", edit.clone()).await;
    assert_eq!(rejected.is_error, Some(true));
    let updated = adapter.call("health_bowel_update", edit).await;
    assert_eq!(updated.is_error, Some(false), "{updated:?}");
}

#[tokio::test]
async fn choices_expose_scope_specific_query_fields() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    health_engine::infrastructure::sqlite::SqliteHealthRepository::open(&cfg.health_db).unwrap();
    let adapter = McpAdapter::new(cfg).unwrap();
    let result = adapter
        .call("health_choices", json!({"scope":"health.bowel"}))
        .await;
    assert_eq!(result.is_error, Some(false));
    let value = result.structured_content.unwrap();
    assert!(
        value["query_schema"]["properties"]["group_by"]["enum"]
            .as_array()
            .unwrap()
            .contains(&json!("day"))
    );
    assert_eq!(
        value["query_schema"]["properties"]["filters"]["items"]["properties"]["field"]["enum"],
        json!(["date", "bristol_scale", "blood_visible"])
    );
}

#[test]
fn schemas_cover_ui_condition_and_currency_ranges_and_event_timestamp() {
    let tools = catalog::build();
    let find = |name: &str| tools.iter().find(|spec| spec.tool.name == name).unwrap();
    assert!(
        find("todo_event_create")
            .validator
            .is_valid(&json!({"title":"appointment","scheduled":"2026-10-02T09:00:00+09:00"}))
    );
    assert!(
        find("ledger_currency_create")
            .validator
            .is_valid(&json!({"code":"TST","name":"Test","symbol":"T","decimal_places":18}))
    );
    assert!(find("health_daily_upsert").validator.is_valid(&json!({"metrics":[{"occurred_at":"2026-10-02T09:00:00+09:00","details":{"kind":"overall_condition","score":10}}]})));
}

#[tokio::test]
async fn todo_choices_and_guarded_edits_match_cli() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    let connection =
        todo_engine::infrastructure::sqlite::connect(cfg.todo_db.to_str().unwrap()).unwrap();
    todo_engine::infrastructure::sqlite::init_schema(&connection).unwrap();
    drop(connection);
    let adapter = McpAdapter::new(cfg).unwrap();
    for (kind, body) in [
        ("area", json!({"title":"Area"})),
        ("task", json!({"title":"Task","priority":4})),
        (
            "event",
            json!({"title":"Event","scheduled":"2026-10-02T09:00:00+09:00"}),
        ),
    ] {
        let created = adapter.call(&format!("todo_{kind}_create"), body).await;
        assert_eq!(created.is_error, Some(false), "{created:?}");
        let item = created.structured_content.unwrap();
        let options = adapter
            .call("todo_options", json!({"id":item["id"]}))
            .await
            .structured_content
            .unwrap();
        let decoded: todo_engine::domain::TodoItem = serde_json::from_value(item.clone()).unwrap();
        assert_eq!(
            options,
            todo_engine::interfaces::cli::choice_options(None, Some(&decoded))
        );
        if kind == "task" {
            let cleared = adapter.call("todo_task_update",json!({"id":item["id"],"priority":null,"expected_updated_at":item["updated_at"]})).await;
            assert_eq!(cleared.is_error, Some(false), "{cleared:?}");
            assert!(cleared.structured_content.unwrap()["priority"].is_null());
            let stale = adapter.call("todo_task_update",json!({"id":item["id"],"title":"stale","expected_updated_at":"2020-01-01T00:00:00Z"})).await;
            assert_eq!(stale.structured_content.unwrap()["code"], "conflict");
        }
    }
}

#[tokio::test]
async fn ledger_search_choices_and_audit_use_ui_routes() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    ledger_engine::infrastructure::sqlite::SqliteLedgerRepository::open(&cfg.ledger_db).unwrap();
    let adapter = McpAdapter::new(cfg).unwrap();
    for (name, args) in [
        (
            "ledger_currency_create",
            json!({"code":"KRW","name":"Won","symbol":"₩","decimal_places":0}),
        ),
        ("ledger_account_category_create", json!({"name":"Cash"})),
        (
            "ledger_account_create",
            json!({"name":"Wallet","category":"Cash","currency":"KRW","opening_balance":"0"}),
        ),
        (
            "ledger_category_create",
            json!({"name":"Food","kind":"expense"}),
        ),
    ] {
        let result = adapter.call(name, args).await;
        assert_eq!(result.is_error, Some(false), "{result:?}");
    }
    let entry = adapter.call("ledger_entry_create",json!({"date":"2026-10-02","content":"Quoted ' lunch","account":"Wallet","category":"Food","entry_type":"expense","amount":"12000","currency":"KRW"})).await;
    assert_eq!(entry.is_error, Some(false), "{entry:?}");
    let id = entry.structured_content.unwrap()["id"].clone();
    let result = adapter.call("ledger_search",json!({"scope":"ledger.transactions","filters":[{"field":"content","operator":"contains","value":{"text":"' lunch"}}],"sorts":[{"field":"amount","direction":"desc"}],"group_by":"account"})).await;
    assert_eq!(result.is_error, Some(false), "{result:?}");
    assert_eq!(
        result.structured_content.unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let choices = adapter
        .call("ledger_choices", json!({"scope":"ledger.transactions"}))
        .await;
    assert_eq!(choices.is_error, Some(false));
    assert_eq!(
        choices.structured_content.unwrap()["choices"]["accounts"][0]["label"],
        "Wallet"
    );
    let history = adapter
        .call("ledger_audit", json!({"record_type":"entry","id":id}))
        .await;
    assert_eq!(history.is_error, Some(false), "{history:?}");
}

#[tokio::test]
async fn daily_metric_upsert_preserves_one_row_and_rejects_generic_metric_creation() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    health_engine::infrastructure::sqlite::SqliteHealthRepository::open(&cfg.health_db).unwrap();
    health_engine::infrastructure::media::LocalMediaStore::new(&cfg.health_media_dir).unwrap();
    let adapter = McpAdapter::new(cfg).unwrap();
    let input = json!({"metrics":[{"occurred_at":"2026-10-02T09:00:00+09:00","details":{"kind":"weight","value":70,"unit":"kg"}}]});
    let first = adapter.call("health_daily_upsert", input.clone()).await;
    assert_eq!(first.is_error, Some(false), "{first:?}");
    let item = first.structured_content.unwrap()["items"][0].clone();
    let mut update = input;
    update["metrics"][0]["expected_updated_at"] = item["updated_at"].clone();
    update["metrics"][0]["details"]["value"] = json!(71);
    let second = adapter.call("health_daily_upsert", update).await;
    assert_eq!(second.is_error, Some(false), "{second:?}");
    assert_eq!(
        second.structured_content.unwrap()["items"][0]["id"],
        item["id"]
    );
    let page = adapter
        .call("health_search", json!({"scope":"health.metrics"}))
        .await;
    assert_eq!(
        page.structured_content.unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        adapter.call("health_metric_add", json!({})).await.is_error,
        Some(true)
    );
    assert_eq!(adapter.call("health_bowel_create",json!({"occurred_at":"2026-10-02T09:00:00+09:00","details":{"kind":"weight","value":10,"unit":"kg"}})).await.is_error,Some(true));
}

#[tokio::test]
async fn diet_photo_round_trips_through_existing_media_handlers() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    health_engine::infrastructure::sqlite::SqliteHealthRepository::open(&cfg.health_db).unwrap();
    health_engine::infrastructure::media::LocalMediaStore::new(&cfg.health_media_dir).unwrap();
    let adapter = McpAdapter::new(cfg).unwrap();
    let png = [
        0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0,
        0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 10, b'I', b'D', b'A',
        b'T', 0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, b'I',
        b'E', b'N', b'D', 0xae, 0x42, 0x60, 0x82,
    ];
    let image = STANDARD.encode(png);
    let result = adapter.call("health_diet_image_create",json!({"metadata":{"occurred_at":"2026-10-02T09:00:00+09:00","meal_type":"breakfast","food_name":"아침 식사"},"content_type":"image/png","image_base64":image,"request_key":"photo"})).await;
    assert_eq!(result.is_error, Some(false), "{result:?}");
    let item = result.structured_content.unwrap();
    let media = serde_json::to_value(&item["media_id"]).unwrap();
    let media_id = media
        .as_str()
        .or_else(|| media["id"].as_str())
        .expect("media reference");
    let audit = adapter
        .call(
            "health_audit",
            json!({"record_type":"media_file","id":media_id}),
        )
        .await;
    assert_eq!(audit.is_error, Some(false), "{audit:?}");
    assert!(
        !audit.structured_content.unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let photo = adapter
        .call("health_diet_image_get", json!({"id":item["id"]}))
        .await;
    assert_eq!(photo.is_error, Some(false));
    let data = serde_json::to_value(photo.content).unwrap();
    assert_eq!(data[0]["type"], "image");
    assert_eq!(data[0]["data"], image);
    let replaced = adapter.call("health_diet_image_update",json!({"id":item["id"],"metadata":{"food_name":"교체 사진 😀","expected_updated_at":item["updated_at"]},"content_type":"image/png","image_base64":image})).await;
    assert_eq!(replaced.is_error, Some(false), "{replaced:?}");
    assert_eq!(
        replaced.structured_content.unwrap()["food_name"],
        "교체 사진 😀"
    );
    let invalid = adapter.call("health_diet_image_create",json!({"metadata":{"occurred_at":"2026-10-02T09:00:00+09:00","meal_type":"breakfast","food_name":"bad"},"content_type":"image/png","image_base64":"not base64"})).await;
    assert_eq!(
        invalid.structured_content.unwrap()["code"],
        "validation_error"
    );
}

#[tokio::test]
async fn keyed_create_replays_after_restart_and_rejects_changed_payload() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    let conn = todo_engine::infrastructure::sqlite::connect(cfg.todo_db.to_str().unwrap()).unwrap();
    todo_engine::infrastructure::sqlite::init_schema(&conn).unwrap();
    drop(conn);
    let adapter = McpAdapter::new(cfg.clone()).unwrap();
    let args = json!({"title":"Retry me","actor":"user","request_key":"SHI-138.retry"});
    let first = adapter.call("todo_task_create", args.clone()).await;
    assert_eq!(first.is_error, Some(false), "{first:?}");
    let again = McpAdapter::new(cfg.clone())
        .unwrap()
        .call("todo_task_create", args.clone())
        .await;
    assert_eq!(first.structured_content, again.structured_content);
    let conflict = adapter
        .call(
            "todo_task_create",
            json!({"title":"Different","request_key":"SHI-138.retry"}),
        )
        .await;
    assert_eq!(
        conflict.structured_content.unwrap()["code"],
        "request_key_conflict"
    );
    let list = adapter
        .call("todo_list", json!({"limit":1}))
        .await
        .structured_content
        .unwrap();
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    let pending_args = json!({"title":"Pending"});
    let fingerprint = receipts::fingerprint("todo_task_create", &pending_args);
    assert!(matches!(
        receipts::claim(&adapter.receipt_path, "pending", &fingerprint).unwrap(),
        receipts::Claim::New
    ));
    let pending = adapter
        .call(
            "todo_task_create",
            json!({"title":"Pending","request_key":"pending"}),
        )
        .await;
    assert!(pending.structured_content.unwrap()["committed"].is_null());
    let count = adapter
        .call("todo_list", json!({}))
        .await
        .structured_content
        .unwrap()["items"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(count, 1);
    assert!(!cfg.ledger_db.exists());
}

#[tokio::test]
async fn concurrent_create_receipts_allow_one_domain_write() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    let conn = todo_engine::infrastructure::sqlite::connect(cfg.todo_db.to_str().unwrap()).unwrap();
    todo_engine::infrastructure::sqlite::init_schema(&conn).unwrap();
    drop(conn);
    let adapter = McpAdapter::new(cfg).unwrap();
    let args = json!({"title":"Concurrent","request_key":"same"});
    let (a, b) = tokio::join!(
        adapter.call("todo_task_create", args.clone()),
        adapter.call("todo_task_create", args)
    );
    assert!(a.is_error == Some(false) || b.is_error == Some(false));
    let list = adapter
        .call("todo_list", json!({}))
        .await
        .structured_content
        .unwrap();
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn postponed_routine_task_stays_missed_and_follow_up_is_independent() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    let conn = todo_engine::infrastructure::sqlite::connect(cfg.todo_db.to_str().unwrap()).unwrap();
    todo_engine::infrastructure::sqlite::init_schema(&conn).unwrap();
    drop(conn);
    let adapter = McpAdapter::new(cfg).unwrap();
    let routine = adapter
        .call(
            "todo_routine_create",
            json!({"title":"Daily","recurrence_rule":"RRULE:FREQ=DAILY","future_occurrences":2}),
        )
        .await;
    assert_eq!(routine.is_error, Some(false), "{routine:?}");
    let routine = routine.structured_content.unwrap();
    assert_eq!(
        adapter
            .call("todo_routines_materialize", json!({}))
            .await
            .is_error,
        Some(false)
    );
    let generated = adapter
        .call(
            "todo_list",
            json!({"routine_id":routine["id"],"status":"active"}),
        )
        .await
        .structured_content
        .unwrap();
    let task = &generated["items"][0];
    let today = task["scheduled"].as_str().unwrap();
    let next = time::Date::parse(today, &time::format_description::well_known::Iso8601::DATE)
        .unwrap()
        .next_day()
        .unwrap()
        .to_string();
    let postponed = adapter
        .call(
            "todo_transition",
            json!({"id":task["id"],"action":"postpone","today":today,"scheduled":next}),
        )
        .await;
    assert_eq!(postponed.is_error, Some(false), "{postponed:?}");
    let result = postponed.structured_content.unwrap();
    assert_eq!(result["source"]["status"], "missed");
    assert_eq!(result["follow_up"]["status"], "active");
    assert!(result["follow_up"]["routine_id"].is_null());
    assert!(result["follow_up"]["occurrence_key"].is_null());
    assert_ne!(result["source"]["id"], result["follow_up"]["id"]);
    let all = adapter.call("todo_routines_materialize", json!({})).await;
    assert_eq!(all.is_error, Some(false), "{all:?}");
    let original = adapter
        .call("todo_get", json!({"id":task["id"]}))
        .await
        .structured_content
        .unwrap();
    assert_eq!(original["status"], "missed");
    let future = adapter
        .call(
            "todo_list",
            json!({"routine_id":routine["id"],"status":"active"}),
        )
        .await
        .structured_content
        .unwrap();
    assert!(!future["items"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn ledger_diagnostics_export_and_archived_reads_use_services() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    ledger_engine::infrastructure::sqlite::SqliteLedgerRepository::open(&cfg.ledger_db).unwrap();
    let adapter = McpAdapter::new(cfg).unwrap();
    for (name, args) in [
        (
            "ledger_category_create",
            json!({"name":"Food","kind":"expense"}),
        ),
        (
            "ledger_currency_create",
            json!({"code":"KRW","name":"Won","symbol":"W","decimal_places":0}),
        ),
        ("ledger_account_category_create", json!({"name":"Cash"})),
        (
            "ledger_account_create",
            json!({"name":"Wallet","category":"Cash","currency":"KRW","opening_balance":"0"}),
        ),
    ] {
        let r = adapter.call(name, args).await;
        assert_eq!(r.is_error, Some(false), "{r:?}");
    }
    let r=adapter.call("ledger_entry_create",json!({"date":"2026-10-03","content":"Archive probe","category":"Food","account":"Wallet","currency":"KRW","entry_type":"expense","amount":"1","request_key":"ledger.retry"})).await;
    assert_eq!(r.is_error, Some(false), "{r:?}");
    let id = r.structured_content.unwrap()["id"].clone();
    assert_eq!(
        adapter
            .call("ledger_entry_archive", json!({"id":id}))
            .await
            .is_error,
        Some(false)
    );
    assert_eq!(
        adapter
            .call("ledger_entry_get", json!({"id":id}))
            .await
            .is_error,
        Some(true)
    );
    assert_eq!(
        adapter
            .call("ledger_entry_get", json!({"id":id,"include_archived":true}))
            .await
            .is_error,
        Some(false)
    );
    let entries = adapter
        .call(
            "ledger_entry_list",
            json!({"include_archived":true,"content":"probe"}),
        )
        .await;
    assert_eq!(
        entries.structured_content.unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let masters = adapter
        .call("ledger_currency_list", json!({"query":"krw","limit":1}))
        .await;
    assert_eq!(
        masters.structured_content.unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let doctor = adapter
        .call("ledger_doctor", json!({"max_records":1}))
        .await;
    assert_eq!(doctor.is_error, Some(false), "{doctor:?}");
    let export = adapter
        .call("ledger_export", json!({"include_archived":true}))
        .await;
    assert_eq!(export.is_error, Some(false), "{export:?}");
    assert_eq!(export.structured_content.unwrap()["restore_capable"], true);
}

#[tokio::test]
async fn keyed_timeout_leaves_pending_receipt_and_never_reexecutes() {
    let temp = tempfile::tempdir().unwrap();
    let mut adapter = McpAdapter::new(config(&temp)).unwrap();
    adapter.api = Router::new().route(
        "/api/v1/todo/tasks/propose",
        axum::routing::post(|| async {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            axum::Json(json!({"id":"would-be-created"}))
        }),
    );
    let args = json!({"title":"Slow","request_key":"timeout","timeout_seconds":1});
    let result = adapter.call("todo_task_create", args.clone()).await;
    let error = result.structured_content.unwrap();
    assert_eq!(error["code"], "request_outcome_unknown");
    assert!(error["committed"].is_null());
    let retry = adapter.call("todo_task_create", args).await;
    assert_eq!(
        retry.structured_content.unwrap()["code"],
        "request_outcome_unknown"
    );
    let invalid = adapter
        .call(
            "todo_task_create",
            json!({"title":"Slow","timeout_seconds":120}),
        )
        .await;
    assert_eq!(
        invalid.structured_content.unwrap()["code"],
        "validation_error"
    );
}

#[tokio::test]
async fn historical_metric_keys_and_archived_versions_remain_readable() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    health_engine::infrastructure::sqlite::SqliteHealthRepository::open(&cfg.health_db).unwrap();
    health_engine::infrastructure::media::LocalMediaStore::new(&cfg.health_media_dir).unwrap();
    let adapter = McpAdapter::new(cfg.clone()).unwrap();
    // Construct an old non-daily fixture in a disposable store. No live store or new metric creation policy is used.
    let created = adapter.call("health_daily_upsert",json!({"metrics":[{"occurred_at":"2020-01-01T09:00:00+09:00","details":{"kind":"lab","key":"crp","name":"CRP","value":12,"unit":"mg/L"}}]})).await;
    assert_eq!(created.is_error, Some(false), "{created:?}");
    let item = created.structured_content.unwrap()["items"][0].clone();
    let conn = rusqlite::Connection::open(&cfg.health_db).unwrap();
    conn.execute("UPDATE health_events SET metric_key='historical_lab',name='Historical lab',daily_upsert=0,attributes_json=replace(replace(attributes_json,'crp','historical_lab'),'CRP','Historical lab') WHERE id=?1",[item["id"].as_str().unwrap()]).unwrap();
    drop(conn);
    let page = adapter
        .call(
            "health_event_list",
            json!({"metrics_only":true,"category":"lab","metric_key":"historical_lab","limit":1}),
        )
        .await;
    let page = page.structured_content.unwrap();
    assert_eq!(page["items"][0]["id"], item["id"]);
    assert_eq!(page["next_offset"], 1);
    let empty=adapter.call("health_event_list",json!({"metrics_only":true,"category":"lab","metric_key":"historical_lab","offset":1,"limit":1})).await.structured_content.unwrap();
    assert!(empty["items"].as_array().unwrap().is_empty());
    assert!(empty["next_offset"].is_null());
    let archived = adapter
        .call(
            "health_event_archive",
            json!({"id":item["id"],"expected_updated_at":item["updated_at"]}),
        )
        .await;
    assert_eq!(archived.is_error, Some(false), "{archived:?}");
    assert_eq!(
        adapter
            .call("health_event_get", json!({"id":item["id"]}))
            .await
            .is_error,
        Some(true)
    );
    let read = adapter
        .call(
            "health_event_get",
            json!({"id":item["id"],"include_archived":true}),
        )
        .await;
    assert_eq!(read.is_error, Some(false), "{read:?}");
    let read = read.structured_content.unwrap();
    assert_eq!(
        adapter
            .call(
                "health_event_restore",
                json!({"id":item["id"],"expected_updated_at":read["updated_at"]})
            )
            .await
            .is_error,
        Some(false)
    );
}

#[tokio::test]
async fn new_data_reads_do_not_initialize_missing_stores_or_receipts() {
    let temp = tempfile::tempdir().unwrap();
    let cfg = config(&temp);
    let adapter = McpAdapter::new(cfg.clone()).unwrap();
    for (name, args) in [
        ("todo_list", json!({"scope":"today","today":"2026-10-03"})),
        ("ledger_doctor", json!({})),
        ("ledger_export", json!({"include_archived":true})),
        ("ledger_entry_list", json!({"include_archived":true})),
        ("health_event_list", json!({"metrics_only":true})),
    ] {
        let result = adapter.call(name, args).await;
        assert_eq!(result.is_error, Some(true), "{name}: {result:?}");
        let text = serde_json::to_string(&result).unwrap();
        assert!(!text.contains(temp.path().to_str().unwrap()));
    }
    assert!(!cfg.todo_db.exists());
    assert!(!cfg.ledger_db.exists());
    assert!(!cfg.health_db.exists());
    assert!(!adapter.receipt_path.exists());
}
