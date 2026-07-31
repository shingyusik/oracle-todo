use serde_json::Value;

pub(super) const AUDIT_JSON_MAX_BYTES: usize = 1024 * 1024;

pub(super) fn decode_optional(value: Option<&str>) -> Result<Option<Value>, String> {
    value.map(decode).transpose()
}

#[allow(dead_code)]
pub(super) fn encode_optional(value: Option<&Value>) -> Result<Option<String>, String> {
    value.map(encode).transpose()
}

pub(super) fn decode(value: &str) -> Result<Value, String> {
    validate_size(value)?;
    let decoded = serde_json::from_str::<Value>(value).map_err(|error| error.to_string())?;
    if !decoded.is_object() {
        return Err("audit JSON snapshots must be objects".to_string());
    }
    Ok(decoded)
}

fn encode(value: &Value) -> Result<String, String> {
    if !value.is_object() {
        return Err("audit JSON snapshots must be objects".to_string());
    }
    let encoded = serde_json::to_string(value).map_err(|error| error.to_string())?;
    validate_size(&encoded)?;
    drop(decode(&encoded)?);
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
