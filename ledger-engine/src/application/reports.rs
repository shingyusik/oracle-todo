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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CurrencySummary {
    pub currency_id: String,
    pub currency_code: String,
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
    pub income_minor: i64,
    pub expense_minor: i64,
    pub net_change_minor: i64,
    pub entry_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LedgerComparison {
    pub current: LedgerSummary,
    pub previous: LedgerSummary,
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
        Ok(LedgerComparison {
            current: self.summary(current)?,
            previous: self.summary(previous)?,
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

fn currency_summary(record: ReportAggregateRecord) -> CurrencySummary {
    CurrencySummary {
        currency_id: record.currency_id,
        currency_code: record.currency_code,
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
