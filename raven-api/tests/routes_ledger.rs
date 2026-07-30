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
        .create_category(CreateTransactionCategory {
            name: "Food".into(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "test".into(),
        })
        .unwrap();
    SqliteHealthRepository::open(temp.path().join("health.sqlite")).unwrap();
    let config = RavenApiConfig {
        todo_db: temp.path().join("todo.sqlite"),
        ledger_db: ledger,
        health_db: temp.path().join("health.sqlite"),
        health_media_dir: temp.path().join("media"),
        auth: AuthMode::UiSession {
            token: "test".into(),
        },
    };
    (temp, router(config).unwrap())
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
