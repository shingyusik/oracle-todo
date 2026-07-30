use std::{collections::BTreeSet, fmt, str::FromStr};

use serde::{Deserialize, Deserializer, Serialize};
use time::OffsetDateTime;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;

use super::{MediaReference, ValidationError, as_utc, optional, required, validate_lifecycle};

const MAX_TAGS: usize = 20;
const MAX_TAG_CHARACTERS: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MealType {
    Breakfast,
    Lunch,
    Dinner,
    Snack,
    LateNight,
}

impl FromStr for MealType {
    type Err = ValidationError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "breakfast" => Ok(Self::Breakfast),
            "lunch" => Ok(Self::Lunch),
            "dinner" => Ok(Self::Dinner),
            "snack" => Ok(Self::Snack),
            "late_night" => Ok(Self::LateNight),
            _ => Err(ValidationError::UnsupportedMealType(value.to_string())),
        }
    }
}

impl fmt::Display for MealType {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Breakfast => "breakfast",
            Self::Lunch => "lunch",
            Self::Dinner => "dinner",
            Self::Snack => "snack",
            Self::LateNight => "late_night",
        })
    }
}

pub fn normalize_tags<I, S>(tags: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    tags.into_iter()
        .filter_map(|tag| {
            let normalized: String = tag.as_ref().nfkc().case_fold().nfkc().collect();
            let normalized = normalized.trim();
            (!normalized.is_empty()).then(|| normalized.to_string())
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NewDietEntry {
    #[serde(with = "time::serde::rfc3339")]
    occurred_at: OffsetDateTime,
    meal_type: MealType,
    food_name: String,
    note: Option<String>,
    tags: Vec<String>,
    media_id: Option<MediaReference>,
}

impl NewDietEntry {
    pub fn new<I, S>(
        occurred_at: OffsetDateTime,
        meal_type: MealType,
        food_name: impl Into<String>,
        note: Option<&str>,
        tags: I,
        media_id: Option<MediaReference>,
    ) -> Result<Self, ValidationError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let tags = normalize_tags(tags);
        if tags.len() > MAX_TAGS {
            return Err(ValidationError::TooManyTags { maximum: MAX_TAGS });
        }
        if tags
            .iter()
            .any(|tag| tag.chars().count() > MAX_TAG_CHARACTERS)
        {
            return Err(ValidationError::TagTooLong {
                maximum: MAX_TAG_CHARACTERS,
            });
        }

        Ok(Self {
            occurred_at: as_utc(occurred_at),
            meal_type,
            food_name: required(food_name, "diet_entry.food_name")?,
            note: optional(note.map(str::to_owned), "diet_entry.note")?,
            tags,
            media_id,
        })
    }

    pub const fn occurred_at(&self) -> OffsetDateTime {
        self.occurred_at
    }

    pub const fn meal_type(&self) -> MealType {
        self.meal_type
    }

    pub fn food_name(&self) -> &str {
        &self.food_name
    }

    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }

    pub fn tags(&self) -> &[String] {
        &self.tags
    }

    pub fn media_id(&self) -> Option<&MediaReference> {
        self.media_id.as_ref()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewDietEntryInput {
    #[serde(with = "time::serde::rfc3339")]
    occurred_at: OffsetDateTime,
    meal_type: MealType,
    food_name: String,
    note: Option<String>,
    tags: Vec<String>,
    media_id: Option<MediaReference>,
}

impl<'de> Deserialize<'de> for NewDietEntry {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let input = NewDietEntryInput::deserialize(deserializer)?;
        Self::new(
            input.occurred_at,
            input.meal_type,
            input.food_name,
            input.note.as_deref(),
            input.tags,
            input.media_id,
        )
        .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DietEntryRehydration {
    pub id: String,
    #[serde(with = "time::serde::rfc3339")]
    pub occurred_at: OffsetDateTime,
    pub meal_type: MealType,
    pub food_name: String,
    pub note: Option<String>,
    pub tags: Vec<String>,
    pub media_id: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub deleted_at: Option<OffsetDateTime>,
}

/// A validated persisted diet entry.
///
/// The engine's create command uses [`NewDietEntry`], which has no caller-owned
/// identity or lifecycle fields. JSON and storage rows must first become
/// [`DietEntryRehydration`] and pass [`DietEntry::rehydrate`].
///
/// ```compile_fail
/// use health_engine::domain::DietEntry;
///
/// let _: DietEntry = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DietEntry {
    id: String,
    #[serde(with = "time::serde::rfc3339")]
    occurred_at: OffsetDateTime,
    meal_type: MealType,
    food_name: String,
    note: Option<String>,
    tags: Vec<String>,
    media_id: Option<MediaReference>,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    deleted_at: Option<OffsetDateTime>,
}

impl DietEntry {
    pub fn rehydrate(record: DietEntryRehydration) -> Result<Self, ValidationError> {
        validate_lifecycle(record.created_at, record.updated_at, record.deleted_at)?;
        let input = NewDietEntry::new(
            record.occurred_at,
            record.meal_type,
            record.food_name,
            record.note.as_deref(),
            record.tags,
            record.media_id.map(MediaReference::new).transpose()?,
        )?;

        Ok(Self {
            id: required(record.id, "diet_entry.id")?,
            occurred_at: input.occurred_at,
            meal_type: input.meal_type,
            food_name: input.food_name,
            note: input.note,
            tags: input.tags,
            media_id: input.media_id,
            created_at: as_utc(record.created_at),
            updated_at: as_utc(record.updated_at),
            deleted_at: record.deleted_at.map(as_utc),
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub const fn occurred_at(&self) -> OffsetDateTime {
        self.occurred_at
    }

    pub const fn meal_type(&self) -> MealType {
        self.meal_type
    }

    pub fn food_name(&self) -> &str {
        &self.food_name
    }

    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }

    pub fn tags(&self) -> &[String] {
        &self.tags
    }

    pub fn media_id(&self) -> Option<&MediaReference> {
        self.media_id.as_ref()
    }

    pub const fn created_at(&self) -> OffsetDateTime {
        self.created_at
    }

    pub const fn updated_at(&self) -> OffsetDateTime {
        self.updated_at
    }

    pub const fn deleted_at(&self) -> Option<OffsetDateTime> {
        self.deleted_at
    }

    pub const fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }
}
