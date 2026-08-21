use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, router};
use serde_json::{Value, json};
use std::path::{Path as FilePath, PathBuf};
use tower::ServiceExt;

const PNG: &[u8] = &[
    0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 10, b'I', b'D', b'A', b'T',
    0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, b'I', b'E', b'N',
    b'D', 0xae, 0x42, 0x60, 0x82,
];
const JPEG: &[u8] = &[
    0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff,
    0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9,
];
const WEBP: &[u8] = &[
    b'R', b'I', b'F', b'F', 14, 0, 0, 0, b'W', b'E', b'B', b'P', b'V', b'P', b'8', b'L', 1, 0, 0,
    0, 0, 0,
];

fn app() -> (tempfile::TempDir, axum::Router) {
    let temp = tempfile::tempdir().unwrap();
    let config = RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: temp.path().join("ledger.sqlite"),
        health_db: temp.path().join("health.sqlite"),
        health_media_dir: temp.path().join("media"),
        local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
        auth: AuthMode::UiSession {
            token: "test".into(),
        },
    };
    (temp, authenticated(router(config).unwrap()))
}

fn authenticated(app: axum::Router) -> axum::Router {
    app.layer(axum::middleware::from_fn(
        |mut request: Request<Body>, next: axum::middleware::Next| async move {
            request
                .headers_mut()
                .insert(header::COOKIE, "raven_session=test".parse().unwrap());
            next.run(request).await
        },
    ))
}

async fn body(response: axum::response::Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

fn health_table_query(scope: &str) -> Value {
    let sort = if scope == "health.diet" {
        "food"
    } else {
        "date"
    };
    json!({
        "scope": scope,
        "offset": 0,
        "limit": 50,
        "filter_mode": "and",
        "filters": [],
        "sorts": [{"field": sort, "direction": "asc"}],
        "group_by": "none",
        "group_settings": {
            "sort": "alphabetical",
            "hide_empty": true,
            "manual_order": [],
            "hidden_group_keys": []
        },
        "context": {"reference_date": "2026-08-21"}
    })
}

async fn post_json(app: &axum::Router, path: &str, value: Value) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::post(path)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn health_table_query_serves_all_scopes_and_keeps_legacy_list_shapes() {
    let (_temp, app) = app();
    create_diet(&app).await;
    post_health_event(
        &app,
        "2026-07-31T02:00:00Z",
        json!({"kind":"bowel", "bristol_scale":4, "blood_visible":true}),
    )
    .await;
    post_health_event(
        &app,
        "2026-07-31T03:00:00Z",
        json!({"kind":"medication", "medication_name":"A", "dose":2, "unit":"tablet"}),
    )
    .await;
    post_daily(&app, json!({"metrics":[weight_metric(68.2, None)]})).await;

    for (scope, kind) in [
        ("health.diet", "diet"),
        ("health.bowel", "bowel"),
        ("health.medication", "medication"),
        ("health.metrics", "metrics"),
    ] {
        let response = post_json(
            &app,
            "/api/v1/health/table/query",
            health_table_query(scope),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK, "{scope}");
        let value = body(response).await;
        assert_eq!(value.as_object().unwrap().len(), 2);
        assert!(value.get("next_offset").is_some());
        let first = &value["items"][0];
        assert!(first["key"].is_string());
        assert_eq!(first["record"]["kind"], kind);
        assert!(
            first["record"]["date"]
                .as_str()
                .unwrap()
                .starts_with("2026-")
        );
    }

    for path in ["/api/v1/health/diet", "/api/v1/health/events"] {
        let response = app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let value = body(response).await;
        assert_eq!(value.as_object().unwrap().len(), 1);
        assert!(value["items"].is_array());
    }
}

#[tokio::test]
async fn health_table_query_is_recursive_strict_bounded_and_safe() {
    let (_temp, app) = app();
    for pointer in [
        "",
        "/context",
        "/filters/0",
        "/filters/0/value",
        "/sorts/0",
        "/group_settings",
    ] {
        let mut query = health_table_query("health.diet");
        if pointer.starts_with("/filters/0") {
            query["filters"] = json!([{"field":"food","operator":"contains","value":{"text":"x"}}]);
        }
        query
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unexpected".into(), json!(true));
        assert_eq!(
            post_json(&app, "/api/v1/health/table/query", query)
                .await
                .status(),
            StatusCode::BAD_REQUEST,
            "{pointer}"
        );
    }
    for value in [
        json!({"range":{"start":"2026-01-01","end":"2026-01-02","unexpected":true}}),
        json!({"relative":{"amount":"1","unit":"day","unexpected":true}}),
    ] {
        let mut query = health_table_query("health.diet");
        query["filters"] = json!([{"field":"date","operator":if value.get("range").is_some() {"is_between"} else {"is_relative_to_today"},"value":value}]);
        assert_eq!(
            post_json(&app, "/api/v1/health/table/query", query)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let mut too_many = health_table_query("health.metrics");
    too_many["limit"] = json!(51);
    assert_eq!(
        post_json(&app, "/api/v1/health/table/query", too_many)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    let mut defaulted = health_table_query("health.metrics");
    defaulted.as_object_mut().unwrap().remove("limit");
    assert_eq!(
        post_json(&app, "/api/v1/health/table/query", defaulted)
            .await
            .status(),
        StatusCode::OK
    );
    let oversized = Request::post("/api/v1/health/table/query")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(format!(
            r#"{{"padding":"{}"}}"#,
            "x".repeat(128 * 1024)
        )))
        .unwrap();
    let response = app.clone().oneshot(oversized).await.unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let rendered = body(response).await.to_string();
    assert!(
        !rendered.contains("padding")
            && !rendered.contains("SELECT")
            && !rendered.contains("sqlite")
    );
}

#[tokio::test]
async fn health_table_query_validates_scope_values_reference_date_and_normalizes_tags() {
    let (_temp, app) = app();
    post_health_diet(&app, "2026-08-20T03:00:00Z", &["Canonical"]).await;
    for filter in [
        json!({"field":"bristol_scale","operator":"is","value":{"list":["4"]}}),
        json!({"field":"date","operator":"contains","value":{"text":"2026-08-21"}}),
        json!({"field":"meal_type","operator":"is","value":{"text":"lunch"}}),
    ] {
        let mut query = health_table_query("health.diet");
        query["filters"] = json!([filter]);
        let response = post_json(&app, "/api/v1/health/table/query", query).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let rendered = body(response).await.to_string();
        assert!(!rendered.contains("SELECT") && !rendered.contains("sqlite"));
    }
    for (field, target) in [("dose", "sorts"), ("bristol_scale", "group_by")] {
        let mut query = health_table_query("health.diet");
        if target == "sorts" {
            query["sorts"][0]["field"] = json!(field);
        } else {
            query["group_by"] = json!(field);
        }
        assert_eq!(
            post_json(&app, "/api/v1/health/table/query", query)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let relative = json!({"field":"date","operator":"is_relative_to_today","value":{"relative":{"amount":"1","unit":"day"}}});
    let mut missing = health_table_query("health.diet");
    missing["filters"] = json!([relative.clone()]);
    missing["context"] = json!({});
    assert_eq!(
        post_json(&app, "/api/v1/health/table/query", missing)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    let mut relative_query = health_table_query("health.diet");
    relative_query["filters"] = json!([relative]);
    relative_query["context"] = json!({"reference_date":"2026-08-19"});
    assert_eq!(
        body(post_json(&app, "/api/v1/health/table/query", relative_query).await).await["items"][0]
            ["record"]["food"],
        "Report meal"
    );
    let mut bad_date = health_table_query("health.diet");
    bad_date["context"] = json!({"reference_date":"2026-8-21"});
    assert_eq!(
        post_json(&app, "/api/v1/health/table/query", bad_date)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );

    let mut tag = health_table_query("health.diet");
    tag["filters"] = json!([{"field":"tags","operator":"is","value":{"list":["CANONICAL"]}}]);
    tag["group_by"] = json!("tag");
    let value = body(post_json(&app, "/api/v1/health/table/query", tag).await).await;
    assert_eq!(value["items"][0]["record"]["food"], "Report meal");
    assert_eq!(value["items"][0]["group_key"], "canonical");
}

#[tokio::test]
async fn health_table_lookups_are_scope_bounded_compact_and_do_not_conflate_untagged() {
    let (_temp, app) = app();
    post_health_diet(&app, "2026-08-20T03:00:00Z", &["UPPER", "untagged"]).await;
    let archived = post_health_diet(&app, "2026-08-19T03:00:00Z", &["archived-only"]).await;
    assert_eq!(
        app.clone()
            .oneshot(
                Request::post(format!(
                    "/api/v1/health/diet/{}/archive",
                    archived["id"].as_str().unwrap()
                ))
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    for (scope, expected) in [
        ("health.diet", "meal_type"),
        ("health.bowel", "bristol_scale"),
        ("health.medication", "medication_unit"),
        ("health.metrics", "metric"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::get(format!("/api/v1/health/table/lookups?scope={scope}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{scope}");
        let value = body(response).await;
        assert!(value[expected].is_array());
        for options in value.as_object().unwrap().values() {
            for option in options.as_array().unwrap() {
                assert_eq!(option.as_object().unwrap().len(), 2);
                assert!(option["id"].is_string() && option["label"].is_string());
            }
        }
        let rendered = value.to_string();
        assert!(
            !rendered.contains("note") && !rendered.contains("media") && !rendered.contains("path")
        );
    }
    let diet = body(
        app.clone()
            .oneshot(
                Request::get("/api/v1/health/table/lookups?scope=health.diet")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap(),
    )
    .await;
    assert!(
        diet["tags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["id"] == "upper")
    );
    assert!(
        diet["tags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["id"] == "untagged")
    );
    assert_ne!(
        diet["tags"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == "untagged")
            .unwrap()["id"],
        "__untagged__"
    );
    assert!(
        !diet["tags"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["id"] == "archived-only")
    );
    for path in [
        "/api/v1/health/table/lookups?scope=health.diet&extra=x",
        "/api/v1/health/table/lookups?scope=health.unknown",
    ] {
        let bad = app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
    }
}

async fn post_health_event(app: &axum::Router, occurred_at: &str, details: Value) -> Value {
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/health/events")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"occurred_at": occurred_at, "details": details}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    body(response).await
}

async fn post_health_diet(app: &axum::Router, occurred_at: &str, tags: &[&str]) -> Value {
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/health/diet")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "occurred_at": occurred_at,
                        "meal_type": "lunch",
                        "food_name": "Report meal",
                        "tags": tags
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    body(response).await
}

async fn create_diet(app: &axum::Router) -> Value {
    let request = Request::post("/api/v1/health/diet")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "occurred_at": "2026-07-31T01:00:00Z",
                "meal_type": "lunch",
                "food_name": "Salad",
                "tags": ["vegetable"]
            })
            .to_string(),
        ))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    body(response).await
}

async fn get_diet(app: &axum::Router, id: &str) -> Value {
    let response = app
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/health/diet/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    body(response).await
}

async fn get_diet_audit(app: &axum::Router, id: &str) -> Value {
    let response = app
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/health/audit/diet_entry/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    body(response).await
}

fn media_entries(root: &FilePath) -> Vec<PathBuf> {
    let mut entries = std::fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    entries.sort();
    entries
}

#[tokio::test]
async fn daily_metric_upsert_returns_changed_rows() {
    let (_temp, app) = app();
    let request = Request::post("/api/v1/health/metrics/daily")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "metrics": [{
                    "occurred_at": "2026-07-31T01:00:00Z",
                    "details": {
                        "kind": "weight",
                        "value": 71.5,
                        "unit": "kg"
                    }
                }]
            })
            .to_string(),
        ))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body(response).await["items"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn daily_metrics_support_mixed_atomic_save_and_daily_only_reads() {
    let (_temp, app) = app();
    let opened = post_daily(
        &app,
        json!({"metrics": [weight_metric(68.2, None), lab_metric("crp", 0.3)]}),
    )
    .await;
    let weight = &opened["items"][0];
    let crp = &opened["items"][1];
    let saved = post_daily(
        &app,
        json!({
            "metrics": [weight_metric(67.9, weight["updated_at"].as_str())],
            "archives": [{
                "id": crp["id"],
                "expected_updated_at": crp["updated_at"]
            }]
        }),
    )
    .await;
    assert_eq!(saved["items"].as_array().unwrap().len(), 1);

    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/health/events?daily_only=true")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let listed = body(response).await;
    assert_eq!(listed["items"].as_array().unwrap().len(), 1);
    assert_eq!(listed["items"][0]["value_num"], 67.9);
}

#[tokio::test]
async fn daily_metrics_conflict_rolls_back_every_operation() {
    let (_temp, app) = app();
    let opened = post_daily(
        &app,
        json!({"metrics": [weight_metric(68.2, None), lab_metric("crp", 0.3)]}),
    )
    .await;
    let stale_weight = &opened["items"][0];
    let crp = &opened["items"][1];
    post_daily(
        &app,
        json!({"metrics": [weight_metric(68.0, stale_weight["updated_at"].as_str())]}),
    )
    .await;

    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/health/metrics/daily")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "metrics": [weight_metric(67.9, stale_weight["updated_at"].as_str())],
                        "archives": [{
                            "id": crp["id"],
                            "expected_updated_at": crp["updated_at"]
                        }]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);

    let response = app
        .oneshot(
            Request::get("/api/v1/health/events?daily_only=true")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let listed = body(response).await;
    assert_eq!(listed["items"].as_array().unwrap().len(), 2);
    assert!(
        listed["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| { event["metric_key"] == "body_weight" && event["value_num"] == 68.0 })
    );
    assert!(
        listed["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| { event["metric_key"] == "crp" && event["deleted_at"].is_null() })
    );
}

async fn post_daily(app: &axum::Router, value: Value) -> Value {
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/health/metrics/daily")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    body(response).await
}

fn weight_metric(value: f64, expected_updated_at: Option<&str>) -> Value {
    json!({
        "occurred_at": "2026-07-31T01:00:00Z",
        "details": {"kind": "weight", "value": value, "unit": "kg"},
        "expected_updated_at": expected_updated_at
    })
}

fn lab_metric(key: &str, value: f64) -> Value {
    json!({
        "occurred_at": "2026-07-31T01:00:00Z",
        "details": {"kind": "lab", "key": key, "name": key.to_uppercase(), "value": value}
    })
}

#[tokio::test]
async fn media_upload_rejects_paths_and_oversized_bytes() {
    let (_temp, app) = app();
    let path = Request::post("/api/v1/health/diet/with-image")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"path":"/tmp/private.jpg"}"#))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(path).await.unwrap().status(),
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    );

    let oversized = Request::post("/api/v1/health/diet/with-image")
        .header(header::CONTENT_TYPE, "image/jpeg")
        .body(Body::from(vec![0_u8; 10 * 1024 * 1024 + 1]))
        .unwrap();
    assert_eq!(
        app.oneshot(oversized).await.unwrap().status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
}

#[tokio::test]
async fn diet_image_is_created_atomically_from_bounded_raw_bytes() {
    let (_temp, app) = app();
    let metadata = json!({
        "occurred_at": "2026-07-31T01:00:00Z",
        "meal_type": "lunch",
        "food_name": "Salad",
        "tags": ["vegetable"]
    })
    .to_string();
    let request = Request::post("/api/v1/health/diet/with-image")
        .header(header::CONTENT_TYPE, "image/png")
        .header("x-raven-diet-metadata", metadata)
        .body(Body::from(PNG))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    assert!(body(response).await["media_id"].is_string());
}

#[tokio::test]
async fn diet_image_metadata_rejects_unknown_fields() {
    let (_temp, app) = app();
    let request = Request::post("/api/v1/health/diet/with-image")
        .header(header::CONTENT_TYPE, "image/png")
        .header(
            "x-raven-diet-metadata",
            r#"{"occurred_at":"2026-07-31T01:00:00Z","meal_type":"lunch","food_name":"Salad","path":"/tmp/private.png"}"#,
        )
        .body(Body::from(PNG))
        .unwrap();
    assert_eq!(
        app.oneshot(request).await.unwrap().status(),
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn diet_metadata_header_is_bounded_before_json_parsing() {
    let (_temp, app) = app();
    let request = Request::post("/api/v1/health/diet/with-image")
        .header(header::CONTENT_TYPE, "image/png")
        .header("x-raven-diet-metadata", "x".repeat(8 * 1024 + 1))
        .body(Body::from(PNG))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::REQUEST_HEADER_FIELDS_TOO_LARGE
    );
    let error = body(response).await;
    assert_eq!(error["code"], "header_too_large");
    assert!(error["request_id"].is_string());
}

#[tokio::test]
async fn service_detected_media_mismatch_is_unsupported_media() {
    let (_temp, app) = app();
    let metadata = json!({
        "occurred_at": "2026-07-31T01:00:00Z",
        "meal_type": "lunch",
        "food_name": "Salad"
    })
    .to_string();
    let request = Request::post("/api/v1/health/diet/with-image")
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header("x-raven-diet-metadata", metadata)
        .body(Body::from(PNG))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
    let error = body(response).await;
    assert_eq!(error["code"], "unsupported_media_type");
    assert!(error["request_id"].is_string());
}

#[tokio::test]
async fn diet_image_update_replaces_supported_images_and_removes_image() {
    let (temp, app) = app();
    let created = create_diet(&app).await;
    let id = created["id"].as_str().unwrap();
    let stale_updated_at = created["updated_at"].as_str().unwrap().to_string();
    let mut updated_at = created["updated_at"].as_str().unwrap().to_string();
    let mut media_id = None::<String>;

    for (content_type, bytes, food_name) in [
        ("image/png", PNG, "PNG Salad"),
        ("image/jpeg", JPEG, "JPEG Salad"),
        ("image/webp", WEBP, "WebP Salad"),
    ] {
        let metadata = json!({
            "food_name": food_name,
            "expected_updated_at": updated_at,
            "reason": "replace meal photo"
        })
        .to_string();
        let response = app
            .clone()
            .oneshot(
                Request::patch(format!("/api/v1/health/diet/{id}/with-image"))
                    .header(header::CONTENT_TYPE, content_type)
                    .header("x-raven-diet-metadata", metadata)
                    .body(Body::from(bytes))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let updated = body(response).await;
        assert_eq!(updated["food_name"], food_name);
        assert!(updated["media_id"].is_string());
        assert_ne!(updated["media_id"].as_str(), media_id.as_deref());
        media_id = updated["media_id"].as_str().map(str::to_string);
        updated_at = updated["updated_at"].as_str().unwrap().to_string();
    }

    let audit = get_diet_audit(&app, id).await;
    let latest = audit["items"].as_array().unwrap().last().unwrap();
    assert_eq!(latest["action"], "update");
    assert_eq!(latest["reason"], "replace meal photo");

    let before_stale = get_diet(&app, id).await;
    let media_before_stale = media_entries(&temp.path().join("media"));
    let stale = app
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/health/diet/{id}/with-image"))
                .header(header::CONTENT_TYPE, "image/png")
                .header(
                    "x-raven-diet-metadata",
                    json!({
                        "food_name": "Stale Salad",
                        "expected_updated_at": stale_updated_at,
                        "reason": "stale replacement"
                    })
                    .to_string(),
                )
                .body(Body::from(PNG))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(get_diet(&app, id).await, before_stale);
    assert_eq!(
        media_entries(&temp.path().join("media")),
        media_before_stale
    );
    assert_eq!(get_diet_audit(&app, id).await, audit);

    let response = app
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/health/diet/{id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "remove_image": true,
                        "expected_updated_at": updated_at,
                        "reason": "remove meal photo"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(body(response).await["media_id"].is_null());
}

#[tokio::test]
async fn diet_image_update_rejects_invalid_uploads_without_changing_entry() {
    let (temp, app) = app();
    let created = create_diet(&app).await;
    let id = created["id"].as_str().unwrap();
    let media = temp.path().join("media");
    let initial_media = media_entries(&media);
    let initial_audit = get_diet_audit(&app, id).await;
    let metadata = json!({"food_name": "Changed"}).to_string();
    let cases = [
        (
            "application/octet-stream",
            metadata.clone(),
            PNG.to_vec(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        ),
        (
            "image/png",
            metadata.clone(),
            Vec::new(),
            StatusCode::BAD_REQUEST,
        ),
        (
            "image/png",
            "{".to_string(),
            PNG.to_vec(),
            StatusCode::BAD_REQUEST,
        ),
        (
            "image/png",
            json!({"food_name": "Changed", "remove_image": true}).to_string(),
            PNG.to_vec(),
            StatusCode::BAD_REQUEST,
        ),
    ];

    for (content_type, metadata, bytes, expected_status) in cases {
        let response = app
            .clone()
            .oneshot(
                Request::patch(format!("/api/v1/health/diet/{id}/with-image"))
                    .header(header::CONTENT_TYPE, content_type)
                    .header("x-raven-diet-metadata", metadata)
                    .body(Body::from(bytes))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected_status);
        assert_eq!(get_diet(&app, id).await, created);
        assert_eq!(media_entries(&media), initial_media);
        assert_eq!(get_diet_audit(&app, id).await, initial_audit);
    }

    let response = app
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/health/diet/{id}/with-image"))
                .header(header::CONTENT_TYPE, "image/png")
                .header("x-raven-diet-metadata", metadata)
                .body(Body::from(vec![0_u8; 10 * 1024 * 1024 + 1]))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(get_diet(&app, id).await, created);
    assert_eq!(media_entries(&media), initial_media);
    assert_eq!(get_diet_audit(&app, id).await, initial_audit);
}

#[tokio::test]
async fn health_event_lifecycle_roundtrip_uses_service_policy() {
    let (_temp, app) = app();
    let create = Request::post("/api/v1/health/events")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "occurred_at": "2026-07-31T01:00:00Z",
                "details": {
                    "kind": "bowel",
                    "bristol_scale": 4
                }
            })
            .to_string(),
        ))
        .unwrap();
    let id = body(app.clone().oneshot(create).await.unwrap()).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    for action in ["archive", "restore", "archive"] {
        let response = app
            .clone()
            .oneshot(
                Request::post(format!("/api/v1/health/events/{id}/{action}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    let purge = Request::delete(format!("/api/v1/health/events/{id}/purge"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"confirmation": id}).to_string()))
        .unwrap();
    assert_eq!(
        app.oneshot(purge).await.unwrap().status(),
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn health_reports_return_complete_engine_projection() {
    let (_temp, app) = app();
    post_health_diet(&app, "2026-07-21T03:00:00Z", &["previous"]).await;
    post_health_diet(&app, "2026-07-22T03:00:00Z", &["shared", "fiber"]).await;
    post_health_event(
        &app,
        "2026-07-22T04:00:00Z",
        json!({"kind": "bowel", "bristol_scale": 6}),
    )
    .await;
    post_health_event(
        &app,
        "2026-07-22T05:00:00Z",
        json!({
            "kind": "medication",
            "medication_name": "Vitamin D",
            "dose": 1.0,
            "unit": "tablet"
        }),
    )
    .await;
    post_daily(
        &app,
        json!({"metrics": [{
            "occurred_at": "2026-07-21T00:00:00Z",
            "details": {"kind": "weight", "value": 69.0, "unit": "kg"}
        }]}),
    )
    .await;
    post_daily(
        &app,
        json!({"metrics": [
            {
                "occurred_at": "2026-07-22T00:00:00Z",
                "details": {"kind": "weight", "value": 68.0, "unit": "kg"}
            },
            {
                "occurred_at": "2026-07-22T00:00:00Z",
                "details": {"kind": "sleep", "value": 7.5}
            },
            {
                "occurred_at": "2026-07-22T00:00:00Z",
                "details": {"kind": "lab", "key": "crp", "name": "CRP", "value": 0.4, "unit": "mg/L"}
            },
            {
                "occurred_at": "2026-07-22T00:00:00Z",
                "details": {"kind": "lab", "key": "fecal_calprotectin", "name": "Fecal calprotectin", "value": 40.0, "unit": "ug/g"}
            },
            {
                "occurred_at": "2026-07-22T00:00:00Z",
                "details": {"kind": "overall_condition", "score": 8}
            }
        ]}),
    )
    .await;

    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/health/reports?from=2026-07-22&to=2026-08-20")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let report = body(response).await;
    assert_eq!(
        report["range"],
        json!({"from": [2026, 203], "to": [2026, 232]})
    );
    assert_eq!(
        report["previous_range"],
        json!({"from": [2026, 173], "to": [2026, 202]})
    );
    assert_eq!(report["diet_count"], json!({"current": 1, "previous": 1}));
    assert_eq!(
        report["bowel"],
        json!({
            "current_count": 1,
            "previous_count": null,
            "current_average": 6.0,
            "previous_average": null
        })
    );
    assert_eq!(
        report["medication_count"],
        json!({"current": 1, "previous": null})
    );
    let metrics = report["metrics"].as_array().unwrap();
    assert_eq!(metrics.len(), 5);
    assert_eq!(metrics[0]["metric"], "body_weight");
    assert_eq!(metrics[0]["current"]["value"], 68.0);
    assert_eq!(metrics[0]["previous"]["value"], 69.0);
    assert!(
        metrics[1..]
            .iter()
            .all(|metric| metric["previous"].is_null())
    );
    let series = report["metric_series"].as_array().unwrap();
    assert_eq!(series.len(), 5);
    assert_eq!(
        series
            .iter()
            .map(|item| item["metric"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "body_weight",
            "sleep_duration",
            "crp",
            "fecal_calprotectin",
            "overall_condition"
        ]
    );
    assert!(
        series
            .iter()
            .all(|item| item["points"].as_array().unwrap().len() == 1)
    );
    assert_eq!(
        report["bowel_points"],
        json!([{
            "local_date": [2026, 203],
            "occurred_at": "2026-07-22T04:00:00Z",
            "bristol_scale": 6
        }])
    );
    assert_eq!(
        report["medication_frequencies"],
        json!([{"name": "Vitamin D", "count": 1}])
    );
    assert_eq!(
        report["diet_tag_frequencies"],
        json!([
            {"name": "fiber", "count": 1},
            {"name": "shared", "count": 1}
        ])
    );
    assert_eq!(
        report["diet_tag_bowel_responses"],
        json!([
            {"tag": "fiber", "positive_meals": 1, "eligible_meals": 1, "rate": 1.0},
            {"tag": "shared", "positive_meals": 1, "eligible_meals": 1, "rate": 1.0}
        ])
    );
    assert_eq!(
        report["reaction_disclaimer"],
        "Observed associations only; they do not establish causation."
    );
}

#[tokio::test]
async fn health_reports_reject_invalid_queries_without_leaking_details() {
    let (_temp, app) = app();
    let cases = [
        ("to=2026-08-20", None),
        ("from=2026-07-22", None),
        ("from=2026-7-22&to=2026-08-20", Some("from")),
        ("from=2026-07-22&to=2026-02-30", Some("to")),
        ("from=2026-08-20&to=2026-07-22", None),
        ("from=2025-08-19&to=2026-08-20", None),
        (
            "from=2026-07-22&to=2026-08-20&path=C%3A%5Csecret.sqlite",
            None,
        ),
    ];
    for (query, expected_field) in cases {
        let response = app
            .clone()
            .oneshot(
                Request::get(format!("/api/v1/health/reports?{query}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{query}");
        let error = body(response).await;
        assert_eq!(error["code"], "validation_error", "{query}");
        assert_eq!(error["message"], "The request is invalid.", "{query}");
        assert!(error["request_id"].is_string(), "{query}");
        assert_eq!(
            error["fields"],
            expected_field
                .map(|field| json!({field: ["invalid"]}))
                .unwrap_or_else(|| json!({})),
            "{query}"
        );
        let rendered = error.to_string();
        assert!(!rendered.contains("secret.sqlite"), "{query}");
        assert!(!rendered.contains("SELECT"), "{query}");
        assert!(!rendered.contains("raven_session"), "{query}");
    }
}
