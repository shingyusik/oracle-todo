use time::Date;

use super::{TodoService, generated_by_routine, parse_day, validate_future_occurrences};
use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::ListFilter;
use crate::domain::{Actor, ItemStatus, ItemType, TodoItem, future_occurrences, terminal_status};

impl TodoService {
    pub(super) fn fill_routine_to_target(
        &mut self,
        routine_id: &str,
        today: Date,
    ) -> TodoResult<Vec<TodoItem>> {
        let mut routine = self.get(routine_id)?;
        if routine.item_type != ItemType::Routine || routine.status != ItemStatus::Active {
            return Ok(Vec::new());
        }
        let Some(rule) = routine.recurrence_rule.clone() else {
            return Ok(Vec::new());
        };
        let generated = self
            .generated_tasks_for_routine(routine_id)?
            .into_iter()
            .filter(generated_by_routine)
            .collect::<Vec<_>>();
        let target = if routine.materialization_policy == "single_open" {
            1
        } else {
            routine.future_occurrences as usize
        };
        let open = generated
            .iter()
            .filter(|task| !terminal_status(task.status))
            .count();
        if open >= target {
            return Ok(Vec::new());
        }

        let dates = generated
            .iter()
            .filter_map(|task| task.occurrence_key.as_deref())
            .map(parse_day)
            .collect::<TodoResult<Vec<_>>>()?;
        let anchor = dates.iter().copied().min().unwrap_or(today);
        let latest = dates.iter().copied().max();
        let yesterday = today.previous_day().unwrap_or(Date::MIN);
        let after = latest.map_or(yesterday, |latest| latest.max(yesterday));
        let candidates =
            future_occurrences(&rule, anchor, after, target - open).map_err(|error| {
                TodoError::Policy(format!("Unsupported recurrence_rule: {}", error.rule()))
            })?;
        let mut created = Vec::new();
        for occurrence in candidates {
            if let Some(task) = self.claim_occurrence(&routine, occurrence.to_string())? {
                created.push(task);
            }
        }
        self.mark_routine_materialized(&mut routine)?;
        Ok(created)
    }

    pub fn materialize_routines(&mut self, today: &str) -> TodoResult<Vec<TodoItem>> {
        let today = parse_day(today)?;
        let routines = self.list_items(ListFilter {
            status: Some(ItemStatus::Active),
            item_type: Some(ItemType::Routine),
            include_archived: true,
            ..Default::default()
        })?;
        let mut created = Vec::new();

        for routine in routines {
            created.extend(self.fill_routine_to_target(&routine.id, today)?);
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
        today: &str,
        future_occurrences: Option<i64>,
    ) -> TodoResult<Vec<TodoItem>> {
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
        if let Some(target) = future_occurrences {
            let target = validate_future_occurrences(target)?;
            if routine.future_occurrences != target {
                let before = Some(serde_json::to_value(&routine).map_err(|error| {
                    TodoError::Internal(format!(
                        "failed to snapshot item before update_materialization_target: {error}"
                    ))
                })?);
                routine.future_occurrences = target;
                routine.updated_at = self.next_now();
                self.store_item_and_event(
                    Actor::User,
                    "update_materialization_target",
                    before,
                    routine,
                    None,
                )?;
            }
        }
        self.fill_routine_to_target(routine_id, parse_day(today)?)
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
