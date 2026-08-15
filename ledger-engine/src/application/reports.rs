use std::cmp::min;
use std::collections::BTreeMap;

use serde::Serialize;
use time::{Date, Duration, Month};

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{LedgerReadRepository, ReportAggregateRecord};
use crate::application::service::LedgerService;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct YearMonth {
    year: i32,
    month: u8,
}

impl YearMonth {
    pub fn new(year: i32, month: u8) -> LedgerResult<Self> {
        Month::try_from(month).map_err(|_| LedgerError::Validation {
            field: "month",
            message: "month must be between 1 and 12".to_string(),
        })?;
        Ok(Self { year, month })
    }

    pub const fn year(self) -> i32 {
        self.year
    }

    pub const fn month(self) -> u8 {
        self.month
    }

    fn range(self) -> LedgerResult<ReportRange> {
        let month = Month::try_from(self.month).map_err(|_| LedgerError::Validation {
            field: "month",
            message: "month must be between 1 and 12".to_string(),
        })?;
        let start = Date::from_calendar_date(self.year, month, 1).map_err(|error| {
            LedgerError::Validation {
                field: "month",
                message: error.to_string(),
            }
        })?;
        let (next_year, next_month) = if self.month == 12 {
            (
                self.year
                    .checked_add(1)
                    .ok_or_else(|| LedgerError::Validation {
                        field: "month",
                        message: "month exceeds the supported date range".to_string(),
                    })?,
                Month::January,
            )
        } else {
            (
                self.year,
                Month::try_from(self.month + 1).expect("validated next month"),
            )
        };
        let next = Date::from_calendar_date(next_year, next_month, 1).map_err(|error| {
            LedgerError::Validation {
                field: "month",
                message: error.to_string(),
            }
        })?;
        ReportRange::new(start, next - Duration::days(1))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ReportRange {
    pub start: Date,
    pub end: Date,
}

impl ReportRange {
    pub fn new(start: Date, end: Date) -> LedgerResult<Self> {
        if start > end {
            return Err(LedgerError::Validation {
                field: "date_range",
                message: "report start must be on or before report end".to_string(),
            });
        }
        Ok(Self { start, end })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportPeriod {
    CurrentMonth,
    PreviousMonth,
    CurrentYear,
    Custom(ReportRange),
}

impl ReportPeriod {
    pub fn comparison_ranges(self, as_of: Date) -> LedgerResult<(ReportRange, ReportRange)> {
        let current = match self {
            Self::CurrentMonth => month_range(as_of.year(), as_of.month())?,
            Self::PreviousMonth => {
                let (year, month) = previous_month(as_of.year(), as_of.month())?;
                month_range(year, month)?
            }
            Self::CurrentYear => year_range(as_of.year())?,
            Self::Custom(range) => range,
        };
        let previous = match self {
            Self::CurrentMonth | Self::PreviousMonth => {
                let (year, month) = previous_month(current.start.year(), current.start.month())?;
                month_range(year, month)?
            }
            Self::CurrentYear => {
                year_range(as_of.year().checked_sub(1).ok_or_else(date_overflow)?)?
            }
            Self::Custom(_) => {
                let days = (current.end - current.start).whole_days() + 1;
                let end = checked_sub_days(current.start, 1)?;
                ReportRange::new(checked_sub_days(current.start, days)?, end)?
            }
        };
        Ok((current, previous))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CurrencySummary {
    pub currency_id: String,
    pub currency_code: String,
    pub decimal_places: u8,
    pub income_minor: i64,
    pub expense_minor: i64,
    /// Signed balance movement across every entry type. Transfer pairs cancel.
    pub net_change_minor: i64,
    pub entry_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LedgerSummary {
    pub range: ReportRange,
    /// Totals are partitioned by currency; unlike minor units are never added.
    pub currencies: Vec<CurrencySummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BreakdownRow {
    pub reference_id: Option<String>,
    pub name: String,
    pub currency_id: String,
    pub currency_code: String,
    pub decimal_places: u8,
    pub income_minor: i64,
    pub expense_minor: i64,
    pub net_change_minor: i64,
    pub entry_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LedgerComparison {
    pub current: LedgerSummary,
    pub previous: LedgerSummary,
    pub currencies: Vec<CurrencyComparison>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CurrencyComparison {
    pub currency_id: String,
    pub currency_code: String,
    pub current: CurrencySummary,
    pub previous: CurrencySummary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrendGranularity {
    Daily,
    Weekly,
    Monthly,
}

const MAX_TREND_BUCKETS: usize = 366;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TrendPoint {
    pub start: Date,
    pub end: Date,
    pub income_minor: i64,
    pub expense_minor: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CurrencyTrend {
    pub currency_id: String,
    pub currency_code: String,
    pub points: Vec<TrendPoint>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LedgerTrend {
    pub range: ReportRange,
    pub granularity: TrendGranularity,
    pub currencies: Vec<CurrencyTrend>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LedgerBriefing {
    pub summary: LedgerSummary,
    pub markdown: String,
}

#[allow(private_bounds)]
impl<R: LedgerReadRepository> LedgerService<R> {
    pub fn monthly_summary(&self, month: YearMonth) -> LedgerResult<LedgerSummary> {
        self.summary(month.range()?)
    }

    pub fn summary(&self, range: ReportRange) -> LedgerResult<LedgerSummary> {
        let currencies = self
            .repository
            .summarize_entries(range.start, range.end)?
            .into_iter()
            .map(currency_summary)
            .collect();
        Ok(LedgerSummary { range, currencies })
    }

    pub fn account_breakdown(&self, range: ReportRange) -> LedgerResult<Vec<BreakdownRow>> {
        breakdown_rows(self.repository.account_breakdown(range.start, range.end)?)
    }

    pub fn category_breakdown(&self, range: ReportRange) -> LedgerResult<Vec<BreakdownRow>> {
        breakdown_rows(self.repository.category_breakdown(range.start, range.end)?)
    }

    pub fn compare(
        &self,
        current: ReportRange,
        previous: ReportRange,
    ) -> LedgerResult<LedgerComparison> {
        let current = self.summary(current)?;
        let previous = self.summary(previous)?;
        let currencies = align_comparison(&current.currencies, &previous.currencies);
        Ok(LedgerComparison {
            current,
            previous,
            currencies,
        })
    }

    pub fn trend(
        &self,
        range: ReportRange,
        granularity: Option<TrendGranularity>,
    ) -> LedgerResult<LedgerTrend> {
        let range = ReportRange::new(range.start, range.end)?;
        let granularity = granularity.unwrap_or_else(|| automatic_granularity(range));
        validate_trend_bucket_count(range, granularity)?;
        let spans = trend_spans(range, granularity)?;
        let mut grouped = BTreeMap::<(String, String), BTreeMap<Date, (i64, i64)>>::new();
        for record in self.repository.daily_report(range.start, range.end)? {
            let start = bucket_start(record.date, range, granularity)?;
            let totals = grouped
                .entry((record.currency_code, record.currency_id))
                .or_default()
                .entry(start)
                .or_default();
            totals.0 = totals
                .0
                .checked_add(record.income_minor)
                .ok_or_else(report_overflow)?;
            totals.1 = totals
                .1
                .checked_add(record.expense_minor)
                .ok_or_else(report_overflow)?;
        }
        let currencies = grouped
            .into_iter()
            .map(|((currency_code, currency_id), totals)| CurrencyTrend {
                currency_id,
                currency_code,
                points: spans
                    .iter()
                    .map(|&(start, end)| {
                        let (income_minor, expense_minor) =
                            totals.get(&start).copied().unwrap_or_default();
                        TrendPoint {
                            start,
                            end,
                            income_minor,
                            expense_minor,
                        }
                    })
                    .collect(),
            })
            .collect();
        Ok(LedgerTrend {
            range,
            granularity,
            currencies,
        })
    }

    pub fn briefing(&self, range: ReportRange) -> LedgerResult<LedgerBriefing> {
        let summary = self.summary(range)?;
        let mut lines = vec![
            "# Ledger briefing".to_string(),
            format!("{} — {}", range.start, range.end),
        ];
        for currency in &summary.currencies {
            lines.push(format!(
                "{}: income {}, expense {}, net {}",
                currency.currency_code,
                currency.income_minor,
                currency.expense_minor,
                currency.net_change_minor
            ));
        }
        if summary.currencies.is_empty() {
            lines.push("No ledger activity.".to_string());
        }
        Ok(LedgerBriefing {
            summary,
            markdown: lines.join("\n"),
        })
    }
}

fn align_comparison(
    current: &[CurrencySummary],
    previous: &[CurrencySummary],
) -> Vec<CurrencyComparison> {
    let mut rows =
        BTreeMap::<(String, String), (Option<&CurrencySummary>, Option<&CurrencySummary>)>::new();
    for row in current {
        rows.entry((row.currency_code.clone(), row.currency_id.clone()))
            .or_default()
            .0 = Some(row);
    }
    for row in previous {
        rows.entry((row.currency_code.clone(), row.currency_id.clone()))
            .or_default()
            .1 = Some(row);
    }
    rows.into_iter()
        .map(|((currency_code, currency_id), (current, previous))| {
            let decimal_places = current
                .or(previous)
                .expect("comparison row exists")
                .decimal_places;
            CurrencyComparison {
                current: current
                    .cloned()
                    .unwrap_or_else(|| zero_summary(&currency_id, &currency_code, decimal_places)),
                previous: previous
                    .cloned()
                    .unwrap_or_else(|| zero_summary(&currency_id, &currency_code, decimal_places)),
                currency_id,
                currency_code,
            }
        })
        .collect()
}

fn zero_summary(currency_id: &str, currency_code: &str, decimal_places: u8) -> CurrencySummary {
    CurrencySummary {
        currency_id: currency_id.to_string(),
        currency_code: currency_code.to_string(),
        decimal_places,
        income_minor: 0,
        expense_minor: 0,
        net_change_minor: 0,
        entry_count: 0,
    }
}

fn automatic_granularity(range: ReportRange) -> TrendGranularity {
    match (range.end - range.start).whole_days() + 1 {
        0..=62 => TrendGranularity::Daily,
        63..=180 => TrendGranularity::Weekly,
        _ => TrendGranularity::Monthly,
    }
}

fn trend_spans(
    range: ReportRange,
    granularity: TrendGranularity,
) -> LedgerResult<Vec<(Date, Date)>> {
    let mut spans = Vec::new();
    let mut start = range.start;
    loop {
        let end = min(bucket_end(start, granularity)?, range.end);
        spans.push((start, end));
        if end == range.end {
            return Ok(spans);
        }
        start = end.next_day().ok_or_else(date_overflow)?;
    }
}

fn validate_trend_bucket_count(
    range: ReportRange,
    granularity: TrendGranularity,
) -> LedgerResult<()> {
    let mut count = 0;
    let mut start = range.start;
    loop {
        count += 1;
        if count > MAX_TREND_BUCKETS {
            return Err(LedgerError::Validation {
                field: "date_range",
                message: format!("trend range exceeds {MAX_TREND_BUCKETS} buckets"),
            });
        }
        let end = min(bucket_end(start, granularity)?, range.end);
        if end == range.end {
            return Ok(());
        }
        start = end.next_day().ok_or_else(date_overflow)?;
    }
}

fn bucket_start(
    date: Date,
    range: ReportRange,
    granularity: TrendGranularity,
) -> LedgerResult<Date> {
    let start = match granularity {
        TrendGranularity::Daily => date,
        TrendGranularity::Weekly => date
            .checked_sub(Duration::days(i64::from(
                date.weekday().number_days_from_monday(),
            )))
            .unwrap_or(Date::MIN),
        TrendGranularity::Monthly => {
            Date::from_calendar_date(date.year(), date.month(), 1).unwrap_or(Date::MIN)
        }
    };
    Ok(start.max(range.start))
}

fn bucket_end(start: Date, granularity: TrendGranularity) -> LedgerResult<Date> {
    match granularity {
        TrendGranularity::Daily => Ok(start),
        TrendGranularity::Weekly => Ok(start
            .checked_add(Duration::days(i64::from(
                6 - start.weekday().number_days_from_monday(),
            )))
            .unwrap_or(Date::MAX)),
        TrendGranularity::Monthly => {
            let next = if start.month() == Month::December {
                start
                    .year()
                    .checked_add(1)
                    .and_then(|year| Date::from_calendar_date(year, Month::January, 1).ok())
            } else {
                Date::from_calendar_date(
                    start.year(),
                    Month::try_from(u8::from(start.month()) + 1)
                        .expect("calendar month has a successor"),
                    1,
                )
                .ok()
            };
            Ok(next
                .and_then(|date| date.previous_day())
                .unwrap_or(Date::MAX))
        }
    }
}

fn month_range(year: i32, month: Month) -> LedgerResult<ReportRange> {
    YearMonth::new(year, u8::from(month)).and_then(YearMonth::range)
}

fn year_range(year: i32) -> LedgerResult<ReportRange> {
    let start = Date::from_calendar_date(year, Month::January, 1).map_err(|_| date_overflow())?;
    let end = Date::from_calendar_date(year, Month::December, 31).map_err(|_| date_overflow())?;
    ReportRange::new(start, end)
}

fn previous_month(year: i32, month: Month) -> LedgerResult<(i32, Month)> {
    if month == Month::January {
        Ok((
            year.checked_sub(1).ok_or_else(date_overflow)?,
            Month::December,
        ))
    } else {
        Ok((
            year,
            Month::try_from(u8::from(month) - 1).expect("calendar month has a predecessor"),
        ))
    }
}

fn checked_sub_days(date: Date, days: i64) -> LedgerResult<Date> {
    date.checked_sub(Duration::days(days))
        .ok_or_else(date_overflow)
}

fn date_overflow() -> LedgerError {
    LedgerError::Validation {
        field: "date_range",
        message: "report range exceeds the supported date range".to_string(),
    }
}

fn report_overflow() -> LedgerError {
    LedgerError::Storage("ledger report total overflow".to_string())
}

fn currency_summary(record: ReportAggregateRecord) -> CurrencySummary {
    CurrencySummary {
        currency_id: record.currency_id,
        currency_code: record.currency_code,
        decimal_places: record.decimal_places,
        income_minor: record.income_minor,
        expense_minor: record.expense_minor,
        net_change_minor: record.net_change_minor,
        entry_count: record.entry_count,
    }
}

fn breakdown_rows(records: Vec<ReportAggregateRecord>) -> LedgerResult<Vec<BreakdownRow>> {
    let mut rows: Vec<_> = records
        .into_iter()
        .map(|record| BreakdownRow {
            reference_id: record.reference_id,
            name: record.name.unwrap_or_else(|| "Uncategorized".to_string()),
            currency_id: record.currency_id,
            currency_code: record.currency_code,
            decimal_places: record.decimal_places,
            income_minor: record.income_minor,
            expense_minor: record.expense_minor,
            net_change_minor: record.net_change_minor,
            entry_count: record.entry_count,
        })
        .collect();
    rows.sort_by(|left, right| {
        left.currency_code
            .cmp(&right.currency_code)
            .then_with(|| right.expense_minor.cmp(&left.expense_minor))
            .then_with(|| right.income_minor.cmp(&left.income_minor))
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.reference_id.cmp(&right.reference_id))
    });
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weekly_and_monthly_boundaries_saturate_at_date_limits() {
        let minimum = ReportRange {
            start: Date::MIN,
            end: Date::MIN,
        };
        assert_eq!(
            bucket_start(Date::MIN, minimum, TrendGranularity::Weekly).unwrap(),
            Date::MIN
        );
        assert_eq!(
            bucket_end(Date::MAX, TrendGranularity::Weekly).unwrap(),
            Date::MAX
        );
        assert_eq!(
            bucket_end(Date::MAX, TrendGranularity::Monthly).unwrap(),
            Date::MAX
        );
    }
}
