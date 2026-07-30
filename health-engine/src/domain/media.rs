use serde::{Deserialize, Deserializer, Serialize};
use uuid::{Uuid, Version};

use super::ValidationError;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct HealthRecordId(String);

impl HealthRecordId {
    pub fn parse(value: &str) -> Result<Self, ValidationError> {
        let uuid = Uuid::parse_str(value).map_err(|_| ValidationError::InvalidRecordId)?;
        if uuid.get_version() != Some(Version::Random) || uuid.to_string() != value {
            return Err(ValidationError::InvalidRecordId);
        }
        Ok(Self(value.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for HealthRecordId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let id = String::deserialize(deserializer)?;
        Self::parse(&id).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct MediaReference(HealthRecordId);

impl MediaReference {
    pub fn new(id: impl AsRef<str>) -> Result<Self, ValidationError> {
        HealthRecordId::parse(id.as_ref()).map(Self)
    }

    pub fn id(&self) -> &HealthRecordId {
        &self.0
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl<'de> Deserialize<'de> for MediaReference {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        HealthRecordId::deserialize(deserializer).map(Self)
    }
}
