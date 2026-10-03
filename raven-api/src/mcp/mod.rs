mod access;
mod catalog;
mod receipts;
mod schema;

pub use access::{McpAccessConfig, McpAccessConfigError};

/// Build the authenticated MCP endpoint without exposing the internal API router.
pub async fn router(
    config: crate::RavenApiConfig,
    access: McpAccessConfig,
) -> anyhow::Result<axum::Router> {
    router_with_auth(config, access::AccessAuth::load(access).await?)
}

fn router_with_auth(
    config: crate::RavenApiConfig,
    auth: access::AccessAuth,
) -> anyhow::Result<axum::Router> {
    use rmcp::transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    };
    let adapter = McpAdapter::new(config)?;
    let origin: axum::http::Uri = auth.origin().parse()?;
    let transport = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_max_request_body_bytes(16 * 1024 * 1024)
        .with_allowed_hosts([origin.authority().unwrap().as_str()])
        .with_allowed_origins([format!(
            "https://{}:{}",
            origin.host().unwrap(),
            origin.port_u16().unwrap_or(443)
        )]);
    let service: StreamableHttpService<McpAdapter, LocalSessionManager> =
        StreamableHttpService::new(move || Ok(adapter.clone()), Default::default(), transport);
    Ok(axum::Router::new().route_service("/mcp", service).layer(
        axum::middleware::from_fn_with_state(auth, access::authenticate),
    ))
}

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, header},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use rmcp::{
    ErrorData, RoleServer, ServerHandler,
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, Implementation, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
    },
    service::RequestContext,
};
use serde_json::{Value, json};
use std::sync::Arc;
use tower::ServiceExt;

use crate::{AuthMode, RavenApiConfig, SecretToken, UiSessionToken};

const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone)]
struct McpAdapter {
    api: Router,
    authorization: axum::http::HeaderValue,
    catalog: Arc<Vec<catalog::Spec>>,
    receipt_path: std::path::PathBuf,
}

impl McpAdapter {
    fn new(mut config: RavenApiConfig) -> anyhow::Result<Self> {
        // This credential never leaves the process. The MCP listener authenticates separately.
        let token = UiSessionToken::generate()?.cookie_value();
        config.auth = AuthMode::bearer(SecretToken::new(&token)?);
        let receipt_path = config
            .todo_db
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("retry.sqlite");
        Ok(Self {
            receipt_path,
            api: crate::router(config)?,
            authorization: format!("Bearer {token}").parse()?,
            catalog: Arc::new(catalog::build()),
        })
    }

    async fn call(&self, name: &str, args: Value) -> CallToolResult {
        let Some(spec) = self.catalog.iter().find(|spec| spec.tool.name == name) else {
            return failure("unknown_tool", "Unknown tool; read tools/list.", false);
        };
        if !spec.validator.is_valid(&args) {
            return failure(
                "validation_error",
                "Arguments do not match this tool's input schema; read tools/list and current choices.",
                false,
            );
        }
        let mut args = args;
        let has_timeout = args.get("timeout_seconds").is_some();
        let timeout = args
            .as_object_mut()
            .unwrap()
            .remove("timeout_seconds")
            .and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|n| n as u64)))
            .unwrap_or(120);
        if args.get("request_key").is_none() && has_timeout {
            return failure(
                "validation_error",
                "timeout_seconds requires request_key.",
                false,
            );
        }
        if let Some(key) = args.as_object_mut().unwrap().remove("request_key") {
            let key = key.as_str().unwrap().to_owned();
            let payload = receipts::fingerprint(name, &args);
            let path = self.receipt_path.clone();
            let claim_key = key.clone();
            let claim_payload = payload.clone();
            let claim = tokio::task::spawn_blocking(move || {
                receipts::claim(&path, &claim_key, &claim_payload)
            })
            .await;
            match claim {
                Ok(Ok(receipts::Claim::Replay(result))) => return result,
                Ok(Ok(receipts::Claim::Conflict)) => {
                    return failure(
                        "request_key_conflict",
                        "Request key belongs to different input. Use its original tool and input.",
                        false,
                    );
                }
                Ok(Ok(receipts::Claim::Pending)) => return receipts::unknown(),
                Ok(Ok(receipts::Claim::New)) => {}
                _ => return receipts::unknown(),
            }
            let result = match tokio::time::timeout(
                std::time::Duration::from_secs(timeout),
                self.execute(spec, name, args),
            )
            .await
            {
                Ok(result) => result,
                Err(_) => return receipts::unknown(),
            };
            let path = self.receipt_path.clone();
            let cached = result.clone();
            let saved = tokio::task::spawn_blocking(move || {
                receipts::finish(&path, &key, &payload, &cached)
            })
            .await;
            return match saved {
                Ok(Ok(())) => result,
                _ => receipts::unknown(),
            };
        }
        self.execute(spec, name, args).await
    }

    async fn execute(&self, spec: &catalog::Spec, name: &str, args: Value) -> CallToolResult {
        if matches!(
            name,
            "health_diet_image_create" | "health_diet_image_update" | "health_diet_image_get"
        ) {
            return self.image(spec, &args).await;
        }
        if spec.path.ends_with("/table/query") || name == "ledger_analysis" {
            let scoped = schema::table_for_scope(args["scope"].as_str().unwrap());
            if !jsonschema::is_valid(&scoped, &args) {
                return failure(
                    "validation_error",
                    "Query fields, sorts or groups do not match this scope; read its choices query_schema.",
                    false,
                );
            }
        }
        if name.starts_with("todo_") && name.ends_with("_update") {
            let kind = name.trim_start_matches("todo_").trim_end_matches("_update");
            let record = self
                .request(
                    "GET",
                    &format!(
                        "/api/v1/todo/items/{}",
                        segment(args["id"].as_str().unwrap())
                    ),
                    Value::Null,
                )
                .await;
            if record.is_error == Some(true) {
                return record;
            }
            if record
                .structured_content
                .as_ref()
                .is_none_or(|value| value["type"] != kind)
            {
                return failure(
                    "validation_error",
                    "Record type does not match this update tool.",
                    false,
                );
            }
        }
        if matches!(name, "health_bowel_update" | "health_medication_update") {
            let kind = name
                .trim_start_matches("health_")
                .trim_end_matches("_update");
            let record = self
                .request(
                    "GET",
                    &format!(
                        "/api/v1/health/events/{}",
                        segment(args["id"].as_str().unwrap())
                    ),
                    Value::Null,
                )
                .await;
            if record.is_error == Some(true) {
                return record;
            }
            if record
                .structured_content
                .as_ref()
                .is_none_or(|value| value["category"] != kind)
            {
                return failure(
                    "validation_error",
                    "Record kind does not match this update tool.",
                    false,
                );
            }
        }
        let mut body = args.as_object().unwrap().clone();
        let mut path = spec.path.clone();
        for key in ["id", "action", "record_type"] {
            if path.contains(&format!("{{{key}}}")) {
                let value = body.remove(key).unwrap();
                path = path.replace(&format!("{{{key}}}"), &segment(value.as_str().unwrap()));
            }
        }
        if spec.path.ends_with("/table/query") || name == "ledger_analysis" {
            let default_sorts = if name.starts_with("ledger_") {
                if args["scope"] == "ledger.transactions" {
                    json!([{"field":"date","direction":"desc"}])
                } else {
                    json!([{"field":"name","direction":"asc"}])
                }
            } else {
                json!([])
            };
            for (key, value) in [
                ("filters", json!([])),
                ("sorts", default_sorts),
                ("group_by", json!("none")),
                (
                    "group_settings",
                    json!({"sort":"alphabetical","hide_empty":false,"manual_order":[],"hidden_group_keys":[]}),
                ),
                ("context", json!({})),
            ] {
                body.entry(key.to_owned()).or_insert(value);
            }
        }
        if spec.method == "GET" && !body.is_empty() {
            let query = body
                .iter()
                .map(|(key, value)| {
                    let text = match value {
                        Value::String(value) => value.clone(),
                        _ => value.to_string(),
                    };
                    format!("{}={}", segment(key), segment(&text))
                })
                .collect::<Vec<_>>()
                .join("&");
            path.push('?');
            path.push_str(&query);
        }
        let result = self.request(spec.method, &path, Value::Object(body)).await;
        if name.ends_with("_choices") && result.is_error == Some(false) {
            return CallToolResult::structured(
                json!({"choices":result.structured_content,"query_schema":schema::table_for_scope(args["scope"].as_str().unwrap())}),
            );
        }
        result
    }

    async fn request(&self, method: &str, path: &str, body: Value) -> CallToolResult {
        let payload = if method == "GET" {
            Vec::new()
        } else {
            serde_json::to_vec(&body).expect("JSON value serializes")
        };
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::AUTHORIZATION, self.authorization.clone())
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(payload))
            .expect("catalog request is valid");
        let response = self
            .api
            .clone()
            .oneshot(request)
            .await
            .unwrap_or_else(|never| match never {});
        let mutation = method != "GET"
            && !path.ends_with("/table/query")
            && !path.ends_with("/table/analysis");
        self.json_response(response, mutation).await
    }

    async fn image(&self, spec: &catalog::Spec, args: &Value) -> CallToolResult {
        let path = spec
            .path
            .replace("{id}", &segment(args["id"].as_str().unwrap_or("")));
        let mut request = Request::builder()
            .method(spec.method)
            .uri(path)
            .header(header::AUTHORIZATION, self.authorization.clone());
        let payload = if spec.method == "GET" {
            Vec::new()
        } else {
            let Ok(bytes) = STANDARD.decode(args["image_base64"].as_str().unwrap()) else {
                return failure("validation_error", "Invalid base64 image.", false);
            };
            if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
                return failure(
                    "validation_error",
                    "Image must contain 1..10485760 bytes.",
                    false,
                );
            }
            // HTTP metadata header uses ASCII JSON, matching the UI upload adapter.
            let mut metadata = String::new();
            for ch in args["metadata"].to_string().chars() {
                if ch.is_ascii() {
                    metadata.push(ch);
                } else {
                    for unit in ch.encode_utf16(&mut [0; 2]) {
                        metadata.push_str(&format!("\\u{unit:04x}"));
                    }
                }
            }
            if metadata.len() > 8 * 1024 {
                return failure(
                    "validation_error",
                    "Image metadata exceeds 8192 bytes.",
                    false,
                );
            }
            request = request
                .header(header::CONTENT_TYPE, args["content_type"].as_str().unwrap())
                .header("x-raven-diet-metadata", metadata);
            bytes
        };
        let request = request
            .body(Body::from(payload))
            .expect("validated image request");
        let response = self
            .api
            .clone()
            .oneshot(request)
            .await
            .unwrap_or_else(|never| match never {});
        if spec.method != "GET" || !response.status().is_success() {
            return self.json_response(response, spec.method != "GET").await;
        }
        let mime = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_owned();
        if !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/webp") {
            return failure("response_unavailable", "Photo unavailable.", false);
        }
        match to_bytes(response.into_body(), 10 * 1024 * 1024).await {
            Ok(bytes) => CallToolResult::success(vec![rmcp::model::ContentBlock::image(
                STANDARD.encode(bytes),
                mime,
            )]),
            Err(_) => failure("response_unavailable", "Photo unavailable.", false),
        }
    }

    async fn json_response(
        &self,
        response: axum::response::Response,
        mutation: bool,
    ) -> CallToolResult {
        let status = response.status();
        if status == axum::http::StatusCode::NO_CONTENT {
            return CallToolResult::structured(json!({"ok":true}));
        }
        let Ok(bytes) = to_bytes(response.into_body(), MAX_RESPONSE_BYTES).await else {
            return failure(
                "response_unavailable",
                "Response unavailable. Inspect current records before retrying.",
                status.is_success() && mutation,
            );
        };
        let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
            return failure(
                "response_unavailable",
                "Response unavailable. Inspect current records before retrying.",
                status.is_success() && mutation,
            );
        };
        if status.is_success() {
            CallToolResult::structured(value)
        } else {
            CallToolResult::structured_error(value)
        }
    }
}

fn failure(code: &str, message: &str, committed: bool) -> CallToolResult {
    CallToolResult::structured_error(
        json!({"code":code,"message":message,"committed":committed,"retryable":false}),
    )
}

fn segment(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'~') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

impl ServerHandler for McpAdapter {
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info = Implementation::new("raven", env!("CARGO_PKG_VERSION"));
        info.instructions = Some("Raven personal engine. Read tool input schemas and choices before acting. Search existing records, select exact IDs, then read the record before editing. ToDo options(id) provides current UI status actions and edit fields. Follow pagination. Never guess dynamic choices. Preserve expected_updated_at for guarded mutations. Regular creates accept request_key for durable identical retries; without a key, search after a lost response. Pending receipts never re-execute. Transfers reuse operation_key. Daily metrics use health_daily_upsert only. Permanent account-category purge requires user authorization and preview confirmation.".into());
        info
    }

    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        if request.is_some_and(|request| request.cursor.is_some()) {
            return Err(ErrorData::invalid_params("Unknown tool-list cursor", None));
        }
        Ok(ListToolsResult {
            tools: self.catalog.iter().map(|spec| spec.tool.clone()).collect(),
            ..Default::default()
        })
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.catalog
            .iter()
            .find(|spec| spec.tool.name == name)
            .map(|spec| spec.tool.clone())
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        if !self
            .catalog
            .iter()
            .any(|spec| spec.tool.name == request.name)
        {
            return Err(ErrorData::invalid_params(
                "Unknown tool; read tools/list",
                None,
            ));
        }
        Ok(self
            .call(
                &request.name,
                Value::Object(request.arguments.unwrap_or_default()),
            )
            .await
            .into())
    }
}

#[cfg(test)]
mod tests;
