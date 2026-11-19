//! One retention run: lock → plan → (nothing due) → disk check → backup → apply → rotate → record.

use std::collections::BTreeMap;
use std::time::Instant;

use health_engine::application::error::HealthError;
use health_engine::application::service::HealthService;
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use ledger_engine::application::error::LedgerError;
use ledger_engine::application::service::LedgerService;
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use serde::Serialize;
use todo_engine::application::error::TodoError;

use super::backup::{self, CreateRequest, elapsed_ms};
use super::plan::{EnginePlan, PlannedDomain, Window, plan_domain, stringify};
use super::state::{self, BackupRef, DomainRun, LastRun, format_instant};
use super::{Domain, LOG_TARGET, Retention, RetentionError, lock, settings};

/// Headroom over the estimated backup size, plus a fixed reserve.
const DISK_RESERVE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    Scheduled,
    Api,
    Cli,
}

impl Trigger {
    pub fn as_str(self) -> &'static str {
        match self {
            Trigger::Scheduled => "scheduled",
            Trigger::Api => "api",
            Trigger::Cli => "cli",
        }
    }
}

/// Result of a run request. `skipped` is set when no run was recorded
/// (`locked`, `clock_regressed`); `last_run` is then the previous record, if any.
#[derive(Debug, Clone, Serialize)]
pub struct RunReport {
    pub last_run: Option<LastRun>,
    pub skipped: Option<&'static str>,
}

/// Engine outcome normalized so `skipped` = plan skips + apply skips, each counted once.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Applied {
    pub purged: BTreeMap<&'static str, u64>,
    pub skipped: BTreeMap<&'static str, u64>,
    pub media_cleanup_pending: u64,
}

pub(crate) fn run(retention: &Retention, trigger: Trigger) -> Result<RunReport, RetentionError> {
    let paths = retention.paths();
    let Some(_lock) = lock::try_acquire(paths)? else {
        log_skipped("locked");
        return Ok(RunReport {
            last_run: None,
            skipped: Some("locked"),
        });
    };
    let settings = settings::load(paths)?;
    let previous = state::load(paths)?.last_run;
    let now = retention.now();
    if previous
        .as_ref()
        .and_then(LastRun::finished_at)
        .is_some_and(|last| now < last)
    {
        log_skipped("clock_regressed");
        return Ok(RunReport {
            last_run: previous,
            skipped: Some("clock_regressed"),
        });
    }

    let started = Instant::now();
    let run_id = uuid::Uuid::new_v4().simple().to_string();
    tracing::info!(
        target: LOG_TARGET,
        event = "retention_run_started",
        run_id = %run_id,
        trigger = trigger.as_str(),
        retention_days = settings.retention_days,
        "retention run started"
    );
    let window = Window::new(now, settings.retention_days, retention.inner.local_offset);
    let planned = Domain::ALL
        .into_iter()
        .map(|domain| (domain, plan_domain(retention, domain, window)))
        .collect::<Vec<_>>();

    let mut record = Record::new(run_id, trigger, now);
    let mut due = Vec::new();
    for (domain, planned) in &planned {
        match planned {
            PlannedDomain::NotInitialized => record.set(*domain, "nothing_due", None, None),
            PlannedDomain::Unavailable { error_kind } => {
                log_domain_failed(*domain, error_kind);
                record.set(*domain, "unavailable", None, None);
            }
            PlannedDomain::Planned(plan) if plan.is_empty() => {
                record.set(*domain, "nothing_due", None, Some(plan.skipped()));
            }
            PlannedDomain::Planned(plan) => due.push((*domain, plan)),
        }
    }
    if due.is_empty() {
        return record.finish(retention, None, started);
    }

    let media = due
        .iter()
        .flat_map(|(_, plan)| backup::health_media_paths(paths, plan))
        .collect::<Vec<_>>();
    let estimate = backup::estimate_bytes(paths, &due, &media);
    let required = estimate
        .saturating_add(estimate / 5)
        .saturating_add(DISK_RESERVE_BYTES);
    let free = (retention.inner.free_space)(&paths.home).unwrap_or(0);
    if free < required {
        log_skipped("insufficient_disk");
        for (domain, plan) in &due {
            record.set(*domain, "failed", None, Some(plan.skipped()));
        }
        record.outcome_override = Some("insufficient_disk");
        return record.finish(retention, None, started);
    }

    let backup_name = match backup::create(
        paths,
        &CreateRequest {
            run_id: &record.run_id,
            now,
            retention_days: settings.retention_days,
            due: &due,
            media: &media,
        },
    ) {
        Ok(name) => name,
        Err(error) => {
            for (domain, plan) in &due {
                log_domain_failed(*domain, &format!("backup_{}", error.0));
                record.set(*domain, "failed", None, Some(plan.skipped()));
            }
            record.outcome_override = Some("failed");
            return record.finish(retention, None, started);
        }
    };

    for (domain, plan) in &due {
        let result = if retention.apply_should_fail(*domain) {
            Err("injected")
        } else {
            apply(retention, plan)
        };
        match result {
            Ok(applied) => {
                tracing::info!(
                    target: LOG_TARGET,
                    event = "retention_domain_purged",
                    domain = domain.as_str(),
                    counts = %counts_text(&applied.purged),
                    "retention domain purged"
                );
                if applied.media_cleanup_pending > 0 {
                    tracing::warn!(
                        target: LOG_TARGET,
                        event = "retention_media_cleanup_pending",
                        count = applied.media_cleanup_pending,
                        "retention media cleanup pending"
                    );
                }
                record.media_cleanup_pending += applied.media_cleanup_pending;
                record.set(*domain, "ok", Some(&applied.purged), Some(&applied.skipped));
            }
            Err(error_kind) => {
                log_domain_failed(*domain, error_kind);
                record.set(*domain, "failed", None, Some(plan.skipped()));
            }
        }
    }

    match backup::rotate(paths, settings.backup_keep) {
        Ok(removed) => tracing::info!(
            target: LOG_TARGET,
            event = "retention_backup_pruned",
            removed,
            "retention backups pruned"
        ),
        Err(_) => tracing::warn!(
            target: LOG_TARGET,
            event = "retention_backup_pruned",
            removed = 0_u64,
            error_kind = "io",
            "retention backup rotation failed"
        ),
    }
    record.finish(retention, Some(backup_name), started)
}

/// Applies one planned domain through its engine and normalizes `skipped`.
pub(crate) fn apply(retention: &Retention, plan: &EnginePlan) -> Result<Applied, &'static str> {
    let paths = retention.paths();
    match plan {
        // The ToDo outcome already starts from the plan's skips.
        EnginePlan::Todo(plan) => todo_engine::retention::apply(&paths.todo_db, plan)
            .map(|outcome| Applied {
                purged: outcome.purged,
                skipped: outcome.skipped,
                media_cleanup_pending: outcome.media_cleanup_pending,
            })
            .map_err(|error| todo_error_kind(&error)),
        // The Ledger outcome already starts from the plan's skips.
        EnginePlan::Ledger(plan) => SqliteLedgerRepository::open(&paths.ledger_db)
            .and_then(|repository| LedgerService::new(repository).retention_apply(plan))
            .map(|outcome| Applied {
                purged: outcome.purged,
                skipped: outcome.skipped,
                media_cleanup_pending: outcome.media_cleanup_pending,
            })
            .map_err(|error| ledger_error_kind(&error)),
        // The Health outcome counts only apply-time skips; add the plan's.
        EnginePlan::Health(plan) => health_apply(retention, plan)
            .map(|outcome| {
                let mut skipped = plan.skipped.clone();
                merge(&mut skipped, &outcome.skipped);
                Applied {
                    purged: outcome.purged,
                    skipped,
                    media_cleanup_pending: outcome.media_cleanup_pending,
                }
            })
            .map_err(|error| health_error_kind(&error)),
    }
}

fn health_apply(
    retention: &Retention,
    plan: &health_engine::application::retention::RetentionPlan,
) -> Result<health_engine::application::retention::RetentionOutcome, HealthError> {
    let paths = retention.paths();
    let repository = SqliteHealthRepository::open(&paths.health_db)?;
    let store = match LocalMediaStore::open_existing(&paths.health_media_dir) {
        Ok(store) => store,
        Err(_) => LocalMediaStore::new(&paths.health_media_dir)?,
    };
    HealthService::new(repository, store).retention_apply(plan)
}

pub(crate) fn merge(
    target: &mut BTreeMap<&'static str, u64>,
    source: &BTreeMap<&'static str, u64>,
) {
    for (key, value) in source {
        *target.entry(key).or_insert(0) += value;
    }
}

struct Record {
    run_id: String,
    trigger: Trigger,
    started_at: time::OffsetDateTime,
    domains: BTreeMap<String, DomainRun>,
    media_cleanup_pending: u64,
    outcome_override: Option<&'static str>,
}

impl Record {
    fn new(run_id: String, trigger: Trigger, started_at: time::OffsetDateTime) -> Self {
        Self {
            run_id,
            trigger,
            started_at,
            domains: BTreeMap::new(),
            media_cleanup_pending: 0,
            outcome_override: None,
        }
    }

    fn set(
        &mut self,
        domain: Domain,
        status: &str,
        purged: Option<&BTreeMap<&'static str, u64>>,
        skipped: Option<&BTreeMap<&'static str, u64>>,
    ) {
        self.domains.insert(
            domain.as_str().to_owned(),
            DomainRun {
                status: status.to_owned(),
                purged: purged.map(stringify).unwrap_or_default(),
                skipped: skipped.map(stringify).unwrap_or_default(),
            },
        );
    }

    fn outcome(&self) -> &'static str {
        if let Some(outcome) = self.outcome_override {
            return outcome;
        }
        let failed = self
            .domains
            .values()
            .filter(|run| run.status == "failed" || run.status == "unavailable")
            .count();
        let applied = self.domains.values().any(|run| run.status == "ok");
        match failed {
            0 if applied => "ok",
            0 => "nothing_due",
            n if n == self.domains.len() => "failed",
            _ if applied || self.domains.values().any(|run| run.status == "nothing_due") => {
                "partial"
            }
            _ => "failed",
        }
    }

    fn finish(
        self,
        retention: &Retention,
        backup: Option<String>,
        started: Instant,
    ) -> Result<RunReport, RetentionError> {
        let outcome = self.outcome();
        let finished_at = retention.now().max(self.started_at);
        let purged: u64 = self
            .domains
            .values()
            .flat_map(|run| run.purged.values())
            .sum();
        let skipped: u64 = self
            .domains
            .values()
            .flat_map(|run| run.skipped.values())
            .sum();
        let last_run = LastRun {
            run_id: self.run_id,
            trigger: self.trigger.as_str().to_owned(),
            started_at: format_instant(self.started_at).unwrap_or_default(),
            finished_at: format_instant(finished_at).unwrap_or_default(),
            outcome: outcome.to_owned(),
            domains: self.domains,
            backup: backup.map(|name| BackupRef { name }),
            media_cleanup_pending: self.media_cleanup_pending,
        };
        state::save(retention.paths(), &last_run)?;
        tracing::info!(
            target: LOG_TARGET,
            event = "retention_run_completed",
            run_id = %last_run.run_id,
            outcome,
            totals = %format!(
                "purged={purged} skipped={skipped} media_cleanup_pending={}",
                last_run.media_cleanup_pending
            ),
            elapsed_ms = elapsed_ms(started),
            "retention run completed"
        );
        Ok(RunReport {
            last_run: Some(last_run),
            skipped: None,
        })
    }
}

fn counts_text(counts: &BTreeMap<&'static str, u64>) -> String {
    counts
        .iter()
        .map(|(kind, count)| format!("{kind}={count}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn log_skipped(reason: &'static str) {
    tracing::info!(
        target: LOG_TARGET,
        event = "retention_skipped",
        reason,
        "retention run skipped"
    );
}

fn log_domain_failed(domain: Domain, error_kind: &str) {
    tracing::warn!(
        target: LOG_TARGET,
        event = "retention_domain_failed",
        domain = domain.as_str(),
        error_kind,
        "retention domain failed"
    );
}

pub(crate) fn todo_error_kind(error: &TodoError) -> &'static str {
    match error {
        TodoError::Storage(_) => "storage",
        TodoError::Migration(_) => "migration",
        TodoError::Conflict(_) => "conflict",
        _ => "internal",
    }
}

pub(crate) fn ledger_error_kind(error: &LedgerError) -> &'static str {
    match error {
        LedgerError::Busy(_) => "busy",
        LedgerError::Storage(_) => "storage",
        LedgerError::Migration(_) => "migration",
        LedgerError::Conflict(_) => "conflict",
        _ => "internal",
    }
}

pub(crate) fn health_error_kind(error: &HealthError) -> &'static str {
    match error {
        HealthError::Busy(_) => "busy",
        HealthError::Storage(_) => "storage",
        HealthError::Migration(_) => "migration",
        HealthError::Conflict(_) => "conflict",
        HealthError::Cleanup { .. } | HealthError::CleanupPending { .. } => "media_cleanup",
        _ => "internal",
    }
}
