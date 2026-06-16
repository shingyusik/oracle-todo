use time::Duration;

use super::{TodoService, generated_by_routine, parse_day};
use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::ListFilter;
use crate::domain::{Actor, ItemStatus, ItemType, TodoItem, occurrences, terminal_status};

impl TodoService {
    pub fn materialize_routines(
        &mut self,
        now: &str,
        lookahead_days: i64,
        catchup_days: i64,
    ) -> TodoResult<Vec<TodoItem>> {
        let anchor = parse_day(now)?;
        let start = anchor - Duration::days(catchup_days);
        let end = anchor + Duration::days(lookahead_days);
        let routines = self.list_items(ListFilter {
            status: Some(ItemStatus::Active),
            item_type: Some(ItemType::Routine),
            include_archived: true,
            ..Default::default()
        })?;
        let mut created = Vec::new();

        for mut routine in routines {
            let Some(rule) = routine.recurrence_rule.clone() else {
                continue;
            };
            let occurrence_dates = occurrences(&rule, start, end).map_err(|error| {
                TodoError::Policy(format!("Unsupported recurrence_rule: {}", error.rule()))
            })?;
            match routine.materialization_policy.as_str() {
                "single_open" => {
                    if self.open_generated_task_exists_for_routine(&routine.id)? {
                        continue;
                    }
                    for occurrence in occurrence_dates {
                        let occurrence_key = occurrence.to_string();
                        if self
                            .generated_task_exists_for_occurrence(&routine.id, &occurrence_key)?
                        {
                            continue;
                        }
                        created.push(self.create_generated_task(&routine, occurrence_key)?);
                        break;
                    }
                    self.mark_routine_materialized(&mut routine)?;
                }
                "per_occurrence" => {
                    for occurrence in occurrence_dates {
                        let occurrence_key = occurrence.to_string();
                        if self
                            .generated_task_exists_for_occurrence(&routine.id, &occurrence_key)?
                        {
                            continue;
                        }
                        created.push(self.create_generated_task(&routine, occurrence_key)?);
                    }
                    self.mark_routine_materialized(&mut routine)?;
                }
                unsupported => {
                    return Err(TodoError::Policy(format!(
                        "Unsupported materialization_policy: {unsupported}"
                    )));
                }
            }
        }

        Ok(created)
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
