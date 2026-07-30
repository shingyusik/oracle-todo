use std::collections::BTreeMap;

use serde::Serialize;
use time::{Date, Duration, Month};

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{EntryQuery, LedgerRepository};
use crate::application::queries::{ReadModel, collect_entries, load_read_model};
use crate::application::service::LedgerService;
use crate::domain::{EntryType, LedgerEntry};

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

impl<R: LedgerRepository> LedgerService<R> {
    pub fn monthly_summary(&self, month: YearMonth) -> LedgerResult<LedgerSummary> {
        self.summary(month.range()?)
    }

    pub fn summary(&self, range: ReportRange) -> LedgerResult<LedgerSummary> {
        let (entries, model) = report_data(&self.repository, range)?;
        summarize(range, &entries, &model)
    }

    pub fn account_breakdown(&self, range: ReportRange) -> LedgerResult<Vec<BreakdownRow>> {
        let (entries, model) = report_data(&self.repository, range)?;
        breakdown(entries, &model, BreakdownKind::Account)
    }

    pub fn category_breakdown(&self, range: ReportRange) -> LedgerResult<Vec<BreakdownRow>> {
        let (entries, model) = report_data(&self.repository, range)?;
        breakdown(entries, &model, BreakdownKind::Category)
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

fn report_data<R: LedgerRepository>(
    repository: &R,
    range: ReportRange,
) -> LedgerResult<(Vec<LedgerEntry>, ReadModel)> {
    let entries = collect_entries(
        repository,
        EntryQuery {
            date_from: Some(range.start),
            date_to: Some(range.end),
            ..EntryQuery::default()
        },
    )?;
    let model = load_read_model(repository, true)?;
    Ok((entries, model))
}

fn summarize(
    range: ReportRange,
    entries: &[LedgerEntry],
    model: &ReadModel,
) -> LedgerResult<LedgerSummary> {
    let mut totals = BTreeMap::<(String, String), CurrencySummary>::new();
    for entry in entries {
        let code = currency_code(model, entry.currency_id());
        let row = totals
            .entry((code.clone(), entry.currency_id().to_string()))
            .or_insert_with(|| CurrencySummary {
                currency_id: entry.currency_id().to_string(),
                currency_code: code,
                income_minor: 0,
                expense_minor: 0,
                net_change_minor: 0,
                entry_count: 0,
            });
        let amount = entry.amount().minor_units();
        match entry.entry_type() {
            EntryType::Income => row.income_minor = checked_add(row.income_minor, amount)?,
            EntryType::Expense => row.expense_minor = checked_add(row.expense_minor, amount)?,
            _ => {}
        }
        row.net_change_minor = checked_add(
            row.net_change_minor,
            amount
                .checked_mul(i64::from(entry.entry_type().balance_sign()))
                .ok_or_else(report_overflow)?,
        )?;
        row.entry_count = row.entry_count.checked_add(1).ok_or_else(report_overflow)?;
    }
    Ok(LedgerSummary {
        range,
        currencies: totals.into_values().collect(),
    })
}

#[derive(Clone, Copy)]
enum BreakdownKind {
    Account,
    Category,
}

fn breakdown(
    entries: Vec<LedgerEntry>,
    model: &ReadModel,
    kind: BreakdownKind,
) -> LedgerResult<Vec<BreakdownRow>> {
    let mut rows = BTreeMap::<(String, String), BreakdownRow>::new();
    for entry in entries {
        let (reference_id, name) = match kind {
            BreakdownKind::Account => (
                Some(entry.account_id().to_string()),
                model
                    .account_name(entry.account_id())
                    .map(str::to_string)
                    .unwrap_or_else(|| entry.account_id().to_string()),
            ),
            BreakdownKind::Category => {
                let id = entry.transaction_category_id().map(str::to_string);
                let name = id
                    .as_deref()
                    .and_then(|id| model.transaction_category_name(id))
                    .map(str::to_string)
                    .unwrap_or_else(|| "Uncategorized".to_string());
                (id, name)
            }
        };
        let code = currency_code(model, entry.currency_id());
        let key = (
            reference_id
                .clone()
                .unwrap_or_else(|| "uncategorized".to_string()),
            entry.currency_id().to_string(),
        );
        let row = rows.entry(key).or_insert_with(|| BreakdownRow {
            reference_id,
            name,
            currency_id: entry.currency_id().to_string(),
            currency_code: code,
            income_minor: 0,
            expense_minor: 0,
            net_change_minor: 0,
            entry_count: 0,
        });
        let amount = entry.amount().minor_units();
        match entry.entry_type() {
            EntryType::Income => row.income_minor = checked_add(row.income_minor, amount)?,
            EntryType::Expense => row.expense_minor = checked_add(row.expense_minor, amount)?,
            _ => {}
        }
        row.net_change_minor = checked_add(
            row.net_change_minor,
            amount
                .checked_mul(i64::from(entry.entry_type().balance_sign()))
                .ok_or_else(report_overflow)?,
        )?;
        row.entry_count = row.entry_count.checked_add(1).ok_or_else(report_overflow)?;
    }
    let mut rows: Vec<_> = rows.into_values().collect();
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

fn currency_code(model: &ReadModel, currency_id: &str) -> String {
    model
        .currency_code(currency_id)
        .map(str::to_string)
        .unwrap_or_else(|| currency_id.to_string())
}

fn checked_add(left: i64, right: i64) -> LedgerResult<i64> {
    left.checked_add(right).ok_or_else(report_overflow)
}

fn report_overflow() -> LedgerError {
    LedgerError::Storage("ledger report minor-unit total overflow".to_string())
}
