use serde::{Deserialize, Serialize};
use std::str::FromStr;
use time::{Date, Duration, Month};

/// A planning horizon: the coarseness of a period a goal anchors to.
///
/// `Year` is coarser than `Month`, which is coarser than `Week`. This ordering
/// is exposed strictly via [`Horizon::is_coarser_than`]; there is intentionally
/// no `Ord`/`PartialOrd` impl and no `_or_equal` variant (Phase 2's parent rule
/// is "parent strictly coarser than child").
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Horizon {
    Year,
    Month,
    Week,
}

impl Horizon {
    /// Stable lowercase string form (the inverse of [`Horizon::from_str`]).
    pub fn as_str(self) -> &'static str {
        match self {
            Horizon::Year => "year",
            Horizon::Month => "month",
            Horizon::Week => "week",
        }
    }

    /// Coarseness rank: lower is coarser. `Year` = 0, `Month` = 1, `Week` = 2.
    fn rank(self) -> u8 {
        match self {
            Horizon::Year => 0,
            Horizon::Month => 1,
            Horizon::Week => 2,
        }
    }

    /// Strict coarser-than ordering: `year` is coarser than `month` is coarser
    /// than `week`. Equality is NOT coarser — a horizon is never coarser than
    /// itself. Phase 2's parent check requires the parent to be *strictly*
    /// coarser than the child, so no `_or_equal` variant is provided.
    pub fn is_coarser_than(self, other: Horizon) -> bool {
        self.rank() < other.rank()
    }
}

impl FromStr for Horizon {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim() {
            "year" => Ok(Horizon::Year),
            "month" => Ok(Horizon::Month),
            "week" => Ok(Horizon::Week),
            _ => Err(format!("unknown horizon: {value}")),
        }
    }
}

/// Normalize a date to the canonical start of the period that contains it for
/// the given [`Horizon`]. This is the single canonical period-start convention
/// for the engine; every later view buckets periods through this one helper.
///
/// - `Year` -> January 1 of the date's year.
/// - `Month` -> the 1st of the date's month.
/// - `Week` -> the **ISO Monday** of the date's week.
///
/// # Key Decision: Week start = ISO Monday
///
/// The Monday of a date's week may fall in the **previous calendar year**
/// (e.g. 2026-01-01 Thu normalizes to 2025-12-29 Mon). The engine does NOT
/// clamp the week start to January 1, and it never auto-snaps a stored anchor —
/// strict rejection of non-canonical anchors is Phase 2's job (via
/// [`is_period_start`]). No view may bucket a period two ways.
pub fn normalize_to_period_start(date: Date, horizon: Horizon) -> Date {
    match horizon {
        Horizon::Year => calendar_date(date.year(), Month::January, 1),
        Horizon::Month => calendar_date(date.year(), date.month(), 1),
        // Week start = ISO Monday; may land in the prior calendar year. Never
        // clamped to Jan 1 (see the Key Decision above).
        Horizon::Week => date - Duration::days(weekday_index(date) as i64),
    }
}

/// Whether `date` already equals its canonical period start for `horizon`.
///
/// This is the strict is-canonical check Phase 2 uses to reject non-canonical
/// anchors *without* auto-snapping. It is true exactly when
/// `normalize_to_period_start(date, horizon) == date`.
pub fn is_period_start(date: Date, horizon: Horizon) -> bool {
    normalize_to_period_start(date, horizon) == date
}

/// Zero-based weekday index where Monday = 0 (mirrors recurrence.rs).
fn weekday_index(date: Date) -> i32 {
    date.weekday().number_from_monday() as i32 - 1
}

/// Infallible calendar-date constructor for already-validated components.
fn calendar_date(year: i32, month: Month, day: u8) -> Date {
    Date::from_calendar_date(year, month, day).expect("date components are validated")
}
