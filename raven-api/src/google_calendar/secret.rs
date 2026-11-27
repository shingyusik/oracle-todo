//! Redacted string wrapper for OAuth codes, tokens, PKCE verifiers and state values.

use std::fmt;

use subtle::ConstantTimeEq;

/// A secret string. `Debug` and `Display` never reveal the value; use
/// [`Secret::expose`] only at the point where the value leaves the process.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// The raw value. Never log or format it.
    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Constant-time comparison (for OAuth `state`).
    pub fn ct_eq(&self, other: &Secret) -> bool {
        let (left, right) = (self.0.as_bytes(), other.0.as_bytes());
        left.len() == right.len() && bool::from(left.ct_eq(right))
    }
}

impl From<String> for Secret {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Secret(<redacted>)")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<redacted>")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_and_display_are_redacted() {
        let secret = Secret::new("ya29.super-secret");
        assert_eq!(format!("{secret:?}"), "Secret(<redacted>)");
        assert_eq!(format!("{secret}"), "<redacted>");
        assert_eq!(
            format!("{:#?}", Some(&secret)),
            "Some(\n    Secret(<redacted>),\n)"
        );
        assert_eq!(secret.expose(), "ya29.super-secret");
    }

    #[test]
    fn constant_time_compare_matches_only_equal_values() {
        let secret = Secret::new("abc");
        assert!(secret.ct_eq(&Secret::new("abc")));
        assert!(!secret.ct_eq(&Secret::new("abd")));
        assert!(!secret.ct_eq(&Secret::new("abcd")));
        assert!(!secret.ct_eq(&Secret::new("")));
    }
}
