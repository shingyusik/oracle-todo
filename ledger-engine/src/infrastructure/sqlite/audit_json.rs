use serde_json::Value;

/// Bound each persisted audit snapshot to 1 MiB of UTF-8 JSON.
///
/// Schema health checks this byte limit in SQLite before loading payloads,
/// then this codec applies the same limit at every repository decode/write.
pub(super) const AUDIT_JSON_MAX_BYTES: usize = 1024 * 1024;

pub(super) fn decode_optional(value: Option<&str>) -> Result<Option<Value>, String> {
    value.map(decode).transpose()
}

pub(super) fn encode_optional(value: Option<&Value>) -> Result<Option<String>, String> {
    value.map(encode).transpose()
}

fn decode(value: &str) -> Result<Value, String> {
    validate_size(value)?;
    serde_json::from_str::<Value>(value).map_err(|error| error.to_string())
}

fn encode(value: &Value) -> Result<String, String> {
    let encoded = serde_json::to_string(value).map_err(|error| error.to_string())?;
    validate_size(&encoded)?;
    Ok(encoded)
}

fn validate_size(value: &str) -> Result<(), String> {
    if value.len() > AUDIT_JSON_MAX_BYTES {
        return Err(format!(
            "audit JSON exceeds the maximum size of {AUDIT_JSON_MAX_BYTES} bytes"
        ));
    }
    Ok(())
}
