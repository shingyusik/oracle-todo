//! CLI ⇄ MCP contract harness. One temp home is driven through the `raven` binary (JSON
//! output) and through the real MCP HTTP transport (Access middleware, scope policy and
//! JSON-RPC initialize → tools/list → tools/call). Volatile IDs and generated timestamps are
//! normalized before results and audit records are compared.
#![allow(dead_code)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use raven_api::{AuthMode, RavenApiConfig, mcp::contract_support};
use serde_json::{Value, json};
use tower::ServiceExt;

pub struct Home {
    _temp: tempfile::TempDir,
    pub path: PathBuf,
    mcp: contract_support::LocalMcp,
}

impl Home {
    /// Fresh initialized home with an MCP router over the same stores.
    pub async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().to_path_buf();
        let output = raven(&path, &["init"]);
        assert!(output.0 == 0, "init failed: {}", output.1);
        let mcp = contract_support::local_router(RavenApiConfig {
            todo_db: path.join("todo.sqlite"),
            ledger_db: path.join("ledger.sqlite"),
            health_db: path.join("health.sqlite"),
            health_media_dir: path.join("media/health"),
            local_offset: time::UtcOffset::from_hms(9, 0, 0).unwrap(),
            auth: AuthMode::ui_session(&raven_api::UiSessionToken::generate().unwrap()),
        })
        .unwrap();
        let home = Self {
            _temp: temp,
            path,
            mcp,
        };
        let init = home.rpc("initialize", json!({"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"contract","version":"1"}})).await;
        assert_eq!(init["result"]["serverInfo"]["name"], "raven", "{init}");
        home
    }

    /// CLI success: parsed JSON stdout.
    pub fn cli(&self, args: &[&str]) -> Value {
        let (code, stdout, stderr) = raven_full(&self.path, args);
        assert_eq!(code, 0, "{args:?}\nstdout: {stdout}\nstderr: {stderr}");
        serde_json::from_str(&stdout)
            .unwrap_or_else(|_| panic!("{args:?} printed non-JSON: {stdout}"))
    }

    /// Exit code, stdout and stderr, each parsed as JSON when possible.
    pub fn cli_raw(&self, args: &[&str]) -> (i32, Value, Value) {
        let (code, stdout, stderr) = raven_full(&self.path, args);
        let parse = |text: &str| serde_json::from_str(text.trim()).unwrap_or(Value::Null);
        (code, parse(&stdout), parse(&stderr))
    }

    /// CLI failure: exit code and the JSON error object on stderr.
    pub fn cli_err(&self, args: &[&str]) -> (i32, Value) {
        let (code, stdout, stderr) = raven_full(&self.path, args);
        assert_ne!(code, 0, "{args:?} unexpectedly succeeded: {stdout}");
        let error = serde_json::from_str(stderr.trim())
            .unwrap_or_else(|_| panic!("{args:?} stderr is not one JSON error: {stderr}"));
        (code, error)
    }

    /// Raw JSON-RPC exchange through the MCP HTTP transport; asserts HTTP 200.
    pub async fn rpc(&self, method: &str, params: Value) -> Value {
        let request = Request::builder()
            .method("POST")
            .uri("/mcp")
            .header("host", contract_support::HOST)
            .header("accept", "application/json, text/event-stream")
            .header("content-type", "application/json")
            .header("mcp-protocol-version", "2025-11-25")
            .header("cf-access-jwt-assertion", &self.mcp.assertion)
            .body(Body::from(
                json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
            ))
            .unwrap();
        let response = self.mcp.router.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{method}");
        let bytes = axum::body::to_bytes(response.into_body(), 16 * 1024 * 1024)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    pub async fn tools(&self) -> Vec<Value> {
        let listed = self.rpc("tools/list", json!({})).await;
        listed["result"]["tools"].as_array().unwrap().clone()
    }

    pub async fn tool(&self, name: &str) -> Value {
        self.tools()
            .await
            .into_iter()
            .find(|tool| tool["name"] == name)
            .unwrap_or_else(|| panic!("{name} is not listed"))
    }

    /// tools/call result object (`isError`, `structuredContent`, `content`).
    pub async fn call(&self, name: &str, arguments: Value) -> Value {
        let called = self
            .rpc("tools/call", json!({"name":name,"arguments":arguments}))
            .await;
        assert!(called["error"].is_null(), "{name}: {called}");
        called["result"].clone()
    }

    pub async fn mcp(&self, name: &str, arguments: Value) -> Value {
        let result = self.call(name, arguments.clone()).await;
        assert_eq!(result["isError"], false, "{name} {arguments}: {result}");
        result["structuredContent"].clone()
    }

    pub async fn mcp_err(&self, name: &str, arguments: Value) -> Value {
        let result = self.call(name, arguments.clone()).await;
        assert_eq!(result["isError"], true, "{name} {arguments}: {result}");
        result["structuredContent"].clone()
    }
}

pub fn raven(home: &Path, args: &[&str]) -> (i32, String) {
    let (code, stdout, stderr) = raven_full(home, args);
    (code, format!("{stdout}{stderr}"))
}

fn raven_full(home: &Path, args: &[&str]) -> (i32, String, String) {
    // UTC keeps the CLI's local "today" identical to the caller-supplied MCP date.
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .env("RAVEN_CONSOLE_LOG", "off")
        .env("TZ", "UTC")
        .args(["--home", home.to_str().unwrap(), "--error-format", "json"])
        .args(args)
        .output()
        .unwrap();
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8(output.stdout).unwrap(),
        String::from_utf8(output.stderr).unwrap(),
    )
}

/// Today's date as the CLI computes it under `TZ=UTC`.
pub fn today() -> time::Date {
    time::OffsetDateTime::now_utc().date()
}

pub fn day(offset: i64) -> String {
    (today() + time::Duration::days(offset)).to_string()
}

/// Replace generated IDs (by first appearance) and generated timestamps so that two homes
/// that ran the same operations compare equal.
pub fn normalize(value: &Value) -> Value {
    fn walk(value: &Value, ids: &mut HashMap<String, String>) -> Value {
        match value {
            Value::String(text) if is_generated_id(text) => {
                let next = format!("<id:{}>", ids.len());
                Value::String(ids.entry(text.clone()).or_insert(next).clone())
            }
            Value::String(text) if is_generated_timestamp(text) => json!("<ts>"),
            Value::Array(items) => Value::Array(items.iter().map(|v| walk(v, ids)).collect()),
            Value::Object(map) => Value::Object(
                map.iter()
                    .map(|(key, value)| (key.clone(), walk(value, ids)))
                    .collect(),
            ),
            other => other.clone(),
        }
    }
    walk(value, &mut HashMap::new())
}

fn is_generated_id(text: &str) -> bool {
    let hex = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_hexdigit());
    let uuid = text.len() == 36
        && text.split('-').map(str::len).collect::<Vec<_>>() == [8, 4, 4, 4, 12]
        && text.split('-').all(hex);
    let prefixed = text.rsplit_once('_').is_some_and(|(prefix, tail)| {
        !prefix.is_empty()
            && prefix.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
            && tail.len() >= 12
            && hex(tail)
    });
    uuid || prefixed
}

fn is_generated_timestamp(text: &str) -> bool {
    // Fixture timestamps are whole seconds; generated ones carry fractional seconds.
    text.contains('.')
        && time::OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339).is_ok()
}

/// Exact CLI error code equals the MCP structured error code.
pub fn same_error(cli: &(i32, Value), mcp: &Value, expected: &str) {
    assert_eq!(cli.1["code"], expected, "CLI {cli:?}");
    assert_eq!(mcp["code"], expected, "MCP {mcp}");
}
