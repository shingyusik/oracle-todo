use std::fmt;

use time::OffsetDateTime;

use crate::domain::MealType;

pub struct MediaUpload {
    pub content_type: String,
    pub bytes: Vec<u8>,
}

impl MediaUpload {
    pub fn new(content_type: impl Into<String>, bytes: impl Into<Vec<u8>>) -> Self {
        Self {
            content_type: content_type.into(),
            bytes: bytes.into(),
        }
    }
}

impl fmt::Debug for MediaUpload {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MediaUpload")
            .field("content_type", &self.content_type)
            .field("byte_size", &self.bytes.len())
            .field("bytes", &"<redacted>")
            .finish()
    }
}

#[derive(Debug)]
pub struct CreateDietEntry {
    pub occurred_at: OffsetDateTime,
    pub meal_type: MealType,
    pub food_name: String,
    pub note: Option<String>,
    pub tags: Vec<String>,
    pub media: Option<MediaUpload>,
    pub actor: String,
}

#[derive(Debug, Default)]
pub enum DietMediaUpdate {
    #[default]
    Preserve,
    Remove,
    Replace(MediaUpload),
}

#[derive(Debug, Default)]
pub struct UpdateDietEntry {
    pub occurred_at: Option<OffsetDateTime>,
    pub meal_type: Option<MealType>,
    pub food_name: Option<String>,
    pub note: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
    pub media: DietMediaUpdate,
    pub expected_updated_at: Option<OffsetDateTime>,
    pub actor: String,
    pub reason: Option<String>,
}
