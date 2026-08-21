use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use http_body_util::BodyExt;
use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateTransactionCategory,
};
use ledger_engine::application::service::LedgerService;
use ledger_engine::domain::{Money, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use raven_api::{AuthMode, RavenApiConfig, router};
use serde_json::{Value, json};
use tower::ServiceExt;

fn app() -> (tempfile::TempDir, axum::Router) {
    let temp = tempfile::tempdir().unwrap();
    let ledger = temp.path().join("ledger.sqlite");
    let mut service = LedgerService::new(SqliteLedgerRepository::open(&ledger).unwrap());
    let currency = service
        .create_currency(CreateCurrency {
            code: "KRW".into(),
            name: "Won".into(),
            symbol: "₩".into(),
            decimal_places: 0,
            actor: "test".into(),
        })
        .unwrap();
    let account_category = service
        .create_account_category(CreateAccountCategory {
            name: "Cash".into(),
            parent: None,
            liability: false,
            actor: "test".into(),
        })
        .unwrap();
    service
        .create_account(CreateAccount {
            name: "Wallet".into(),
            category: account_category.id().into(),
            currency: currency.id().into(),
            opening_balance: Money::from_minor_units(0),
            actor: "test".into(),
        })
        .unwrap();
    service
        .create_account(CreateAccount {
            name: "Savings".into(),
            category: account_category.id().into(),
            currency: currency.id().into(),
            opening_balance: Money::from_minor_units(0),
            actor: "test".into(),
        })
        .unwrap();
    service
        .create_category(CreateTransactionCategory {
            name: "Food".into(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "test".into(),
        })
        .unwrap();
    service
        .create_category(CreateTransactionCategory {
            name: "Salary".into(),
            parent: None,
            kind: TransactionCategoryKind::Income,
            actor: "test".into(),
        })
        .unwrap();
    SqliteHealthRepository::open(temp.path().join("health.sqlite")).unwrap();
    let config = RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: ledger,
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

fn table_query(scope: &str) -> Value {
    let (sort, group_by) = match scope {
        "ledger.transactions" => ("date", "none"),
        "ledger.accounts" | "ledger.categories" => ("name", "none"),
        _ => unreachable!(),
    };
    json!({
        "scope": scope,
        "offset": 0,
        "limit": 50,
        "filter_mode": "and",
        "filters": [],
        "sorts": [{"field": sort, "direction": "asc"}],
        "group_by": group_by,
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
async fn table_query_serves_all_ledger_scopes_without_changing_legacy_lists() {
    let (_temp, app) = app();
    assert_eq!(
        post_json(
            &app,
            "/api/v1/ledger/entries",
            json!({
                "date":"2026-08-21", "written_at":"2026-08-21T00:00:00Z",
                "content":"Lunch", "category":"Food", "account":"Wallet",
                "entry_type":"expense", "amount":"12000", "currency":"KRW"
            }),
        )
        .await
        .status(),
        StatusCode::CREATED
    );
    for (scope, record_field) in [
        ("ledger.transactions", "content"),
        ("ledger.accounts", "name"),
        ("ledger.categories", "name"),
    ] {
        let response = post_json(&app, "/api/v1/ledger/table/query", table_query(scope)).await;
        assert_eq!(response.status(), StatusCode::OK, "{scope}");
        let value = body(response).await;
        assert!(value["items"].is_array());
        assert!(value.get("next_offset").is_some());
        if let Some(first) = value["items"].as_array().unwrap().first() {
            assert!(first["key"].is_string());
            assert!(first["record"][record_field].is_string());
        }
    }

    for path in [
        "/api/v1/ledger/currencies",
        "/api/v1/ledger/accounts",
        "/api/v1/ledger/transaction-categories",
    ] {
        let response = app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let value = body(response).await;
        assert!(value["items"].is_array());
        assert!(value.get("next_offset").is_some());
    }
}

#[tokio::test]
async fn table_query_rejects_unknown_nested_fields_and_oversized_pages() {
    let (_temp, app) = app();
    for pointer in [
        "",
        "/context",
        "/filters/0",
        "/filters/0/value",
        "/sorts/0",
        "/group_settings",
    ] {
        let mut query = table_query("ledger.transactions");
        if pointer.starts_with("/filters/0") {
            query["filters"] =
                json!([{"field":"content","operator":"contains","value":{"text":"x"}}]);
        }
        query
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unexpected".into(), json!(true));
        let response = post_json(&app, "/api/v1/ledger/table/query", query).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{pointer}");
    }
    for (operator, value) in [
        (
            "is_between",
            json!({"range":{"start":"2026-01-01","end":"2026-01-02","unexpected":true}}),
        ),
        (
            "is_relative_to_today",
            json!({"relative":{"amount":"1","unit":"day","unexpected":true}}),
        ),
    ] {
        let mut query = table_query("ledger.transactions");
        query["filters"] = json!([{"field":"date","operator":operator,"value":value}]);
        let response = post_json(&app, "/api/v1/ledger/table/query", query).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    let mut query = table_query("ledger.accounts");
    query["limit"] = json!(51);
    let response = post_json(&app, "/api/v1/ledger/table/query", query).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    for (field, target) in [("current_balance", "sorts"), ("kind", "group_by")] {
        let mut query = table_query("ledger.transactions");
        if target == "sorts" {
            query["sorts"][0]["field"] = json!(field);
        } else {
            query["group_by"] = json!(field);
        }
        let response = post_json(&app, "/api/v1/ledger/table/query", query).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}

#[tokio::test]
async fn table_query_validates_scope_filter_values_and_local_relative_dates() {
    let (_temp, app) = app();
    let invalid_filters = [
        json!({"field":"date","operator":"contains","value":{"text":"2026-08-21"}}),
        json!({"field":"amount","operator":"greater_than","value":{"text":"not-money"}}),
        json!({"field":"account","operator":"is","value":{"range":{"start":"a","end":"b"}}}),
    ];
    for filter in invalid_filters {
        let mut query = table_query("ledger.transactions");
        query["filters"] = json!([filter]);
        let response = post_json(&app, "/api/v1/ledger/table/query", query).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let error = body(response).await.to_string();
        assert!(
            !error.contains("not-money") && !error.contains("SELECT") && !error.contains("sqlite")
        );
    }

    let relative = json!({
        "field":"date", "operator":"is_relative_to_today",
        "value":{"relative":{"amount":"1","unit":"day"}}
    });
    let mut missing_reference = table_query("ledger.transactions");
    missing_reference["filters"] = json!([relative.clone()]);
    missing_reference["context"] = json!({});
    assert_eq!(
        post_json(&app, "/api/v1/ledger/table/query", missing_reference)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );

    let create = json!({
        "date": "2026-01-02", "written_at": "2025-12-31T23:30:00Z",
        "content": "local-calendar", "category": "Food", "account": "Wallet",
        "entry_type": "expense", "amount": "1", "currency": "KRW"
    });
    assert_eq!(
        post_json(&app, "/api/v1/ledger/entries", create)
            .await
            .status(),
        StatusCode::CREATED
    );

    let mut fixed_reference = table_query("ledger.transactions");
    fixed_reference["filters"] = json!([relative]);
    fixed_reference["context"] = json!({"reference_date":"2026-01-01"});
    let response = post_json(&app, "/api/v1/ledger/table/query", fixed_reference).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        body(response).await["items"][0]["record"]["content"],
        "local-calendar"
    );
}

#[tokio::test]
async fn ledger_table_routes_bound_bodies_and_return_compact_active_lookups() {
    let (_temp, app) = app();
    let oversized = Request::post("/api/v1/ledger/table/query")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(format!(
            r#"{{"padding":"{}"}}"#,
            "x".repeat(128 * 1024)
        )))
        .unwrap();
    let response = app.clone().oneshot(oversized).await.unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let error = body(response).await;
    assert_eq!(error["message"], "The request is invalid.");

    let created = post_json(
        &app,
        "/api/v1/ledger/currencies",
        json!({
            "code":"ZZZ", "name":"Inactive lookup", "symbol":"Z", "decimal_places":0
        }),
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let inactive_id = body(created).await["id"].as_str().unwrap().to_string();
    let deactivate = app
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/ledger/currencies/{inactive_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({"active":false}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(deactivate.status(), StatusCode::OK);

    for (scope, expected, absent) in [
        ("ledger.transactions", "accounts", "account_types"),
        ("ledger.accounts", "account_types", "categories"),
        ("ledger.categories", "categories", "currencies"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::get(format!("/api/v1/ledger/table/lookups?scope={scope}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let value = body(response).await;
        assert!(value[expected].is_array());
        assert!(value.get(absent).is_none());
        for values in value.as_object().unwrap().values() {
            for option in values.as_array().unwrap() {
                assert_eq!(option.as_object().unwrap().len(), 2);
                assert!(option["id"].is_string() && option["label"].is_string());
                assert_ne!(option["id"], inactive_id);
            }
        }
    }
    let bad = app
        .oneshot(
            Request::get("/api/v1/ledger/table/lookups?scope=ledger.unknown&extra=x")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_entry_uses_service_and_writes_audit() {
    let (_temp, app) = app();
    let request = Request::post("/api/v1/ledger/entries")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "date": "2026-07-31",
                "written_at": "2026-07-31T01:00:00Z",
                "content": "Lunch",
                "category": "Food",
                "account": "Wallet",
                "entry_type": "expense",
                "amount": "12000",
                "currency": "KRW"
            })
            .to_string(),
        ))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let id = body(response).await["id"].as_str().unwrap().to_string();

    let response = app
        .oneshot(
            Request::get(format!("/api/v1/ledger/audit/ledger_entry/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body(response).await["items"][0]["action"], "create");
}

#[tokio::test]
async fn unknown_fields_and_oversized_json_are_rejected() {
    let (_temp, app) = app();
    let unknown = Request::post("/api/v1/ledger/entries")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"id":"client-owned"}"#))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(unknown).await.unwrap().status(),
        StatusCode::BAD_REQUEST
    );
    let oversized = Request::post("/api/v1/ledger/entries")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("x".repeat(129 * 1024)))
        .unwrap();
    assert_eq!(
        app.oneshot(oversized).await.unwrap().status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
}

#[tokio::test]
async fn reports_and_purge_preview_have_stable_surfaces() {
    let (_temp, app) = app();
    for path in [
        "/api/v1/ledger/reports/compare?current_from=2026-07-01&current_to=2026-07-31&previous_from=2026-06-01&previous_to=2026-06-30",
        "/api/v1/ledger/reports/briefing?from=2026-07-01&to=2026-07-31",
    ] {
        let response = app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    let create = Request::post("/api/v1/ledger/entries")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "date": "2026-07-31",
                "written_at": "2026-07-31T01:00:00Z",
                "content": "Lunch",
                "category": "Food",
                "account": "Wallet",
                "entry_type": "expense",
                "amount": "12000",
                "currency": "KRW"
            })
            .to_string(),
        ))
        .unwrap();
    let id = body(app.clone().oneshot(create).await.unwrap()).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let comparison = app
        .clone()
        .oneshot(
            Request::get(
                "/api/v1/ledger/reports/compare?current_from=2026-07-01&current_to=2026-07-31&previous_from=2026-06-01&previous_to=2026-06-30",
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(comparison.status(), StatusCode::OK);
    let comparison = body(comparison).await;
    assert_eq!(comparison["current"]["currencies"][0]["decimal_places"], 0);
    assert_eq!(comparison["currencies"][0]["current"]["decimal_places"], 0);
    let response = app
        .oneshot(
            Request::get(format!("/api/v1/ledger/entries/{id}/purge"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body(response).await["confirmation_id"], id);
}

#[tokio::test]
async fn account_balances_preserve_precision_for_an_inactive_currency() {
    let (_temp, app) = app();
    let currency = app
        .clone()
        .oneshot(
            Request::post("/api/v1/ledger/currencies")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "code": "USD",
                        "name": "US Dollar",
                        "symbol": "$",
                        "decimal_places": 2,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(currency.status(), StatusCode::CREATED);
    let currency_id = body(currency).await["id"].as_str().unwrap().to_string();

    let categories = app
        .clone()
        .oneshot(
            Request::get("/api/v1/ledger/account-categories")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let category_id = body(categories).await["items"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let account = app
        .clone()
        .oneshot(
            Request::post("/api/v1/ledger/accounts")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "name": "Dollar card",
                        "category": category_id,
                        "currency": currency_id,
                        "opening_balance": "12.34",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(account.status(), StatusCode::CREATED);
    let account_id = body(account).await["id"].as_str().unwrap().to_string();

    let deactivate = app
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/ledger/currencies/{currency_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"active":false}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(deactivate.status(), StatusCode::OK);

    let balances = app
        .clone()
        .oneshot(
            Request::get("/api/v1/ledger/account-balances")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let balances = body(balances).await;
    let dollar_card = balances["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["account"]["id"] == account_id)
        .unwrap();
    assert_eq!(dollar_card["decimal_places"], 2);
    assert_eq!(dollar_card["current_balance_minor"], 1_234);

    let currencies = app
        .oneshot(
            Request::get("/api/v1/ledger/currencies")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        body(currencies).await["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|currency| currency["code"] != "USD")
    );
}

#[tokio::test]
async fn report_comparison_accepts_presets_and_equal_length_custom_ranges() {
    let (_temp, app) = app();
    let legacy = app
        .clone()
        .oneshot(
            Request::get(
                "/api/v1/ledger/reports/compare?current_from=2026-07-01&current_to=2026-07-31&previous_from=2026-06-01&previous_to=2026-06-30",
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(legacy.status(), StatusCode::OK);
    assert_eq!(
        body(legacy).await["current"]["range"]["start"],
        json!([2026, 182])
    );

    let preset = app
        .clone()
        .oneshot(
            Request::get("/api/v1/ledger/reports/compare?period=current_month")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(preset.status(), StatusCode::OK);

    let custom = app
        .oneshot(
            Request::get(
                "/api/v1/ledger/reports/compare?period=custom&from=2024-03-01&to=2024-03-03",
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(custom.status(), StatusCode::OK);
    let custom = body(custom).await;
    assert_eq!(custom["current"]["range"]["start"], json!([2024, 61]));
    assert_eq!(custom["current"]["range"]["end"], json!([2024, 63]));
    assert_eq!(custom["previous"]["range"]["start"], json!([2024, 58]));
    assert_eq!(custom["previous"]["range"]["end"], json!([2024, 60]));
    assert_eq!(custom["currencies"], json!([]));
}

#[tokio::test]
async fn report_trend_returns_stable_empty_series_and_rejects_unsafe_queries() {
    let (_temp, app) = app();
    let response = app
        .clone()
        .oneshot(
            Request::get(
                "/api/v1/ledger/reports/trend?from=2026-07-01&to=2026-07-31&granularity=daily",
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = body(response).await;
    assert_eq!(response["granularity"], "daily");
    assert_eq!(response["currencies"], json!([]));

    for path in [
        "/api/v1/ledger/reports/trend?from=2026-07-31&to=2026-07-01",
        "/api/v1/ledger/reports/trend?from=2026-07-01&to=2026-07-31&granularity=hourly",
        "/api/v1/ledger/reports/trend?from=2024-01-01&to=2025-01-01&granularity=daily",
        "/api/v1/ledger/reports/compare?period=custom&from=2026-07-01",
        "/api/v1/ledger/reports/compare?period=current_month&unexpected=value",
    ] {
        let response = app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = body(response).await;
        assert_eq!(response["code"], "validation_error");
        assert_eq!(response["message"], "The request is invalid.");
    }
}

#[tokio::test(flavor = "current_thread")]
async fn sqlite_requests_complete_concurrently_off_the_async_executor() {
    let (_temp, app) = app();
    let request = || {
        Request::get("/api/v1/ledger/entries")
            .body(Body::empty())
            .unwrap()
    };
    let (left, right) = tokio::join!(
        app.clone().oneshot(request()),
        app.clone().oneshot(request())
    );
    assert_eq!(left.unwrap().status(), StatusCode::OK);
    assert_eq!(right.unwrap().status(), StatusCode::OK);
}

#[tokio::test]
async fn reserved_transfer_row_types_are_rejected_at_create_and_update_boundaries() {
    let (_temp, app) = app();
    for entry_type in ["transfer_in", "transfer_out"] {
        let create = Request::post("/api/v1/ledger/entries")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "date": "2026-07-31",
                    "written_at": "2026-07-31T01:00:00Z",
                    "content": "hostile",
                    "account": "Wallet",
                    "entry_type": entry_type,
                    "amount": "1",
                    "currency": "KRW"
                })
                .to_string(),
            ))
            .unwrap();
        assert_eq!(
            app.clone().oneshot(create).await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );
        let update = Request::patch("/api/v1/ledger/entries/not-an-id")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({"entry_type": entry_type}).to_string()))
            .unwrap();
        assert_eq!(
            app.clone().oneshot(update).await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );
    }
}

#[tokio::test]
async fn raw_query_is_bounded_before_percent_decoding() {
    let (_temp, app) = app();
    let query = "%41".repeat(3_000);
    let response = app
        .oneshot(
            Request::get(format!("/api/v1/ledger/entries?content={query}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::URI_TOO_LONG);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
    let error = body(response).await;
    assert_eq!(error["code"], "uri_too_long");
    assert!(error["request_id"].is_string());
}

#[tokio::test]
async fn summary_rejects_mixed_incomplete_and_invalid_selectors() {
    let (_temp, app) = app();
    for path in [
        "/api/v1/ledger/reports/summary?year=2026&month=7&from=2026-07-01&to=2026-07-31",
        "/api/v1/ledger/reports/summary?year=2026",
        "/api/v1/ledger/reports/summary?from=2026-07-01",
        "/api/v1/ledger/reports/summary?from=not-a-date&to=2026-07-31",
    ] {
        assert_eq!(
            app.clone()
                .oneshot(Request::get(path).body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
}

#[tokio::test]
async fn entry_update_preserves_explicit_null_clear_semantics() {
    let (_temp, app) = app();
    let create = Request::post("/api/v1/ledger/entries")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "date": "2026-07-31",
                "written_at": "2026-07-31T01:00:00Z",
                "content": "Salary",
                "category": "Salary",
                "account": "Wallet",
                "entry_type": "income",
                "amount": "1",
                "currency": "KRW",
                "notes": "clear me"
            })
            .to_string(),
        ))
        .unwrap();
    let id = body(app.clone().oneshot(create).await.unwrap()).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let update = Request::patch(format!("/api/v1/ledger/entries/{id}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"notes":null}"#))
        .unwrap();
    let response = app.oneshot(update).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(body(response).await["notes"].is_null());
}

#[tokio::test]
async fn update_transfer_changes_the_pair_through_one_strict_safe_route() {
    let (_temp, app) = app();
    let create = Request::post("/api/v1/ledger/transfers")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "operation_key": "10000000-0000-4000-8000-000000000001",
                "date": "2026-07-31",
                "written_at": "2026-07-31T01:00:00Z",
                "content": "Move savings",
                "from_account": "Wallet",
                "to_account": "Savings",
                "amount": "12000",
                "currency": "KRW"
            })
            .to_string(),
        ))
        .unwrap();
    let response = app.clone().oneshot(create).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let group_id = body(response).await["transfer_group_id"]
        .as_str()
        .unwrap()
        .to_string();

    let update = Request::patch(format!("/api/v1/ledger/transfers/{group_id}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "date": "2026-08-15",
                "content": "Move more savings",
                "from_account": "Savings",
                "to_account": "Wallet",
                "amount": "25000",
                "currency": "KRW",
                "notes": null
            })
            .to_string(),
        ))
        .unwrap();
    let response = app.clone().oneshot(update).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let updated = body(response).await;
    assert_eq!(updated["transfer_group_id"], group_id);
    assert_eq!(updated["amount_minor"], 25_000);
    assert_eq!(updated["from_account_name"], "Savings");
    assert_eq!(updated["to_account_name"], "Wallet");
    assert_eq!(
        updated["out_entry"]["entry"]["content"],
        "Move more savings"
    );
    assert_eq!(updated["in_entry"]["entry"]["content"], "Move more savings");

    let unknown = Request::patch(format!("/api/v1/ledger/transfers/{group_id}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"internal_id":"hostile"}"#))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(unknown).await.unwrap().status(),
        StatusCode::BAD_REQUEST
    );

    let missing = Request::patch("/api/v1/ledger/transfers/missing")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "date": "2026-08-15",
                "content": "Missing",
                "from_account": "Savings",
                "to_account": "Wallet",
                "amount": "25000",
                "currency": "KRW"
            })
            .to_string(),
        ))
        .unwrap();
    let response = app.oneshot(missing).await.unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let error = body(response).await;
    assert_eq!(error["code"], "not_found");
    assert_eq!(error["message"], "The requested record was not found.");
}

#[tokio::test]
async fn reference_update_preview_and_purge_roundtrip() {
    let (_temp, app) = app();
    let create = Request::post("/api/v1/ledger/currencies")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "code": "USD",
                "name": "US Dollar",
                "symbol": "$",
                "decimal_places": 2
            })
            .to_string(),
        ))
        .unwrap();
    let id = body(app.clone().oneshot(create).await.unwrap()).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let update = Request::patch(format!("/api/v1/ledger/currencies/{id}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"active":false}"#))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(update).await.unwrap().status(),
        StatusCode::OK
    );
    let preview = app
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/ledger/currencies/{id}/purge"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(body(preview).await["confirmation_id"], id);
    let purge = Request::delete(format!("/api/v1/ledger/currencies/{id}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"confirmation": id}).to_string()))
        .unwrap();
    assert_eq!(
        app.oneshot(purge).await.unwrap().status(),
        StatusCode::NO_CONTENT
    );
}
