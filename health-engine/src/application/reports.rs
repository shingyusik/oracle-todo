use std::collections::BTreeMap;

use serde::Serialize;
use time::{Date, Duration, OffsetDateTime, Time};

use crate::application::error::{HealthError, HealthResult};
use crate::application::media::MediaStore;
use crate::application::ports::HealthReadRepository;
use crate::application::service::{HealthService, checked_local_date, validation};
use crate::domain::{DietEntry, HealthCategory, HealthEvent};

const MAX_REPORT_DAYS: i64 = 366;
const MAX_REPORT_RECORDS: u32 = 100_000;
const REACTION_DISCLAIMER: &str = "Observed associations only; they do not establish causation.";

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReportRecords {
    pub diets: Vec<DietEntry>,
    pub events: Vec<HealthEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HealthReportRange {
    pub from: Date,
    pub to: Date,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HealthReport {
    pub range: HealthReportRange,
    pub previous_range: HealthReportRange,
    pub metrics: Vec<MetricSummary>,
    pub diet_count: CountComparison,
    pub bowel: BowelSummary,
    pub medication_count: CountComparison,
    pub bowel_points: Vec<BowelPoint>,
    pub metric_series: Vec<MetricSeries>,
    pub medication_frequencies: Vec<NamedCount>,
    pub diet_tag_frequencies: Vec<NamedCount>,
    pub diet_tag_bowel_responses: Vec<TagBowelResponse>,
    pub reaction_disclaimer: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CountComparison {
    pub current: Option<u32>,
    pub previous: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BowelSummary {
    pub current_count: Option<u32>,
    pub previous_count: Option<u32>,
    pub current_average: Option<f64>,
    pub previous_average: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FixedMetric {
    BodyWeight,
    SleepDuration,
    Crp,
    FecalCalprotectin,
    OverallCondition,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MetricReading {
    pub local_date: Date,
    #[serde(with = "time::serde::rfc3339")]
    pub occurred_at: OffsetDateTime,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MetricSummary {
    pub metric: FixedMetric,
    pub name: &'static str,
    pub unit: Option<&'static str>,
    pub current: Option<MetricReading>,
    pub previous: Option<MetricReading>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BowelPoint {
    pub local_date: Date,
    #[serde(with = "time::serde::rfc3339")]
    pub occurred_at: OffsetDateTime,
    pub bristol_scale: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MetricSeries {
    pub metric: FixedMetric,
    pub points: Vec<MetricReading>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NamedCount {
    pub name: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TagBowelResponse {
    pub tag: String,
    pub positive_meals: u32,
    pub eligible_meals: u32,
    pub rate: f64,
}

#[allow(private_bounds)]
impl<R: HealthReadRepository, M: MediaStore> HealthService<R, M> {
    pub fn reports(&self, range: HealthReportRange) -> HealthResult<HealthReport> {
        self.reports_at(range, OffsetDateTime::now_utc())
    }

    pub fn reports_at(
        &self,
        range: HealthReportRange,
        now: OffsetDateTime,
    ) -> HealthResult<HealthReport> {
        let days = i64::from(range.to.to_julian_day()) - i64::from(range.from.to_julian_day()) + 1;
        if !(1..=MAX_REPORT_DAYS).contains(&days) {
            return Err(validation(
                "reports.range",
                "must contain between 1 and 366 inclusive days",
            ));
        }
        let previous_to = range
            .from
            .checked_sub(Duration::days(1))
            .ok_or_else(|| validation("reports.range", "range is outside supported time"))?;
        let previous_from = previous_to
            .checked_sub(Duration::days(days - 1))
            .ok_or_else(|| validation("reports.range", "range is outside supported time"))?;
        let next_date = range
            .to
            .checked_add(Duration::days(1))
            .ok_or_else(|| validation("reports.range", "range is outside supported time"))?;
        let start = utc_midnight(previous_from, self.local_offset)?;
        let selected_end = utc_midnight(next_date, self.local_offset)?
            .checked_sub(Duration::nanoseconds(1))
            .ok_or_else(|| validation("reports.range", "range is outside supported time"))?;
        let end = selected_end
            .checked_add(Duration::hours(24))
            .ok_or_else(|| validation("reports.range", "range is outside supported time"))?
            .min(now);
        let records = self
            .repository
            .report_records(start, end, MAX_REPORT_RECORDS)?;
        project(
            records,
            range,
            HealthReportRange {
                from: previous_from,
                to: previous_to,
            },
            now,
            self.local_offset,
        )
    }
}

fn utc_midnight(date: Date, offset: time::UtcOffset) -> HealthResult<OffsetDateTime> {
    date.with_time(Time::MIDNIGHT)
        .checked_sub(Duration::seconds(i64::from(offset.whole_seconds())))
        .map(time::PrimitiveDateTime::assume_utc)
        .ok_or_else(|| validation("reports.range", "range is outside supported time"))
}

fn project(
    records: ReportRecords,
    range: HealthReportRange,
    previous_range: HealthReportRange,
    now: OffsetDateTime,
    offset: time::UtcOffset,
) -> HealthResult<HealthReport> {
    let dated_diets = records
        .diets
        .iter()
        .map(|item| Ok((item, checked_local_date(item.occurred_at(), offset)?)))
        .collect::<HealthResult<Vec<_>>>()?;
    let dated_events = records
        .events
        .iter()
        .map(|item| Ok((item, checked_local_date(item.occurred_at(), offset)?)))
        .collect::<HealthResult<Vec<_>>>()?;
    let in_range = |date: Date, value: &HealthReportRange| date >= value.from && date <= value.to;
    let count = |values: usize| {
        u32::try_from(values).map_err(|_| HealthError::Storage("report count overflow".into()))
    };
    let diet_count = CountComparison {
        current: optional_count(count(
            dated_diets
                .iter()
                .filter(|(_, date)| in_range(*date, &range))
                .count(),
        )?),
        previous: optional_count(count(
            dated_diets
                .iter()
                .filter(|(_, date)| in_range(*date, &previous_range))
                .count(),
        )?),
    };
    let mut current_bowel = dated_events
        .iter()
        .filter(|(event, date)| {
            event.category() == HealthCategory::Bowel && in_range(*date, &range)
        })
        .map(|(event, _)| *event)
        .collect::<Vec<_>>();
    current_bowel.sort_by(|left, right| {
        left.occurred_at()
            .cmp(&right.occurred_at())
            .then_with(|| left.id().as_str().cmp(right.id().as_str()))
    });
    let previous_bowel = dated_events
        .iter()
        .filter(|(event, date)| {
            event.category() == HealthCategory::Bowel && in_range(*date, &previous_range)
        })
        .map(|(event, _)| *event)
        .collect::<Vec<_>>();
    let bowel = bowel_summary(&current_bowel, &previous_bowel)?;
    let current_medications = dated_events
        .iter()
        .filter(|(event, date)| {
            event.category() == HealthCategory::Medication && in_range(*date, &range)
        })
        .map(|(event, _)| *event)
        .collect::<Vec<_>>();
    let previous_medications = dated_events
        .iter()
        .filter(|(event, date)| {
            event.category() == HealthCategory::Medication && in_range(*date, &previous_range)
        })
        .count();
    let medication_count = CountComparison {
        current: optional_count(count(current_medications.len())?),
        previous: optional_count(count(previous_medications)?),
    };

    let bowel_points = current_bowel
        .iter()
        .map(|event| {
            Ok(BowelPoint {
                local_date: checked_local_date(event.occurred_at(), offset)?,
                occurred_at: event.occurred_at(),
                bristol_scale: event.value_num().unwrap_or_default() as u8,
            })
        })
        .collect::<HealthResult<Vec<_>>>()?;
    let mut metrics = Vec::new();
    let mut metric_series = Vec::new();
    for metric in FixedMetric::ALL {
        let mut events = dated_events
            .iter()
            .filter(|(event, _)| fixed_metric(event) == Some(metric))
            .map(|(event, date)| (*event, *date))
            .collect::<Vec<_>>();
        events.sort_by(|(left, _), (right, _)| {
            left.occurred_at()
                .cmp(&right.occurred_at())
                .then_with(|| left.id().as_str().cmp(right.id().as_str()))
        });
        let current_index = events.iter().rposition(|(_, date)| in_range(*date, &range));
        let current = current_index
            .map(|index| reading(events[index], offset))
            .transpose()?;
        let previous = current_index
            .and_then(|index| index.checked_sub(1))
            .map(|index| reading(events[index], offset))
            .transpose()?;
        let points = events
            .iter()
            .filter(|(_, date)| in_range(*date, &range))
            .map(|event| reading(*event, offset))
            .collect::<HealthResult<Vec<_>>>()?;
        let (name, unit) = metric.metadata();
        metrics.push(MetricSummary {
            metric,
            name,
            unit,
            current,
            previous,
        });
        metric_series.push(MetricSeries { metric, points });
    }
    let medication_frequencies = frequencies(
        current_medications
            .iter()
            .map(|event| event.name().to_string()),
    )?;
    let current_diets = dated_diets
        .iter()
        .filter(|(_, date)| in_range(*date, &range))
        .map(|(diet, _)| *diet)
        .collect::<Vec<_>>();
    let diet_tag_frequencies = frequencies(
        current_diets
            .iter()
            .flat_map(|diet| diet.tags().iter().cloned()),
    )?;
    let diet_tag_bowel_responses = responses(&current_diets, &records.events, now)?;
    Ok(HealthReport {
        range,
        previous_range,
        metrics,
        diet_count,
        bowel,
        medication_count,
        bowel_points,
        metric_series,
        medication_frequencies,
        diet_tag_frequencies,
        diet_tag_bowel_responses,
        reaction_disclaimer: REACTION_DISCLAIMER,
    })
}

impl FixedMetric {
    const ALL: [Self; 5] = [
        Self::BodyWeight,
        Self::SleepDuration,
        Self::Crp,
        Self::FecalCalprotectin,
        Self::OverallCondition,
    ];
    fn metadata(self) -> (&'static str, Option<&'static str>) {
        match self {
            Self::BodyWeight => ("Body weight", Some("kg")),
            Self::SleepDuration => ("Sleep", Some("hours")),
            Self::Crp => ("CRP", Some("mg/L")),
            Self::FecalCalprotectin => ("Fecal calprotectin", Some("µg/g")),
            Self::OverallCondition => ("Overall condition", None),
        }
    }
}

fn fixed_metric(event: &HealthEvent) -> Option<FixedMetric> {
    match (event.category(), event.metric_key().as_str()) {
        (HealthCategory::Weight, "body_weight") => Some(FixedMetric::BodyWeight),
        (HealthCategory::Sleep, "sleep_duration") => Some(FixedMetric::SleepDuration),
        (HealthCategory::Lab, "crp") => Some(FixedMetric::Crp),
        (HealthCategory::Lab, "fecal_calprotectin") => Some(FixedMetric::FecalCalprotectin),
        (HealthCategory::Symptom, "overall_condition") => Some(FixedMetric::OverallCondition),
        _ => None,
    }
}
fn reading(
    (event, _): (&HealthEvent, Date),
    offset: time::UtcOffset,
) -> HealthResult<MetricReading> {
    Ok(MetricReading {
        local_date: checked_local_date(event.occurred_at(), offset)?,
        occurred_at: event.occurred_at(),
        value: event
            .value_num()
            .ok_or_else(|| HealthError::Storage("daily metric has no numeric value".into()))?,
    })
}
fn optional_count(value: u32) -> Option<u32> {
    (value != 0).then_some(value)
}
fn bowel_summary(
    current: &[&HealthEvent],
    previous: &[&HealthEvent],
) -> HealthResult<BowelSummary> {
    let summarize = |events: &[&HealthEvent]| -> HealthResult<(Option<u32>, Option<f64>)> {
        let count = u32::try_from(events.len())
            .map_err(|_| HealthError::Storage("report count overflow".into()))?;
        Ok((
            optional_count(count),
            (count != 0).then(|| {
                events
                    .iter()
                    .filter_map(|event| event.value_num())
                    .sum::<f64>()
                    / f64::from(count)
            }),
        ))
    };
    let (current_count, current_average) = summarize(current)?;
    let (previous_count, previous_average) = summarize(previous)?;
    Ok(BowelSummary {
        current_count,
        previous_count,
        current_average,
        previous_average,
    })
}
fn frequencies(values: impl Iterator<Item = String>) -> HealthResult<Vec<NamedCount>> {
    let mut counts = BTreeMap::<String, u32>::new();
    for value in values {
        let count = counts.entry(value).or_default();
        *count = count
            .checked_add(1)
            .ok_or_else(|| HealthError::Storage("report count overflow".into()))?;
    }
    let mut rows = counts
        .into_iter()
        .map(|(name, count)| NamedCount { name, count })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(rows)
}
fn responses(
    diets: &[&DietEntry],
    events: &[HealthEvent],
    now: OffsetDateTime,
) -> HealthResult<Vec<TagBowelResponse>> {
    let bowel = events
        .iter()
        .filter(|event| event.category() == HealthCategory::Bowel)
        .collect::<Vec<_>>();
    let mut counts = BTreeMap::<String, (u32, u32)>::new();
    for diet in diets {
        for tag in diet.tags() {
            counts.entry(tag.clone()).or_default();
        }
        let upper = diet
            .occurred_at()
            .checked_add(Duration::hours(24))
            .ok_or_else(|| {
                validation(
                    "reports.range",
                    "diet response window is outside supported time",
                )
            })?;
        if upper > now {
            continue;
        }
        let positive = bowel.iter().any(|event| {
            matches!(
                event.value_num().map(|value| value as u8),
                Some(1 | 2 | 6 | 7)
            ) && event.occurred_at() > diet.occurred_at()
                && event.occurred_at() <= upper
        });
        for tag in diet.tags() {
            let entry = counts.entry(tag.clone()).or_default();
            entry.1 += 1;
            entry.0 += u32::from(positive);
        }
    }
    Ok(counts
        .into_iter()
        .map(|(tag, (positive_meals, eligible_meals))| TagBowelResponse {
            tag,
            positive_meals,
            eligible_meals,
            rate: if eligible_meals == 0 {
                0.0
            } else {
                f64::from(positive_meals) / f64::from(eligible_meals)
            },
        })
        .collect())
}
