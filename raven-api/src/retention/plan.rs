//! Per-domain planning over the three engines' read paths, plus the preview document.

use std::collections::BTreeMap;
use std::path::Path;

use health_engine::infrastructure::sqlite::{HealthStorageHealth, SqliteHealthRepository};
use ledger_engine::infrastructure::sqlite::{LedgerHealth, SqliteLedgerRepository};
use serde::Serialize;
use time::{Duration, OffsetDateTime};
use todo_engine::interfaces::cli::TodoHealth;

use super::settings::RetentionSettings;
use super::state::format_instant;
use super::{Domain, Retention};

/// One engine's plan, kept in its native type so it can be applied unchanged.
pub(crate) enum EnginePlan {
    Todo(todo_engine::retention::RetentionPlan),
    Ledger(ledger_engine::application::retention::RetentionPlan),
    Health(health_engine::application::retention::RetentionPlan),
}

/// Engine-neutral candidate view.
pub(crate) struct CandidateView<'a> {
    pub kind: &'static str,
    pub id: &'a str,
    pub label: &'a str,
    pub archived_at: OffsetDateTime,
}

macro_rules! plan_view {
    ($plan:expr) => {
        (
            $plan
                .candidates
                .iter()
                .map(|candidate| CandidateView {
                    kind: candidate.kind,
                    id: candidate.id.as_str(),
                    label: candidate.label.as_str(),
                    archived_at: candidate.archived_at,
                })
                .collect::<Vec<_>>(),
            &$plan.skipped,
        )
    };
}

impl EnginePlan {
    pub fn candidates(&self) -> Vec<CandidateView<'_>> {
        self.view().0
    }

    pub fn skipped(&self) -> &BTreeMap<&'static str, u64> {
        self.view().1
    }

    fn view(&self) -> (Vec<CandidateView<'_>>, &BTreeMap<&'static str, u64>) {
        match self {
            EnginePlan::Todo(plan) => plan_view!(plan),
            EnginePlan::Ledger(plan) => plan_view!(plan),
            EnginePlan::Health(plan) => plan_view!(plan),
        }
    }

    pub fn is_empty(&self) -> bool {
        match self {
            EnginePlan::Todo(plan) => plan.candidates.is_empty(),
            EnginePlan::Ledger(plan) => plan.candidates.is_empty(),
            EnginePlan::Health(plan) => plan.candidates.is_empty(),
        }
    }

    pub fn kind_counts(&self) -> BTreeMap<String, u64> {
        let mut counts = BTreeMap::new();
        for candidate in self.candidates() {
            *counts.entry(candidate.kind.to_owned()).or_insert(0) += 1;
        }
        counts
    }
}

pub(crate) enum PlannedDomain {
    NotInitialized,
    Unavailable { error_kind: &'static str },
    Planned(EnginePlan),
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Window {
    pub now: OffsetDateTime,
    pub cutoff: OffsetDateTime,
    pub local_today: time::Date,
}

impl Window {
    pub fn new(now: OffsetDateTime, retention_days: u32, offset: time::UtcOffset) -> Self {
        Self {
            now,
            cutoff: now - Duration::days(i64::from(retention_days)),
            local_today: now.to_offset(offset).date(),
        }
    }
}

macro_rules! engine_window {
    ($ty:path, $window:expr) => {{
        let window = $window;
        $ty {
            now: window.now,
            cutoff: window.cutoff,
            local_today: window.local_today,
        }
    }};
}

pub(crate) fn plan_domain(retention: &Retention, domain: Domain, window: Window) -> PlannedDomain {
    let path = retention.paths().db(domain);
    if !initialized(domain, path) {
        return PlannedDomain::NotInitialized;
    }
    let result = match domain {
        Domain::Todo => todo_engine::retention::plan(
            path,
            &engine_window!(todo_engine::retention::RetentionWindow, window),
        )
        .map(EnginePlan::Todo)
        .map_err(|error| super::run::todo_error_kind(&error)),
        Domain::Ledger => ledger_engine::infrastructure::sqlite::retention_plan_at(
            path,
            &engine_window!(
                ledger_engine::application::retention::RetentionWindow,
                window
            ),
        )
        .map(EnginePlan::Ledger)
        .map_err(|error| super::run::ledger_error_kind(&error)),
        Domain::Health => SqliteHealthRepository::retention_plan_at(
            path,
            &engine_window!(
                health_engine::application::retention::RetentionWindow,
                window
            ),
        )
        .map(EnginePlan::Health)
        .map_err(|error| super::run::health_error_kind(&error)),
    };
    match result {
        Ok(plan) => PlannedDomain::Planned(plan),
        Err(error_kind) => PlannedDomain::Unavailable { error_kind },
    }
}

fn initialized(domain: Domain, path: &Path) -> bool {
    match domain {
        Domain::Todo => {
            todo_engine::interfaces::cli::health_db_at(path) != TodoHealth::NotInitialized
        }
        Domain::Ledger => SqliteLedgerRepository::health_at(path) != LedgerHealth::NotInitialized,
        Domain::Health => {
            SqliteHealthRepository::health_at(path) != HealthStorageHealth::NotInitialized
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RetentionPreview {
    pub cutoff: String,
    pub retention_days: u32,
    pub domains: BTreeMap<String, DomainPreview>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DomainPreview {
    pub status: &'static str,
    pub counts: BTreeMap<String, u64>,
    pub skipped: BTreeMap<String, u64>,
    pub items: Vec<PreviewItem>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreviewItem {
    pub kind: &'static str,
    pub id: String,
    pub label: String,
    pub archived_at: String,
}

pub(crate) fn stringify(counts: &BTreeMap<&'static str, u64>) -> BTreeMap<String, u64> {
    counts
        .iter()
        .filter(|(_, count)| **count > 0)
        .map(|(key, count)| ((*key).to_owned(), *count))
        .collect()
}

pub(crate) fn preview(
    retention: &Retention,
    settings: &RetentionSettings,
    limit: usize,
) -> RetentionPreview {
    let window = Window::new(
        retention.now(),
        settings.retention_days,
        retention.inner.local_offset,
    );
    let domains = Domain::ALL
        .into_iter()
        .map(|domain| {
            let preview = match plan_domain(retention, domain, window) {
                PlannedDomain::NotInitialized => empty_preview("not_initialized"),
                PlannedDomain::Unavailable { .. } => empty_preview("unavailable"),
                PlannedDomain::Planned(plan) => {
                    let candidates = plan.candidates();
                    DomainPreview {
                        status: "ok",
                        counts: plan.kind_counts(),
                        skipped: stringify(plan.skipped()),
                        truncated: candidates.len() > limit,
                        items: candidates
                            .into_iter()
                            .take(limit)
                            .map(|candidate| PreviewItem {
                                kind: candidate.kind,
                                id: candidate.id.to_owned(),
                                label: candidate.label.to_owned(),
                                archived_at: format_instant(candidate.archived_at)
                                    .unwrap_or_default(),
                            })
                            .collect(),
                    }
                }
            };
            (domain.as_str().to_owned(), preview)
        })
        .collect();
    RetentionPreview {
        cutoff: format_instant(window.cutoff).unwrap_or_default(),
        retention_days: settings.retention_days,
        domains,
    }
}

fn empty_preview(status: &'static str) -> DomainPreview {
    DomainPreview {
        status,
        counts: BTreeMap::new(),
        skipped: BTreeMap::new(),
        items: Vec::new(),
        truncated: false,
    }
}
