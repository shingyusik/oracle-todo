use super::{ServiceStore, TodoService, parse_day};
use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::{ListFilter, apply_list_filter};
use crate::domain::{ItemStatus, ItemType, TodoItem, terminal_status};
use time::Date;

/// D-05 open-only allowlist: only these statuses surface in date-view reads.
/// Copied from `today_tasks`; do NOT rely on `list_items` hidden-by-default
/// alone (it leaks Completed/Waiting/Paused/Someday/Rejected).
const OPEN_STATUSES: [ItemStatus; 3] = [
    ItemStatus::Proposed,
    ItemStatus::Approved,
    ItemStatus::Active,
];

impl TodoService {
    pub fn get(&mut self, item_id: &str) -> TodoResult<TodoItem> {
        match &mut self.store {
            ServiceStore::InMemory(items) => items
                .get(item_id)
                .cloned()
                .ok_or_else(|| TodoError::NotFound(item_id.to_string())),
            ServiceStore::Persistent(store) => store
                .get_item(item_id)?
                .ok_or_else(|| TodoError::NotFound(item_id.to_string())),
        }
    }

    pub fn list_items(&mut self, filter: ListFilter) -> TodoResult<Vec<TodoItem>> {
        match &mut self.store {
            ServiceStore::InMemory(items) => {
                let mut items = items.values().cloned().collect::<Vec<_>>();
                items.sort_by(|left, right| {
                    left.created_at
                        .cmp(&right.created_at)
                        .then_with(|| left.id.cmp(&right.id))
                });
                Ok(apply_list_filter(items, filter))
            }
            ServiceStore::Persistent(store) => store.list_items(filter),
        }
    }

    pub fn archive_items(&mut self) -> TodoResult<Vec<TodoItem>> {
        Ok(self
            .list_items(ListFilter {
                include_archived: true,
                ..Default::default()
            })?
            .into_iter()
            .filter(|item| terminal_status(item.status))
            .collect())
    }

    /// Single-date agenda (VIEW-05 / SC3, D-02): open tasks where
    /// `scheduled == date OR due == date`. A single date naturally dedups by id
    /// (each item is retained at most once). Due-included rows are NOT tagged
    /// (D-04) — the adapter discriminates via the `scheduled`/`due` fields.
    /// A junk `date` propagates `TodoError::Validation` from `parse_day`.
    pub fn agenda(&mut self, date: &str) -> TodoResult<Vec<TodoItem>> {
        let day = parse_day(date)?;
        let mut items = self.open_tasks()?;
        items.retain(|item| {
            iso_day(item.scheduled.as_deref()) == Some(day)
                || iso_day(item.due.as_deref()) == Some(day)
        });
        sort_date_view(&mut items);
        Ok(items)
    }

    /// Arbitrary `[from, to]` range (VIEW-02 / SC1, D-03): open tasks whose
    /// `scheduled` falls within the inclusive bounds, scheduled-ONLY (no
    /// due-spanning — that is single-date agenda only). `time::Date` is `Ord`, so
    /// the bounds compare directly; non-ISO/None `scheduled` is excluded from the
    /// range match. Junk `from`/`to` propagate `TodoError::Validation`.
    pub fn date_range(&mut self, from: &str, to: &str) -> TodoResult<Vec<TodoItem>> {
        let (from, to) = (parse_day(from)?, parse_day(to)?);
        let mut items = self.open_tasks()?;
        items.retain(|item| {
            iso_day(item.scheduled.as_deref()).is_some_and(|day| from <= day && day <= to)
        });
        sort_date_view(&mut items);
        Ok(items)
    }

    /// Open (`Proposed`/`Approved`/`Active`) tasks only, the shared base for the
    /// date-view methods. Composes `list_items` so InMemory and Persistent stores
    /// agree (SC4 parity); the open-only narrowing is the D-05 allowlist.
    fn open_tasks(&mut self) -> TodoResult<Vec<TodoItem>> {
        Ok(self
            .list_items(ListFilter {
                item_type: Some(ItemType::Task),
                ..Default::default()
            })?
            .into_iter()
            .filter(|item| OPEN_STATUSES.contains(&item.status))
            .collect())
    }
}

/// Parse the ISO day out of a `scheduled`/`due` value. The leading-10-char window
/// matches both bare `"2026-06-23"` and timestamped `"2026-06-23T.."` values;
/// `None`, the legacy `"today"` sentinel, and junk all collapse to `None`
/// (D-07 — unscheduled, never an error here). Discarding the parse error is
/// intentional: a non-ISO date is an unscheduled signal, not a caller error.
fn iso_day(value: Option<&str>) -> Option<Date> {
    parse_day(value?.get(..10)?).ok()
}

/// D-08 deterministic order: primary key is `iso_day(scheduled)` ascending with
/// `None` (unscheduled) LAST, then the existing `created_at -> id` tie-break
/// reused from `list_items`. No priority/alpha sort, no new semantics.
fn sort_date_view(items: &mut [TodoItem]) {
    items.sort_by(|left, right| {
        let ka = iso_day(left.scheduled.as_deref());
        let kb = iso_day(right.scheduled.as_deref());
        ka.is_none()
            .cmp(&kb.is_none())
            .then_with(|| ka.cmp(&kb))
            .then_with(|| left.created_at.cmp(&right.created_at))
            .then_with(|| left.id.cmp(&right.id))
    });
}
