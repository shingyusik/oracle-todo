use health_engine::application::error::HealthResult;
use health_engine::domain::{
    BowelAttributes, HealthEventDetails, LabAttributes, MealType, MedicationAttributes,
    MedicationUnit, SleepAttributes, SleepValue, SymptomAttributes, WeightAttributes,
};
use serde::Deserialize;

use super::Patch;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateDietBody {
    pub occurred_at: String,
    pub meal_type: MealType,
    pub food_name: String,
    pub note: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateDietBody {
    pub occurred_at: Option<String>,
    pub meal_type: Option<MealType>,
    pub food_name: Option<String>,
    #[serde(default)]
    pub note: Patch<String>,
    pub tags: Option<Vec<String>>,
    pub expected_updated_at: Option<String>,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventBody {
    pub occurred_at: String,
    pub details: EventDetailsBody,
    pub note: Option<String>,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateEventBody {
    pub occurred_at: Option<String>,
    pub details: Option<EventDetailsBody>,
    #[serde(default)]
    pub note: Patch<String>,
    pub expected_updated_at: Option<String>,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EventDetailsBody {
    Weight {
        value: f64,
        #[serde(default = "body_weight_key")]
        key: String,
        #[serde(default = "body_weight_name")]
        name: String,
        unit: String,
    },
    Bowel {
        bristol_scale: u8,
        #[serde(default)]
        blood_visible: bool,
    },
    Sleep {
        value: f64,
        #[serde(default = "sleep_key")]
        key: String,
        #[serde(default = "sleep_name")]
        name: String,
    },
    Lab {
        key: String,
        name: String,
        value: f64,
        unit: Option<String>,
    },
    Symptom {
        key: String,
        name: String,
        score: u8,
        condition_note: Option<String>,
    },
    OverallCondition {
        #[serde(default = "condition_name")]
        name: String,
        score: u8,
        condition_note: Option<String>,
    },
    Medication {
        medication_name: String,
        dose: f64,
        unit: MedicationUnit,
    },
}

impl EventDetailsBody {
    pub fn into_domain(self) -> HealthResult<HealthEventDetails> {
        Ok(match self {
            Self::Weight {
                value,
                key,
                name,
                unit,
            } => HealthEventDetails::Weight(WeightAttributes::new(key, name, value, unit)?),
            Self::Bowel {
                bristol_scale,
                blood_visible,
            } => HealthEventDetails::Bowel(BowelAttributes::new(bristol_scale, blood_visible)?),
            Self::Sleep { value, key, name } => HealthEventDetails::Sleep(SleepAttributes::new(
                key,
                name,
                SleepValue::hours(value)?,
            )?),
            Self::Lab {
                key,
                name,
                value,
                unit,
            } => HealthEventDetails::Lab(LabAttributes::new(key, name, value, unit.as_deref())?),
            Self::Symptom {
                key,
                name,
                score,
                condition_note,
            } => HealthEventDetails::Symptom(SymptomAttributes::new(
                key,
                name,
                score,
                condition_note.as_deref(),
            )?),
            Self::OverallCondition {
                name,
                score,
                condition_note,
            } => HealthEventDetails::Symptom(SymptomAttributes::overall_condition(
                name,
                score,
                condition_note.as_deref(),
            )?),
            Self::Medication {
                medication_name,
                dose,
                unit,
            } => HealthEventDetails::Medication(MedicationAttributes::new(
                medication_name,
                dose,
                unit,
            )?),
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DailyMetricsBody {
    pub metrics: Vec<DailyMetricBody>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DailyMetricBody {
    pub occurred_at: String,
    pub details: EventDetailsBody,
    pub note: Option<String>,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PurgeBody {
    pub confirmation: String,
}

fn default_actor() -> String {
    "raven-api".to_string()
}

fn body_weight_key() -> String {
    "body_weight".to_string()
}

fn body_weight_name() -> String {
    "Body weight".to_string()
}

fn sleep_key() -> String {
    "sleep_duration".to_string()
}

fn sleep_name() -> String {
    "Sleep duration".to_string()
}

fn condition_name() -> String {
    "Overall condition".to_string()
}
