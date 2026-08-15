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
