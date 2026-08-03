use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use raven_api::{AuthMode, RavenApiConfig, router};
use serde_json::{Value, json};
use tower::ServiceExt;

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

fn hold_exclusive_todo_lock(
    db_path: std::path::PathBuf,
) -> (std::sync::mpsc::SyncSender<()>, std::thread::JoinHandle<()>) {
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(0);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);
    let worker = std::thread::spawn(move || {
        let connection =
            todo_engine::infrastructure::sqlite::connect(db_path.to_str().unwrap()).unwrap();
        connection.execute_batch("BEGIN EXCLUSIVE").unwrap();
        ready_tx.send(()).unwrap();
        release_rx.recv().unwrap();
    });
    ready_rx.recv().unwrap();
    (release_tx, worker)
}

#[tokio::test]
async fn todo_items_are_nested_under_v1_without_router_side_effects() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("raven");
    let config = RavenApiConfig {
        todo_db: home.join("todo.sqlite"),
        ledger_db: home.join("ledger.sqlite"),
        health_db: home.join("health.sqlite"),
        health_media_dir: home.join("media"),
        local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
        auth: AuthMode::UiSession {
            token: "test".into(),
        },
    };
    let app = authenticated(router(config).unwrap());
    assert!(!home.exists());
    let mut requests = tokio::task::JoinSet::new();
    for _ in 0..8 {
        let app = app.clone();
        requests.spawn(async move {
            app.oneshot(
                Request::get("/api/v1/todo/items")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
        });
    }
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while let Some(response) = requests.join_next().await {
            assert_eq!(response.unwrap().status(), StatusCode::OK);
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn todo_memory_state_is_reused_across_cloned_raven_routers() {
    let temp = tempfile::tempdir().unwrap();
    let app = authenticated(
        router(RavenApiConfig {
            todo_db: ":memory:".into(),
            ledger_db: temp.path().join("ledger.sqlite"),
            health_db: temp.path().join("health.sqlite"),
            health_media_dir: temp.path().join("media"),
            local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
            auth: AuthMode::UiSession {
                token: "test".into(),
            },
        })
        .unwrap(),
    );
    let created = app
        .clone()
        .oneshot(
            Request::post("/api/v1/todo/areas")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"title":"Work","review_cycle":"weekly","standard":"Keep current"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);

    let response = app
        .oneshot(
            Request::get("/api/v1/todo/items")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let items: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert_eq!(items[0]["title"], "Work");
}

#[tokio::test]
async fn cancelled_first_todo_request_does_not_restart_initialization() {
    let temp = tempfile::tempdir().unwrap();
    let todo_db = temp.path().join("todo.sqlite");
    let (release, lock) = hold_exclusive_todo_lock(todo_db.clone());
    let app = authenticated(
        router(RavenApiConfig {
            todo_db: todo_db.clone(),
            ledger_db: temp.path().join("ledger.sqlite"),
            health_db: temp.path().join("health.sqlite"),
            health_media_dir: temp.path().join("media"),
            local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
            auth: AuthMode::UiSession {
                token: "test".into(),
            },
        })
        .unwrap(),
    );
    let first = tokio::spawn(
        app.clone().oneshot(
            Request::get("/api/v1/todo/health")
                .body(Body::empty())
                .unwrap(),
        ),
    );
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(!first.is_finished());
    first.abort();
    assert!(first.await.unwrap_err().is_cancelled());
    release.send(()).unwrap();
    lock.join().unwrap();

    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if todo_engine::infrastructure::sqlite::connect_read_only(todo_db.to_str().unwrap())
                .is_ok()
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();

    let (release, lock) = hold_exclusive_todo_lock(todo_db);
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        app.oneshot(
            Request::get("/api/v1/todo/health")
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await;
    release.send(()).unwrap();
    lock.join().unwrap();
    assert_eq!(response.unwrap().unwrap().status(), StatusCode::OK);
}

#[tokio::test]
async fn oversized_todo_json_uses_the_common_payload_envelope() {
    let temp = tempfile::tempdir().unwrap();
    let app = authenticated(
        router(RavenApiConfig {
            todo_db: temp.path().join("todo.sqlite"),
            ledger_db: temp.path().join("ledger.sqlite"),
            health_db: temp.path().join("health.sqlite"),
            health_media_dir: temp.path().join("media"),
            local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
            auth: AuthMode::UiSession {
                token: "test".into(),
            },
        })
        .unwrap(),
    );
    let response = app
        .oneshot(
            Request::post("/api/v1/todo/areas")
                .header("content-type", "application/json")
                .body(Body::from("x".repeat(129 * 1024)))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(response.headers()["content-type"], "application/json");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let error: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(error["code"], "payload_too_large");
    assert!(error["request_id"].is_string());
}

#[tokio::test]
async fn todo_mutation_and_validation_error_remain_nested_and_normalized() {
    let temp = tempfile::tempdir().unwrap();
    let app = authenticated(
        router(RavenApiConfig {
            todo_db: temp.path().join("todo.sqlite"),
            ledger_db: temp.path().join("ledger.sqlite"),
            health_db: temp.path().join("health.sqlite"),
            health_media_dir: temp.path().join("media"),
            local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
            auth: AuthMode::UiSession {
                token: "test".into(),
            },
        })
        .unwrap(),
    );
    let created = app
        .clone()
        .oneshot(
            Request::post("/api/v1/todo/areas")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"title":"Work","review_cycle":"weekly","standard":"Keep current"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);

    let parent = app
        .clone()
        .oneshot(
            Request::post("/api/v1/todo/goals/propose")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"title":"Parent","horizon":"month","scheduled":"2026-08-01"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(parent.status(), StatusCode::OK);
    let bytes = parent.into_body().collect().await.unwrap().to_bytes();
    let parent: Value = serde_json::from_slice(&bytes).unwrap();

    let invalid_goal = app
        .clone()
        .oneshot(
            Request::post("/api/v1/todo/goals/propose")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "Child",
                        "horizon": "month",
                        "scheduled": "2026-08-01",
                        "parent_id": parent["id"],
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid_goal.status(), StatusCode::BAD_REQUEST);
    let bytes = invalid_goal.into_body().collect().await.unwrap().to_bytes();
    let error: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(error["code"], "goal_parent_horizon_not_coarser");
    assert!(error["message"].as_str().unwrap().contains("horizon"));
    assert_eq!(error["fields"]["parent_horizon"], json!(["month"]));
    assert_eq!(error["fields"]["child_horizon"], json!(["month"]));
    assert!(error["request_id"].is_string());

    let invalid = app
        .oneshot(
            Request::post("/api/v1/todo/areas")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"title":"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    let bytes = invalid.into_body().collect().await.unwrap().to_bytes();
    let error: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(error["code"], "validation_error");
    assert!(error["request_id"].is_string());
}
