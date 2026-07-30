use std::{fmt, str::FromStr};

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use time::OffsetDateTime;

use super::{ValidationError, as_utc, finite, optional, required, validate_lifecycle};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthCategory {
    Weight,
    Bowel,
    Sleep,
    Lab,
    Symptom,
    Medication,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MedicationUnit {
    Tablet,
    Capsule,
    Packet,
    Mg,
    G,
    Ml,
    Drop,
    Dose,
}

impl FromStr for MedicationUnit {
    type Err = ValidationError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "tablet" => Ok(Self::Tablet),
            "capsule" => Ok(Self::Capsule),
            "packet" => Ok(Self::Packet),
            "mg" => Ok(Self::Mg),
            "g" => Ok(Self::G),
            "ml" => Ok(Self::Ml),
            "drop" => Ok(Self::Drop),
            "dose" => Ok(Self::Dose),
            _ => Err(ValidationError::UnsupportedMedicationUnit(
                value.to_string(),
            )),
        }
    }
}

impl fmt::Display for MedicationUnit {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Tablet => "tablet",
            Self::Capsule => "capsule",
            Self::Packet => "packet",
            Self::Mg => "mg",
            Self::G => "g",
            Self::Ml => "ml",
            Self::Drop => "drop",
            Self::Dose => "dose",
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(transparent)]
pub struct WeightValue(f64);

impl WeightValue {
    pub fn new(value: f64) -> Result<Self, ValidationError> {
        let value = finite(value, "weight")?;
        if value <= 0.0 {
            return Err(ValidationError::NonPositiveNumber("weight"));
        }
        Ok(Self(value))
    }

    pub const fn get(self) -> f64 {
        self.0
    }
}

impl<'de> Deserialize<'de> for WeightValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(f64::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(transparent)]
pub struct SleepValue(f64);

impl SleepValue {
    pub fn hours(value: f64) -> Result<Self, ValidationError> {
        let value = finite(value, "sleep hours")?;
        if value <= 0.0 || value > 24.0 {
            return Err(ValidationError::InvalidSleepHours);
        }
        Ok(Self(value))
    }

    pub const fn get(self) -> f64 {
        self.0
    }
}

impl<'de> Deserialize<'de> for SleepValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::hours(f64::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BowelAttributes {
    bristol_scale: u8,
    blood_visible: bool,
}

impl BowelAttributes {
    pub fn new(bristol_scale: u8, blood_visible: bool) -> Result<Self, ValidationError> {
        if !(1..=7).contains(&bristol_scale) {
            return Err(ValidationError::InvalidBristolScale);
        }
        Ok(Self {
            bristol_scale,
            blood_visible,
        })
    }

    pub const fn bristol_scale(&self) -> u8 {
        self.bristol_scale
    }

    pub const fn blood_visible(&self) -> bool {
        self.blood_visible
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BowelAttributesInput {
    bristol_scale: u8,
    blood_visible: bool,
}

impl<'de> Deserialize<'de> for BowelAttributes {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let input = BowelAttributesInput::deserialize(deserializer)?;
        Self::new(input.bristol_scale, input.blood_visible).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WeightAttributes {
    metric_key: String,
    name: String,
    value: WeightValue,
    unit: String,
}

impl WeightAttributes {
    pub fn new(
        metric_key: impl Into<String>,
        name: impl Into<String>,
        value: f64,
        unit: impl Into<String>,
    ) -> Result<Self, ValidationError> {
        Ok(Self {
            metric_key: required(metric_key, "weight.metric_key")?,
            name: required(name, "weight.name")?,
            value: WeightValue::new(value)?,
            unit: required(unit, "weight.unit")?,
        })
    }

    pub fn metric_key(&self) -> &str {
        &self.metric_key
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub const fn value(&self) -> WeightValue {
        self.value
    }

    pub fn unit(&self) -> &str {
        &self.unit
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WeightAttributesInput {
    metric_key: String,
    name: String,
    value: f64,
    unit: String,
}

impl<'de> Deserialize<'de> for WeightAttributes {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let input = WeightAttributesInput::deserialize(deserializer)?;
        Self::new(input.metric_key, input.name, input.value, input.unit)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SleepAttributes {
    metric_key: String,
    name: String,
    hours: SleepValue,
}

impl SleepAttributes {
    pub fn new(
        metric_key: impl Into<String>,
        name: impl Into<String>,
        hours: SleepValue,
    ) -> Result<Self, ValidationError> {
        Ok(Self {
            metric_key: required(metric_key, "sleep.metric_key")?,
            name: required(name, "sleep.name")?,
            hours,
        })
    }

    pub fn metric_key(&self) -> &str {
        &self.metric_key
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub const fn hours(&self) -> SleepValue {
        self.hours
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SleepAttributesInput {
    metric_key: String,
    name: String,
    hours: SleepValue,
}

impl<'de> Deserialize<'de> for SleepAttributes {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let input = SleepAttributesInput::deserialize(deserializer)?;
        Self::new(input.metric_key, input.name, input.hours).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LabAttributes {
    metric_key: String,
    name: String,
    value: f64,
    unit: String,
}

impl LabAttributes {
    pub fn new(
        metric_key: impl Into<String>,
        name: impl Into<String>,
        value: f64,
        unit: impl Into<String>,
    ) -> Result<Self, ValidationError> {
        Ok(Self {
            metric_key: required(metric_key, "lab.metric_key")?,
            name: required(name, "lab.name")?,
            value: finite(value, "lab value")?,
            unit: required(unit, "lab.unit")?,
        })
    }

    pub fn metric_key(&self) -> &str {
        &self.metric_key
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub const fn value(&self) -> f64 {
        self.value
    }

    pub fn unit(&self) -> &str {
        &self.unit
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LabAttributesInput {
    metric_key: String,
    name: String,
    value: f64,
    unit: String,
}

impl<'de> Deserialize<'de> for LabAttributes {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let input = LabAttributesInput::deserialize(deserializer)?;
        Self::new(input.metric_key, input.name, input.value, input.unit)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SymptomAttributes {
    metric_key: String,
    name: String,
    score: u8,
    condition_note: Option<String>,
}

impl SymptomAttributes {
    pub fn new(
        metric_key: impl Into<String>,
        name: impl Into<String>,
        score: u8,
        condition_note: Option<&str>,
    ) -> Result<Self, ValidationError> {
        if !(1..=10).contains(&score) {
            return Err(ValidationError::InvalidSymptomScore);
        }
        Ok(Self {
            metric_key: required(metric_key, "symptom.metric_key")?,
            name: required(name, "symptom.name")?,
            score,
            condition_note: optional(condition_note.map(str::to_owned), "symptom.condition_note")?,
        })
    }

    pub fn metric_key(&self) -> &str {
        &self.metric_key
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub const fn score(&self) -> u8 {
        self.score
    }

    pub fn condition_note(&self) -> Option<&str> {
        self.condition_note.as_deref()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SymptomAttributesInput {
    metric_key: String,
    name: String,
    score: u8,
    condition_note: Option<String>,
}

impl<'de> Deserialize<'de> for SymptomAttributes {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let input = SymptomAttributesInput::deserialize(deserializer)?;
        Self::new(
            input.metric_key,
            input.name,
            input.score,
            input.condition_note.as_deref(),
        )
        .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MedicationAttributes {
    medication_name: String,
    dose: f64,
    unit: MedicationUnit,
}

impl MedicationAttributes {
    pub fn new(
        medication_name: impl Into<String>,
        dose: f64,
        unit: MedicationUnit,
    ) -> Result<Self, ValidationError> {
        let dose = finite(dose, "medication dose")?;
        if dose <= 0.0 {
            return Err(ValidationError::NonPositiveNumber("medication dose"));
        }
        Ok(Self {
            medication_name: required(medication_name, "medication.name")?,
            dose,
            unit,
        })
    }

    pub fn medication_name(&self) -> &str {
        &self.medication_name
    }

    pub const fn dose(&self) -> f64 {
        self.dose
    }

    pub const fn unit(&self) -> MedicationUnit {
        self.unit
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MedicationAttributesInput {
    medication_name: String,
    dose: f64,
    unit: MedicationUnit,
}

impl<'de> Deserialize<'de> for MedicationAttributes {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let input = MedicationAttributesInput::deserialize(deserializer)?;
        Self::new(input.medication_name, input.dose, input.unit).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum HealthEventDetails {
    Weight(WeightAttributes),
    Bowel(BowelAttributes),
    Sleep(SleepAttributes),
    Lab(LabAttributes),
    Symptom(SymptomAttributes),
    Medication(MedicationAttributes),
}

impl HealthEventDetails {
    pub const fn category(&self) -> HealthCategory {
        match self {
            Self::Weight(_) => HealthCategory::Weight,
            Self::Bowel(_) => HealthCategory::Bowel,
            Self::Sleep(_) => HealthCategory::Sleep,
            Self::Lab(_) => HealthCategory::Lab,
            Self::Symptom(_) => HealthCategory::Symptom,
            Self::Medication(_) => HealthCategory::Medication,
        }
    }

    fn metric_key(&self) -> &str {
        match self {
            Self::Weight(attributes) => &attributes.metric_key,
            Self::Bowel(_) => "bowel",
            Self::Sleep(attributes) => &attributes.metric_key,
            Self::Lab(attributes) => &attributes.metric_key,
            Self::Symptom(attributes) => &attributes.metric_key,
            Self::Medication(_) => "medication",
        }
    }

    fn name(&self) -> &str {
        match self {
            Self::Weight(attributes) => &attributes.name,
            Self::Bowel(_) => "Bowel",
            Self::Sleep(attributes) => &attributes.name,
            Self::Lab(attributes) => &attributes.name,
            Self::Symptom(attributes) => &attributes.name,
            Self::Medication(attributes) => &attributes.medication_name,
        }
    }

    fn value_num(&self) -> f64 {
        match self {
            Self::Weight(attributes) => attributes.value.get(),
            Self::Bowel(attributes) => f64::from(attributes.bristol_scale),
            Self::Sleep(attributes) => attributes.hours.get(),
            Self::Lab(attributes) => attributes.value,
            Self::Symptom(attributes) => f64::from(attributes.score),
            Self::Medication(attributes) => attributes.dose,
        }
    }

    fn unit(&self) -> Option<String> {
        match self {
            Self::Weight(attributes) => Some(attributes.unit.clone()),
            Self::Bowel(_) => None,
            Self::Sleep(_) => Some("hours".to_string()),
            Self::Lab(attributes) => Some(attributes.unit.clone()),
            Self::Symptom(_) => Some("score".to_string()),
            Self::Medication(attributes) => Some(attributes.unit.to_string()),
        }
    }

    fn attributes(&self) -> Result<Value, ValidationError> {
        match self {
            Self::Weight(attributes) => serde_json::to_value(attributes),
            Self::Bowel(attributes) => serde_json::to_value(attributes),
            Self::Sleep(attributes) => serde_json::to_value(attributes),
            Self::Lab(attributes) => serde_json::to_value(attributes),
            Self::Symptom(attributes) => serde_json::to_value(attributes),
            Self::Medication(attributes) => serde_json::to_value(attributes),
        }
        .map_err(|_| ValidationError::InvalidAttributes)
    }

    fn from_attributes(
        category: HealthCategory,
        attributes: Value,
    ) -> Result<Self, ValidationError> {
        let parse = |result: serde_json::Result<Self>| {
            result.map_err(|_| ValidationError::InvalidAttributes)
        };
        match category {
            HealthCategory::Weight => parse(serde_json::from_value(attributes).map(Self::Weight)),
            HealthCategory::Bowel => parse(serde_json::from_value(attributes).map(Self::Bowel)),
            HealthCategory::Sleep => parse(serde_json::from_value(attributes).map(Self::Sleep)),
            HealthCategory::Lab => parse(serde_json::from_value(attributes).map(Self::Lab)),
            HealthCategory::Symptom => parse(serde_json::from_value(attributes).map(Self::Symptom)),
            HealthCategory::Medication => {
                parse(serde_json::from_value(attributes).map(Self::Medication))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NewHealthEvent {
    #[serde(with = "time::serde::rfc3339")]
    occurred_at: OffsetDateTime,
    category: HealthCategory,
    metric_key: String,
    name: String,
    value_num: Option<f64>,
    unit: Option<String>,
    note: Option<String>,
    attributes: Value,
}

impl NewHealthEvent {
    pub fn new(
        occurred_at: OffsetDateTime,
        details: HealthEventDetails,
        note: Option<&str>,
    ) -> Result<Self, ValidationError> {
        Ok(Self {
            occurred_at: as_utc(occurred_at),
            category: details.category(),
            metric_key: details.metric_key().to_string(),
            name: details.name().to_string(),
            value_num: Some(details.value_num()),
            unit: details.unit(),
            note: optional(note.map(str::to_owned), "health_event.note")?,
            attributes: details.attributes()?,
        })
    }

    fn from_input(input: NewHealthEventInput) -> Result<Self, ValidationError> {
        let metric_key = required(input.metric_key, "health_event.metric_key")?;
        let name = required(input.name, "health_event.name")?;
        let value_num = input
            .value_num
            .map(|value| finite(value, "health event value"))
            .transpose()?;
        let unit = optional(input.unit, "health_event.unit")?;
        let note = optional(input.note, "health_event.note")?;
        let details = HealthEventDetails::from_attributes(input.category, input.attributes)?;
        let event = Self::new(input.occurred_at, details, note.as_deref())?;

        if event.category != input.category
            || event.metric_key != metric_key
            || event.name != name
            || event.value_num != value_num
            || event.unit != unit
        {
            return Err(ValidationError::AttributesMismatch);
        }
        Ok(event)
    }

    pub const fn occurred_at(&self) -> OffsetDateTime {
        self.occurred_at
    }

    pub const fn category(&self) -> HealthCategory {
        self.category
    }

    pub fn metric_key(&self) -> &str {
        &self.metric_key
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub const fn value_num(&self) -> Option<f64> {
        self.value_num
    }

    pub fn unit(&self) -> Option<&str> {
        self.unit.as_deref()
    }

    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }

    pub fn attributes(&self) -> &Value {
        &self.attributes
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewHealthEventInput {
    #[serde(with = "time::serde::rfc3339")]
    occurred_at: OffsetDateTime,
    category: HealthCategory,
    metric_key: String,
    name: String,
    value_num: Option<f64>,
    unit: Option<String>,
    note: Option<String>,
    attributes: Value,
}

impl<'de> Deserialize<'de> for NewHealthEvent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::from_input(NewHealthEventInput::deserialize(deserializer)?)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HealthEventRehydration {
    pub id: String,
    #[serde(with = "time::serde::rfc3339")]
    pub occurred_at: OffsetDateTime,
    pub category: HealthCategory,
    pub metric_key: String,
    pub name: String,
    pub value_num: Option<f64>,
    pub unit: Option<String>,
    pub note: Option<String>,
    pub attributes: Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub deleted_at: Option<OffsetDateTime>,
}

/// A validated persisted Health event.
///
/// The engine's create command uses [`NewHealthEvent`], which has no
/// caller-owned identity or lifecycle fields. JSON and storage rows must first
/// become [`HealthEventRehydration`] and pass [`HealthEvent::rehydrate`].
///
/// ```compile_fail
/// use health_engine::domain::HealthEvent;
///
/// let _: HealthEvent = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HealthEvent {
    id: String,
    #[serde(with = "time::serde::rfc3339")]
    occurred_at: OffsetDateTime,
    category: HealthCategory,
    metric_key: String,
    name: String,
    value_num: Option<f64>,
    unit: Option<String>,
    note: Option<String>,
    attributes: Value,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    deleted_at: Option<OffsetDateTime>,
}

impl HealthEvent {
    pub fn rehydrate(record: HealthEventRehydration) -> Result<Self, ValidationError> {
        validate_lifecycle(record.created_at, record.updated_at, record.deleted_at)?;
        let input = NewHealthEvent::from_input(NewHealthEventInput {
            occurred_at: record.occurred_at,
            category: record.category,
            metric_key: record.metric_key,
            name: record.name,
            value_num: record.value_num,
            unit: record.unit,
            note: record.note,
            attributes: record.attributes,
        })?;

        Ok(Self {
            id: required(record.id, "health_event.id")?,
            occurred_at: input.occurred_at,
            category: input.category,
            metric_key: input.metric_key,
            name: input.name,
            value_num: input.value_num,
            unit: input.unit,
            note: input.note,
            attributes: input.attributes,
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

    pub const fn category(&self) -> HealthCategory {
        self.category
    }

    pub fn metric_key(&self) -> &str {
        &self.metric_key
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub const fn value_num(&self) -> Option<f64> {
        self.value_num
    }

    pub fn unit(&self) -> Option<&str> {
        self.unit.as_deref()
    }

    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }

    pub fn attributes(&self) -> &Value {
        &self.attributes
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
