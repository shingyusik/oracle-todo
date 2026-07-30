use std::fmt;

use serde::{Deserialize, Deserializer, Serialize};
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;

use super::ValidationError;

const MAX_METRIC_KEY_CHARACTERS: usize = 64;

/// A stable daily-metric identity.
///
/// Input is normalized with NFKC, Unicode full case-fold, then NFKC again.
/// The canonical result must contain at most 64 ASCII characters, start with
/// `a` through `z`, and contain only lowercase letters, digits, and single
/// underscores separating non-empty segments.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct MetricKey(String);

impl MetricKey {
    pub fn new(value: impl AsRef<str>) -> Result<Self, ValidationError> {
        let normalized: String = value.as_ref().nfkc().case_fold().nfkc().collect();
        let normalized = normalized.trim();
        let bytes = normalized.as_bytes();
        let valid = !bytes.is_empty()
            && bytes.len() <= MAX_METRIC_KEY_CHARACTERS
            && bytes[0].is_ascii_lowercase()
            && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
            && bytes
                .iter()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_')
            && !bytes.windows(2).any(|pair| pair == b"__");
        if !valid {
            return Err(ValidationError::InvalidMetricKey);
        }
        Ok(Self(normalized.to_string()))
    }

    pub fn body_weight() -> Self {
        Self("body_weight".to_string())
    }

    pub fn sleep_duration() -> Self {
        Self("sleep_duration".to_string())
    }

    pub fn overall_condition() -> Self {
        Self("overall_condition".to_string())
    }

    pub(super) fn bowel() -> Self {
        Self("bowel".to_string())
    }

    pub(super) fn medication() -> Self {
        Self("medication".to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for MetricKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for MetricKey {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}
