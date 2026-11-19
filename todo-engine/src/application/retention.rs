//! Retention purge vocabulary shared by the planner and the purge transaction.
//!
//! The storage-side `plan`/`apply` live in `infrastructure::sqlite::retention`.

use std::collections::BTreeMap;

use time::{Date, OffsetDateTime};

pub const KIND_TODO_ITEM: &str = "todo_item";

pub const SKIP_REFERENCED: &str = "referenced";
pub const SKIP_ROUTINE_ANCHOR: &str = "routine_anchor";
pub const SKIP_FUTURE_OCCURRENCE: &str = "future_occurrence";
pub const SKIP_UNPARSEABLE_TIMESTAMP: &str = "unparseable_timestamp";
pub const SKIP_CHANGED_SINCE_PLAN: &str = "changed_since_plan";

/// The instant a run is evaluated at. Records whose clock is at or before
/// `cutoff` are due; `local_today` protects future routine occurrences.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionWindow {
    pub now: OffsetDateTime,
    pub cutoff: OffsetDateTime,
    pub local_today: Date,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionCandidate {
    pub kind: &'static str,
    pub id: String,
    pub label: String,
    pub archived_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionPlan {
    pub window: RetentionWindow,
    pub candidates: Vec<RetentionCandidate>,
    pub skipped: BTreeMap<&'static str, u64>,
}

impl RetentionPlan {
    pub fn empty(window: RetentionWindow) -> Self {
        Self {
            window,
            candidates: Vec::new(),
            skipped: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RetentionOutcome {
    pub purged: BTreeMap<&'static str, u64>,
    pub skipped: BTreeMap<&'static str, u64>,
    pub media_cleanup_pending: u64,
}
