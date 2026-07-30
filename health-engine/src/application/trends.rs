use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use time::{Date, Duration, OffsetDateTime};

use crate::application::error::{HealthError, HealthResult};
use crate::application::media::MediaStore;
use crate::application::ports::HealthReadRepository;
use crate::application::service::{HealthService, checked_local_date};
use crate::domain::{DietEntry, HealthCategory, HealthEvent};

const MAX_TREND_DAYS: u16 = 3_650;
const MAX_TREND_RECORDS: u32 = 100_000;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TrendRecords {
    pub diets: Vec<DietEntry>,
    pub events: Vec<HealthEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NamedCount {
    pub name: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DailyAverage {
    pub local_date: Date,
    pub average: f64,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NumericPoint {
    #[serde(with = "time::serde::rfc3339")]
    pub occurred_at: OffsetDateTime,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NumericSeries {
    pub category: HealthCategory,
    pub metric_key: String,
    pub name: String,
    pub unit: Option<String>,
    pub points: Vec<NumericPoint>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PossibleTagReaction {
    pub tag: String,
    pub diet_entries: u32,
    pub symptom_events_within_24h: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HealthTrends {
    pub days: u16,
    pub top_diet_tags: Vec<NamedCount>,
    pub bowel_average_by_day: Vec<DailyAverage>,
    pub symptom_frequencies: Vec<NamedCount>,
    pub medication_frequencies: Vec<NamedCount>,
    pub numeric_series: Vec<NumericSeries>,
    pub possible_tag_reactions: Vec<PossibleTagReaction>,
    pub reaction_disclaimer: &'static str,
}

#[allow(private_bounds)]
impl<R: HealthReadRepository, M: MediaStore> HealthService<R, M> {
    pub fn trends(&self, days: u16) -> HealthResult<HealthTrends> {
        self.trends_at(days, OffsetDateTime::now_utc())
    }

    pub fn trends_at(&self, days: u16, now: OffsetDateTime) -> HealthResult<HealthTrends> {
        if days == 0 || days > MAX_TREND_DAYS {
            return Err(HealthError::Validation {
                field: "trends.days",
                message: format!("must be between 1 and {MAX_TREND_DAYS}"),
            });
        }
        let start = now
            .checked_sub(Duration::days(i64::from(days)))
            .ok_or_else(|| HealthError::Validation {
                field: "trends.range",
                message: "range is outside supported time".to_string(),
            })?;
        let records = self
            .repository
            .trend_records(start, now, MAX_TREND_RECORDS)?;
        project(records, days, self.local_offset)
    }
}

fn project(
    records: TrendRecords,
    days: u16,
    local_offset: time::UtcOffset,
) -> HealthResult<HealthTrends> {
    let mut tags = BTreeMap::<String, u32>::new();
    for diet in &records.diets {
        for tag in diet.tags() {
            *tags.entry(tag.clone()).or_default() += 1;
        }
    }

    let mut bowel = BTreeMap::<Date, (f64, u32)>::new();
    let mut symptoms = BTreeMap::<String, u32>::new();
    let mut medications = BTreeMap::<String, u32>::new();
    let mut series =
        BTreeMap::<(HealthCategory, String, String, Option<String>), Vec<NumericPoint>>::new();
    for event in &records.events {
        match event.category() {
            HealthCategory::Bowel => {
                let date = checked_local_date(event.occurred_at(), local_offset)?;
                let bucket = bowel.entry(date).or_default();
                bucket.0 += event.value_num().unwrap_or_default();
                bucket.1 += 1;
            }
            HealthCategory::Symptom if event.metric_key().as_str() != "overall_condition" => {
                *symptoms.entry(event.name().to_string()).or_default() += 1;
            }
            HealthCategory::Medication => {
                *medications.entry(event.name().to_string()).or_default() += 1;
            }
            HealthCategory::Weight
            | HealthCategory::Sleep
            | HealthCategory::Lab
            | HealthCategory::Symptom => {
                if let Some(value) = event.value_num() {
                    series
                        .entry((
                            event.category(),
                            event.metric_key().as_str().to_string(),
                            event.name().to_string(),
                            event.unit().map(str::to_string),
                        ))
                        .or_default()
                        .push(NumericPoint {
                            occurred_at: event.occurred_at(),
                            value,
                        });
                }
            }
        }
    }

    let symptom_events = records
        .events
        .iter()
        .filter(|event| {
            event.category() == HealthCategory::Symptom
                && event.metric_key().as_str() != "overall_condition"
        })
        .collect::<Vec<_>>();
    let mut reactions = BTreeMap::<String, (BTreeSet<String>, u32)>::new();
    for diet in &records.diets {
        let upper = diet
            .occurred_at()
            .checked_add(Duration::hours(24))
            .ok_or_else(|| HealthError::Validation {
                field: "trends.range",
                message: "diet reaction window is outside supported time".to_string(),
            })?;
        for tag in diet.tags() {
            let bucket = reactions.entry(tag.clone()).or_default();
            bucket.0.insert(diet.id().as_str().to_string());
            bucket.1 += u32::try_from(
                symptom_events
                    .iter()
                    .filter(|event| {
                        event.occurred_at() > diet.occurred_at() && event.occurred_at() <= upper
                    })
                    .map(|event| event.id().as_str())
                    .collect::<BTreeSet<_>>()
                    .len(),
            )
            .map_err(|_| HealthError::Storage("trend count overflow".to_string()))?;
        }
    }

    Ok(HealthTrends {
        days,
        top_diet_tags: sorted_counts(tags),
        bowel_average_by_day: bowel
            .into_iter()
            .map(|(local_date, (sum, count))| DailyAverage {
                local_date,
                average: sum / f64::from(count),
                count,
            })
            .collect(),
        symptom_frequencies: sorted_counts(symptoms),
        medication_frequencies: sorted_counts(medications),
        numeric_series: series
            .into_iter()
            .map(|((category, metric_key, name, unit), mut points)| {
                points.sort_by_key(|point| point.occurred_at);
                NumericSeries {
                    category,
                    metric_key,
                    name,
                    unit,
                    points,
                }
            })
            .collect(),
        possible_tag_reactions: reactions
            .into_iter()
            .map(|(tag, (diets, count))| PossibleTagReaction {
                tag,
                diet_entries: diets.len() as u32,
                symptom_events_within_24h: count,
            })
            .collect(),
        reaction_disclaimer: "Descriptive co-occurrence in the following 24 hours; it does not establish causation.",
    })
}

fn sorted_counts(counts: BTreeMap<String, u32>) -> Vec<NamedCount> {
    let mut counts = counts
        .into_iter()
        .map(|(name, count)| NamedCount { name, count })
        .collect::<Vec<_>>();
    counts.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.name.cmp(&right.name))
    });
    counts
}
