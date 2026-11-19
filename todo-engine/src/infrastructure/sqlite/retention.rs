//! Retention purge of long-hidden ToDo items.
//!
//! `plan` is a read path: it never creates or migrates a store. `apply` deletes
//! only planned ids, re-evaluating every one of them inside its own
//! `BEGIN IMMEDIATE` transaction, erases their events and leaves one
//! payload-free tombstone per item.

use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags, TransactionBehavior, params};
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use super::mapping::storage_error;
use crate::application::error::{TodoError, TodoResult};
use crate::application::retention::{
    KIND_TODO_ITEM, RetentionCandidate, RetentionOutcome, RetentionPlan, RetentionWindow,
    SKIP_CHANGED_SINCE_PLAN, SKIP_FUTURE_OCCURRENCE, SKIP_REFERENCED, SKIP_ROUTINE_ANCHOR,
    SKIP_UNPARSEABLE_TIMESTAMP,
};
use crate::domain::{Actor, ItemStatus, hidden_by_default_status, terminal_status};

const ROOTS_PER_TRANSACTION: usize = 200;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const SUPPORTED_SCHEMA_VERSION: i64 = 1;

pub fn plan(db_path: &Path, window: &RetentionWindow) -> TodoResult<RetentionPlan> {
    let Some(conn) = open_existing(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)? else {
        return Ok(RetentionPlan::empty(*window));
    };
    conn.busy_timeout(BUSY_TIMEOUT).map_err(storage_error)?;
    if !initialized(&conn)? {
        return Ok(RetentionPlan::empty(*window));
    }
    let rows = load_rows(&conn)?;
    let evaluation = evaluate(&rows, window, None);

    let mut skipped = evaluation.skipped;
    if evaluation.referenced > 0 {
        *skipped.entry(SKIP_REFERENCED).or_default() += evaluation.referenced;
    }
    let mut candidates = evaluation
        .purge
        .iter()
        .map(|(id, clock)| RetentionCandidate {
            kind: KIND_TODO_ITEM,
            id: id.clone(),
            label: rows[id].title.clone(),
            archived_at: *clock,
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        left.archived_at
            .cmp(&right.archived_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(RetentionPlan {
        window: *window,
        candidates,
        skipped,
    })
}

pub fn apply(db_path: &Path, plan: &RetentionPlan) -> TodoResult<RetentionOutcome> {
    let mut outcome = RetentionOutcome {
        skipped: plan.skipped.clone(),
        ..Default::default()
    };
    if plan.candidates.is_empty() {
        return Ok(outcome);
    }
    let Some(mut conn) = open_existing(db_path, OpenFlags::SQLITE_OPEN_READ_WRITE)? else {
        *outcome.skipped.entry(SKIP_CHANGED_SINCE_PLAN).or_default() +=
            plan.candidates.len() as u64;
        return Ok(outcome);
    };
    conn.busy_timeout(BUSY_TIMEOUT).map_err(storage_error)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;")
        .map_err(storage_error)?;
    let version = super::user_version(&conn)?;
    if version != SUPPORTED_SCHEMA_VERSION {
        return Err(TodoError::Migration(format!(
            "unsupported todo schema version {version}"
        )));
    }

    let mut remaining = plan
        .candidates
        .iter()
        .map(|candidate| (candidate.id.clone(), candidate.archived_at))
        .collect::<BTreeMap<_, _>>();
    let mut purged = 0_u64;
    let mut changed = 0_u64;
    while !remaining.is_empty() {
        purged += purge_batch(&mut conn, &plan.window, &mut remaining, &mut changed)?;
    }
    if purged > 0 {
        outcome.purged.insert(KIND_TODO_ITEM, purged);
    }
    if changed > 0 {
        *outcome.skipped.entry(SKIP_CHANGED_SINCE_PLAN).or_default() += changed;
    }
    Ok(outcome)
}

/// One transaction: re-evaluate every remaining planned id, drop the ones that
/// changed, and purge a reference-closed batch of at most 200 roots.
fn purge_batch(
    conn: &mut Connection,
    window: &RetentionWindow,
    remaining: &mut BTreeMap<String, OffsetDateTime>,
    changed: &mut u64,
) -> TodoResult<u64> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage_error)?;
    let rows = load_rows(&tx)?;
    let still_due = evaluate(&rows, window, Some(remaining)).purge;
    let before = remaining.len();
    remaining.retain(|id, _| still_due.contains_key(id));
    *changed += (before - remaining.len()) as u64;

    let batch = children_first(&rows, &still_due)
        .into_iter()
        .take(ROOTS_PER_TRANSACTION)
        .collect::<Vec<_>>();
    if batch.is_empty() {
        tx.commit().map_err(storage_error)?;
        return Ok(0);
    }

    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS retention_ids (id TEXT NOT NULL PRIMARY KEY);
         DELETE FROM temp.retention_ids;",
    )
    .map_err(storage_error)?;
    {
        let mut insert = tx
            .prepare("INSERT INTO temp.retention_ids (id) VALUES (?1)")
            .map_err(storage_error)?;
        for id in &batch {
            insert.execute([id]).map_err(storage_error)?;
        }
    }
    tx.execute(
        "DELETE FROM events WHERE object_id IN (SELECT id FROM temp.retention_ids)",
        [],
    )
    .map_err(storage_error)?;
    let at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| TodoError::Internal(error.to_string()))?;
    {
        let mut tombstone = tx
            .prepare(
                "INSERT INTO events (id, at, actor, action, object_type, object_id, before, after, reason)
                 VALUES (?1, ?2, ?3, 'purge', ?4, ?5, NULL, NULL, 'retention')",
            )
            .map_err(storage_error)?;
        for id in &batch {
            tombstone
                .execute(params![
                    tombstone_id(),
                    at,
                    Actor::System.as_str(),
                    rows[id].item_type,
                    id
                ])
                .map_err(storage_error)?;
        }
    }
    let deleted = tx
        .execute(
            "DELETE FROM items WHERE id IN (SELECT id FROM temp.retention_ids)",
            [],
        )
        .map_err(storage_error)?;
    tx.execute("DELETE FROM temp.retention_ids", [])
        .map_err(storage_error)?;
    if deleted != batch.len() {
        return Err(TodoError::Storage(
            "retention purge deleted an unexpected number of items".to_string(),
        ));
    }
    tx.commit().map_err(storage_error)?;
    for id in &batch {
        remaining.remove(id);
    }
    Ok(batch.len() as u64)
}

fn tombstone_id() -> String {
    let uuid = Uuid::new_v4().simple().to_string();
    format!("evt_{}", &uuid[..12])
}

/// Opens an existing database file without ever creating it.
fn open_existing(path: &Path, mode: OpenFlags) -> TodoResult<Option<Connection>> {
    if !path.is_file() {
        return Ok(None);
    }
    Connection::open_with_flags(path, mode | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map(Some)
        .map_err(storage_error)
}

fn initialized(conn: &Connection) -> TodoResult<bool> {
    match super::user_version(conn)? {
        0 => Ok(false),
        SUPPORTED_SCHEMA_VERSION => {
            let tables: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'table' AND name IN ('items', 'events')",
                    [],
                    |row| row.get(0),
                )
                .map_err(storage_error)?;
            Ok(tables == 2)
        }
        version => Err(TodoError::Migration(format!(
            "unsupported todo schema version {version}"
        ))),
    }
}

struct ItemRow {
    id: String,
    item_type: String,
    title: String,
    status: Option<ItemStatus>,
    /// area_id, project_id, routine_id, parent_id.
    references: [Option<String>; 4],
    occurrence_key: Option<String>,
    archived_at: Option<String>,
    updated_at: String,
    generated_by_routine: bool,
}

impl ItemRow {
    fn routine_id(&self) -> Option<&str> {
        self.references[2].as_deref()
    }

    fn reference_targets(&self) -> impl Iterator<Item = &str> {
        self.references
            .iter()
            .flatten()
            .map(String::as_str)
            .filter(|target| *target != self.id)
    }
}

type Rows = HashMap<String, ItemRow>;

fn load_rows(conn: &Connection) -> TodoResult<Rows> {
    let mut statement = conn
        .prepare(
            "SELECT id, type, title, status, area_id, project_id, routine_id, parent_id,
                    occurrence_key, archived_at, updated_at, metadata
             FROM items",
        )
        .map_err(storage_error)?;
    let mut rows = statement.query([]).map_err(storage_error)?;
    let mut items = Rows::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        let text = |index| row.get::<_, Option<String>>(index).map_err(storage_error);
        let status = text(3)?.unwrap_or_default();
        let generated_by_routine = text(11)?
            .and_then(|metadata| serde_json::from_str::<serde_json::Value>(&metadata).ok())
            .is_some_and(|metadata| {
                metadata
                    .get("generated_by")
                    .and_then(|value| value.as_str())
                    == Some("routine")
            });
        let item = ItemRow {
            id: row.get(0).map_err(storage_error)?,
            item_type: text(1)?.unwrap_or_default(),
            title: text(2)?.unwrap_or_default(),
            status: ItemStatus::from_str(&status).ok(),
            references: [text(4)?, text(5)?, text(6)?, text(7)?],
            occurrence_key: text(8)?,
            archived_at: text(9)?,
            updated_at: text(10)?.unwrap_or_default(),
            generated_by_routine,
        };
        items.insert(item.id.clone(), item);
    }
    Ok(items)
}

struct Evaluation {
    /// Purgeable ids with their retention clock, closed under references.
    purge: BTreeMap<String, OffsetDateTime>,
    /// Due or undecidable items held back by a per-item rule.
    skipped: BTreeMap<&'static str, u64>,
    /// Due items held back because a surviving item references them.
    referenced: u64,
}

/// Decides which hidden items may be purged. With `planned`, only those ids
/// are considered, and only while their clock still matches the plan.
fn evaluate(
    rows: &Rows,
    window: &RetentionWindow,
    planned: Option<&BTreeMap<String, OffsetDateTime>>,
) -> Evaluation {
    let anchors = routine_anchors(rows);
    let mut skipped = BTreeMap::<&'static str, u64>::new();
    let mut skip = |reason| *skipped.entry(reason).or_default() += 1;
    let mut due = BTreeMap::new();
    for row in rows.values() {
        if !row.status.is_some_and(hidden_by_default_status) {
            continue;
        }
        let expected = planned.map(|planned| planned.get(&row.id));
        if expected == Some(None) {
            continue;
        }
        let Some(clock) = retention_clock(row) else {
            skip(SKIP_UNPARSEABLE_TIMESTAMP);
            continue;
        };
        if clock > window.cutoff || expected.is_some_and(|expected| expected != Some(&clock)) {
            continue;
        }
        if let (Some(_), Some(key)) = (row.routine_id(), &row.occurrence_key) {
            match parse_day(key) {
                None => {
                    skip(SKIP_UNPARSEABLE_TIMESTAMP);
                    continue;
                }
                Some(day) if day >= window.local_today => {
                    skip(SKIP_FUTURE_OCCURRENCE);
                    continue;
                }
                Some(_) => {}
            }
        }
        if anchors.contains(row.id.as_str()) {
            skip(SKIP_ROUTINE_ANCHOR);
            continue;
        }
        due.insert(row.id.clone(), clock);
    }

    // An item goes only if everything referencing it goes too (fixpoint).
    let referencers = referencers(rows);
    let mut referenced = 0;
    loop {
        let blocked = due
            .keys()
            .filter(|id| {
                referencers
                    .get(id.as_str())
                    .is_some_and(|by| by.iter().any(|other| !due.contains_key(*other)))
            })
            .cloned()
            .collect::<Vec<_>>();
        if blocked.is_empty() {
            break;
        }
        for id in blocked {
            due.remove(&id);
            referenced += 1;
        }
    }
    Evaluation {
        purge: due,
        skipped,
        referenced,
    }
}

/// `max(archived_at, updated_at)`; `None` when a present timestamp is unparseable.
fn retention_clock(row: &ItemRow) -> Option<OffsetDateTime> {
    let updated = OffsetDateTime::parse(&row.updated_at, &Rfc3339).ok()?;
    match &row.archived_at {
        None => Some(updated),
        Some(archived) => Some(OffsetDateTime::parse(archived, &Rfc3339).ok()?.max(updated)),
    }
}

fn parse_day(value: &str) -> Option<Date> {
    Date::parse(value, format_description!("[year]-[month]-[day]")).ok()
}

/// The earliest generated task of every non-terminal routine. Materialization
/// derives the recurrence phase from it, so it must outlive retention.
fn routine_anchors(rows: &Rows) -> BTreeSet<&str> {
    let mut earliest = HashMap::<&str, (Date, &str)>::new();
    for row in rows.values() {
        if row.item_type != "task" || !row.generated_by_routine {
            continue;
        }
        let (Some(routine_id), Some(day)) = (
            row.routine_id(),
            row.occurrence_key.as_deref().and_then(parse_day),
        ) else {
            continue;
        };
        let live_routine = rows.get(routine_id).is_some_and(|routine| {
            routine.item_type == "routine"
                && routine
                    .status
                    .is_some_and(|status| !terminal_status(status))
        });
        if !live_routine {
            continue;
        }
        let entry = earliest.entry(routine_id).or_insert((day, row.id.as_str()));
        if (day, row.id.as_str()) < *entry {
            *entry = (day, row.id.as_str());
        }
    }
    earliest.into_values().map(|(_, id)| id).collect()
}

/// For each item id, the ids of items that reference it (once per reference).
fn referencers(rows: &Rows) -> HashMap<&str, Vec<&str>> {
    let mut map = HashMap::<&str, Vec<&str>>::new();
    for row in rows.values() {
        for target in row.reference_targets() {
            map.entry(target).or_default().push(&row.id);
        }
    }
    map
}

/// Orders a reference-closed set so referencing items come before the items
/// they reference; any prefix of the order is then itself safe to delete.
/// Cycles (which the service never creates) are appended last.
fn children_first(rows: &Rows, set: &BTreeMap<String, OffsetDateTime>) -> Vec<String> {
    let referencers = referencers(rows);
    let mut pending = set
        .keys()
        .map(|id| {
            let count = referencers.get(id.as_str()).map_or(0, |by| {
                by.iter().filter(|other| set.contains_key(**other)).count()
            });
            (id.as_str(), count)
        })
        .collect::<BTreeMap<_, _>>();
    let mut ready = pending
        .iter()
        .filter(|(_, count)| **count == 0)
        .map(|(id, _)| *id)
        .collect::<VecDeque<_>>();
    let mut order = Vec::with_capacity(set.len());
    while let Some(id) = ready.pop_front() {
        pending.remove(id);
        order.push(id.to_string());
        for target in rows[id].reference_targets() {
            if let Some(count) = pending.get_mut(target) {
                *count -= 1;
                if *count == 0 {
                    ready.push_back(target);
                }
            }
        }
    }
    order.extend(pending.keys().map(|id| id.to_string()));
    order
}
