use serde::{Deserialize, Deserializer, Serialize};

use super::{ValidationError, required};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct MediaReference(String);

impl MediaReference {
    pub fn new(id: impl Into<String>) -> Result<Self, ValidationError> {
        required(id, "diet_entry.media_id").map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for MediaReference {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let id = String::deserialize(deserializer)?;
        Self::new(id).map_err(serde::de::Error::custom)
    }
}
