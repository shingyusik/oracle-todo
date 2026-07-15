use time::{Date, Duration};

use super::{TodoService, generated_by_routine, parse_day};
use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::ListFilter;
use crate::domain::{Actor, ItemStatus, ItemType, TodoItem, occurrences, terminal_status};

/// Default materialization window, shared by the CLI and the HTTP API so both
/// surfaces generate the same occurrences for the same routine.
pub const DEFAULT_LOOKAHEAD_DAYS: i64 = 7;
pub const DEFAULT_CATCHUP_DAYS: i64 = 1;

/// Upper bound on either side of the window. One materialize call creates one
/// task per occurrence with no bulk undo, so an unbounded window is a one-click
/// way to bury the item list. Matches the recurrence interval cap.
pub const MAX_WINDOW_DAYS: i64 = 365;

impl TodoService {
    pub fn materialize_routines(
        &mut self,
        now: &str,
        lookahead_days: i64,
        catchup_days: i64,
    ) -> TodoResult<Vec<TodoItem>> {
        let (start, end) = materialization_window(now, lookahead_days, catchup_days)?;
        let routines = self.list_items(ListFilter {
            status: Some(ItemStatus::Active),
            item_type: Some(ItemType::Routine),
            include_archived: true,
            ..Default::default()
        })?;
        let mut created = Vec::new();

        for mut routine in routines {
            created.extend(self.materialize_one(&mut routine, start, end)?);
        }

        Ok(created)
    }

    /// Materialize a single routine on explicit request.
    ///
    /// `materialize_routines` sweeps every active routine and silently skips the
    /// ones it cannot handle. Here the caller named one routine, so a routine it
    /// cannot materialize is reported instead of returning an empty list.
    pub fn materialize_routine(
        &mut self,
        routine_id: &str,
        now: &str,
        lookahead_days: i64,
        catchup_days: i64,
    ) -> TodoResult<Vec<TodoItem>> {
        let (start, end) = materialization_window(now, lookahead_days, catchup_days)?;
        let mut routine = self.get(routine_id)?;
        if routine.item_type != ItemType::Routine {
            return Err(TodoError::Policy(format!(
                "Routine must be routine: {routine_id}"
            )));
        }
        if routine.status != ItemStatus::Active {
            return Err(TodoError::Policy(format!(
                "Routine must be active to materialize: {}",
                routine.status.as_str()
            )));
        }
        self.materialize_one(&mut routine, start, end)
    }

    fn materialize_one(
        &mut self,
        routine: &mut TodoItem,
        start: Date,
        end: Date,
    ) -> TodoResult<Vec<TodoItem>> {
        let Some(rule) = routine.recurrence_rule.clone() else {
            return Ok(Vec::new());
        };
        let occurrence_dates = occurrences(&rule, start, end).map_err(|error| {
            TodoError::Policy(format!("Unsupported recurrence_rule: {}", error.rule()))
        })?;
        let mut created = Vec::new();

        match routine.materialization_policy.as_str() {
            "single_open" => {
                if self.open_generated_task_exists_for_routine(&routine.id)? {
                    return Ok(created);
                }
                for occurrence in occurrence_dates {
                    let occurrence_key = occurrence.to_string();
                    if self.generated_task_exists_for_occurrence(&routine.id, &occurrence_key)? {
                        continue;
                    }
                    if let Some(task) = self.claim_occurrence(routine, occurrence_key)? {
                        created.push(task);
                        break;
                    }
                }
                self.mark_routine_materialized(routine)?;
            }
            "per_occurrence" => {
                for occurrence in occurrence_dates {
                    let occurrence_key = occurrence.to_string();
                    if self.generated_task_exists_for_occurrence(&routine.id, &occurrence_key)? {
                        continue;
                    }
                    if let Some(task) = self.claim_occurrence(routine, occurrence_key)? {
                        created.push(task);
                    }
                }
                self.mark_routine_materialized(routine)?;
            }
            unsupported => {
                return Err(TodoError::Policy(format!(
                    "Unsupported materialization_policy: {unsupported}"
                )));
            }
        }

        Ok(created)
    }

    /// Create the task for an occurrence, or report that someone else got there
    /// first.
    ///
    /// The existence check above and this write are not one transaction, so a
    /// concurrent materialize of the same routine can slip between them. The
    /// unique index on `(routine_id, occurrence_key)` is what actually keeps
    /// occurrences single, and losing that race means the occurrence now exists
    /// -- the same outcome the check was looking for, so it is skipped rather
    /// than raised.
    fn claim_occurrence(
        &mut self,
        routine: &TodoItem,
        occurrence_key: String,
    ) -> TodoResult<Option<TodoItem>> {
        match self.create_generated_task(routine, occurrence_key) {
            Ok(task) => Ok(Some(task)),
            Err(TodoError::Conflict(_)) => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn create_generated_task(
        &mut self,
        routine: &TodoItem,
        occurrence_key: String,
    ) -> TodoResult<TodoItem> {
        let now = self.next_now();
        let mut task = TodoItem::new_task(
            self.next_id("task"),
            routine.title.clone(),
            Actor::System,
            now,
        );
        task.status = ItemStatus::Approved;
        task.area_id = routine.area_id.clone();
        task.routine_id = Some(routine.id.clone());
        task.occurrence_key = Some(occurrence_key.clone());
        task.scheduled = Some(occurrence_key);
        task.approved_by = Some(Actor::User);
        task.approved_at = Some(now);
        task.metadata.insert(
            "generated_by".to_string(),
            serde_json::Value::String("routine".to_string()),
        );
        self.store_item_and_event(Actor::System, "materialize_routine_task", None, task, None)
    }

    fn mark_routine_materialized(&mut self, routine: &mut TodoItem) -> TodoResult<()> {
        let before = Some(serde_json::to_value(&routine).map_err(|error| {
            TodoError::Internal(format!(
                "failed to snapshot item before materialize_routine: {error}"
            ))
        })?);
        let now = self.next_now();
        routine.last_materialized_at = Some(now);
        routine.updated_at = now;
        self.store_item_and_event(
            Actor::System,
            "materialize_routine",
            before,
            routine.clone(),
            None,
        )?;
        Ok(())
    }

    fn open_generated_task_exists_for_routine(&mut self, routine_id: &str) -> TodoResult<bool> {
        Ok(self
            .list_items(ListFilter {
                item_type: Some(ItemType::Task),
                routine_id: Some(routine_id.to_string()),
                include_archived: true,
                ..Default::default()
            })?
            .into_iter()
            .any(|item| !terminal_status(item.status)))
    }

    fn generated_task_exists_for_occurrence(
        &mut self,
        routine_id: &str,
        occurrence_key: &str,
    ) -> TodoResult<bool> {
        Ok(self
            .generated_tasks_for_routine(routine_id)?
            .into_iter()
            .any(|item| item.occurrence_key.as_deref() == Some(occurrence_key)))
    }

    pub(super) fn generated_tasks_for_routine(
        &mut self,
        routine_id: &str,
    ) -> TodoResult<Vec<TodoItem>> {
        Ok(self
            .list_items(ListFilter {
                item_type: Some(ItemType::Task),
                routine_id: Some(routine_id.to_string()),
                include_archived: true,
                ..Default::default()
            })?
            .into_iter()
            .filter(generated_by_routine)
            .collect())
    }
}

fn materialization_window(
    now: &str,
    lookahead_days: i64,
    catchup_days: i64,
) -> TodoResult<(Date, Date)> {
    validate_window_days("lookahead_days", lookahead_days)?;
    validate_window_days("catchup_days", catchup_days)?;
    let anchor = parse_day(now)?;
    Ok((
        anchor - Duration::days(catchup_days),
        anchor + Duration::days(lookahead_days),
    ))
}

fn validate_window_days(field: &str, days: i64) -> TodoResult<()> {
    if !(0..=MAX_WINDOW_DAYS).contains(&days) {
        return Err(TodoError::Validation(format!(
            "{field} must be between 0 and {MAX_WINDOW_DAYS}: {days}"
        )));
    }
    Ok(())
}
