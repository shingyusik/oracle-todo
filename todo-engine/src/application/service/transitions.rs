use super::{TodoService, format_time, generated_by_routine};
use crate::application::error::{TodoError, TodoResult};
use crate::domain::{Actor, ItemStatus, ItemType, TodoItem, terminal_status};

impl TodoService {
    pub fn pause(&mut self, item_id: &str, reason: Option<&str>) -> TodoResult<TodoItem> {
        let mut item = self.get(item_id)?;
        let before = Some(serde_json::to_value(&item).map_err(|error| {
            TodoError::Internal(format!("failed to snapshot item before pause: {error}"))
        })?);
        if item.item_type == ItemType::Area {
            return Err(TodoError::Policy(
                "Areas cannot be paused here; archive them if no longer maintained".to_string(),
            ));
        }
        if terminal_status(item.status) {
            return Err(TodoError::Policy(format!(
                "Cannot pause terminal item: {}",
                item.status.as_str()
            )));
        }

        let now = self.next_now();
        item.status = ItemStatus::Paused;
        item.updated_at = now;
        let paused = self.store_item_and_event(Actor::User, "pause", before, item, reason)?;
        if paused.item_type == ItemType::Routine {
            self.cascade_routine_generated_tasks(
                &paused.id,
                ItemStatus::Waiting,
                "routine_pause_generated_task",
                reason,
                None,
            )?;
        }
        Ok(paused)
    }

    pub fn resume(&mut self, item_id: &str, reason: Option<&str>) -> TodoResult<TodoItem> {
        let mut item = self.get(item_id)?;
        let before = Some(serde_json::to_value(&item).map_err(|error| {
            TodoError::Internal(format!("failed to snapshot item before resume: {error}"))
        })?);
        if item.item_type == ItemType::Area {
            return Err(TodoError::Policy(
                "Areas are ongoing and are active at creation; do not resume them".to_string(),
            ));
        }
        if terminal_status(item.status) {
            return Err(TodoError::Policy(format!(
                "Cannot resume terminal item: {}",
                item.status.as_str()
            )));
        }
        if item.status != ItemStatus::Paused {
            return Err(TodoError::Policy(format!(
                "Cannot resume item in status {}",
                item.status.as_str()
            )));
        }
        if item.item_type == ItemType::Routine && item.recurrence_rule.is_none() {
            return Err(TodoError::Policy(
                "Routine requires recurrence_rule before resume".to_string(),
            ));
        }

        let now = self.next_now();
        item.status = ItemStatus::Active;
        item.updated_at = now;
        let resumed = self.store_item_and_event(Actor::User, "resume", before, item, reason)?;
        if resumed.item_type == ItemType::Routine {
            self.cascade_routine_generated_tasks(
                &resumed.id,
                ItemStatus::Active,
                "routine_resume_generated_task",
                reason,
                Some(ItemStatus::Waiting),
            )?;
            self.fill_routine_to_target(&resumed.id, resumed.updated_at.date())?;
            return self.get(&resumed.id);
        }
        Ok(resumed)
    }

    pub fn complete(&mut self, item_id: &str, _reason: Option<&str>) -> TodoResult<TodoItem> {
        let mut item = self.get(item_id)?;
        let before = Some(serde_json::to_value(&item).map_err(|error| {
            TodoError::Internal(format!("failed to snapshot item before complete: {error}"))
        })?);
        if item.item_type == ItemType::Area {
            return Err(TodoError::Policy(
                "Areas cannot be completed; pause or archive them".to_string(),
            ));
        }
        if terminal_status(item.status) {
            return Err(TodoError::Policy(format!(
                "Already terminal: {}",
                item.status.as_str()
            )));
        }

        let now = self.next_now();
        item.status = ItemStatus::Completed;
        item.completed_at = Some(now);
        item.updated_at = now;
        let item = self.store_item_and_event(Actor::User, "complete", before, item, _reason)?;
        self.record_generated_task_occurrence(&item, Actor::User, _reason)?;
        match (generated_by_routine(&item), item.routine_id.as_deref()) {
            (true, Some(routine_id)) => {
                self.fill_routine_to_target(routine_id, item.updated_at.date())?;
            }
            _ => {}
        }
        Ok(item)
    }

    pub fn reopen(&mut self, item_id: &str, reason: Option<&str>) -> TodoResult<TodoItem> {
        let mut item = self.get(item_id)?;
        let before = Some(serde_json::to_value(&item).map_err(|error| {
            TodoError::Internal(format!("failed to snapshot item before reopen: {error}"))
        })?);
        if !matches!(item.item_type, ItemType::Task | ItemType::Event) {
            return Err(TodoError::Policy(
                "Only completed tasks and events can be reopened".to_string(),
            ));
        }
        if item.status != ItemStatus::Completed {
            return Err(TodoError::Policy(format!(
                "Cannot reopen {} in status {}",
                item.item_type.as_str(),
                item.status.as_str()
            )));
        }

        let now = self.next_now();
        item.status = ItemStatus::Active;
        item.completed_at = None;
        item.updated_at = now;
        self.store_item_and_event(Actor::User, "reopen", before, item, reason)
    }

    pub fn archive(&mut self, item_id: &str, reason: Option<&str>) -> TodoResult<TodoItem> {
        let archived =
            self.set_terminal_status(item_id, ItemStatus::Archived, "archive", reason)?;
        self.record_generated_task_occurrence(&archived, Actor::User, reason)?;
        if archived.item_type == ItemType::Routine {
            self.cascade_routine_generated_tasks(
                &archived.id,
                ItemStatus::Archived,
                "routine_archive_generated_task",
                reason,
                None,
            )?;
            return self.get(&archived.id);
        }
        Ok(archived)
    }

    pub fn drop(&mut self, item_id: &str, reason: Option<&str>) -> TodoResult<TodoItem> {
        let item = self.get(item_id)?;
        if item.item_type == ItemType::Area {
            return Err(TodoError::Policy(
                "Areas cannot be dropped; archive or pause them".to_string(),
            ));
        }
        if terminal_status(item.status) {
            return Err(TodoError::Policy(format!(
                "Already terminal: {}",
                item.status.as_str()
            )));
        }
        let dropped = self.set_terminal_status_from(item, ItemStatus::Dropped, "drop", reason)?;
        self.record_generated_task_occurrence(&dropped, Actor::User, reason)?;
        Ok(dropped)
    }

    pub fn cancel(&mut self, item_id: &str, reason: Option<&str>) -> TodoResult<TodoItem> {
        let item = self.get(item_id)?;
        if item.item_type == ItemType::Area {
            return Err(TodoError::Policy(
                "Areas cannot be cancelled; archive or pause them".to_string(),
            ));
        }
        if terminal_status(item.status) {
            return Err(TodoError::Policy(format!(
                "Already terminal: {}",
                item.status.as_str()
            )));
        }
        let cancelled =
            self.set_terminal_status_from(item, ItemStatus::Cancelled, "cancel", reason)?;
        self.record_generated_task_occurrence(&cancelled, Actor::User, reason)?;
        if cancelled.item_type == ItemType::Routine {
            self.cascade_routine_generated_tasks(
                &cancelled.id,
                ItemStatus::Cancelled,
                "routine_cancel_generated_task",
                reason,
                None,
            )?;
            return self.get(&cancelled.id);
        }
        Ok(cancelled)
    }

    pub(super) fn cascade_routine_generated_tasks(
        &mut self,
        routine_id: &str,
        status: ItemStatus,
        action: &str,
        reason: Option<&str>,
        from_status: Option<ItemStatus>,
    ) -> TodoResult<Vec<TodoItem>> {
        let tasks = self.generated_tasks_for_routine(routine_id)?;
        let mut changed = Vec::new();
        for task in tasks {
            if terminal_status(task.status) {
                continue;
            }
            if from_status.is_some_and(|expected| task.status != expected) {
                continue;
            }
            changed.push(self.transition_generated_task(task, status, action, reason)?);
        }
        Ok(changed)
    }

    pub(super) fn transition_generated_task(
        &mut self,
        mut task: TodoItem,
        status: ItemStatus,
        action: &str,
        reason: Option<&str>,
    ) -> TodoResult<TodoItem> {
        let before = Some(serde_json::to_value(&task).map_err(|error| {
            TodoError::Internal(format!("failed to snapshot item before {action}: {error}"))
        })?);
        let now = self.next_now();
        task.status = status;
        task.updated_at = now;
        if terminal_status(status) {
            task.archived_at = Some(now);
            if status == ItemStatus::Completed {
                task.completed_at = Some(now);
            }
        }
        let task = self.store_item_and_event(Actor::User, action, before, task, reason)?;
        self.record_generated_task_occurrence(&task, Actor::User, reason)?;
        Ok(task)
    }

    pub(super) fn record_generated_task_occurrence(
        &mut self,
        task: &TodoItem,
        actor: Actor,
        reason: Option<&str>,
    ) -> TodoResult<()> {
        if task.item_type != ItemType::Task
            || task.routine_id.is_none()
            || task.occurrence_key.is_none()
            || !generated_by_routine(task)
        {
            return Ok(());
        }
        let routine_id = task.routine_id.as_ref().expect("checked routine_id");
        let occurrence_key = task
            .occurrence_key
            .as_ref()
            .expect("checked occurrence_key")
            .clone();
        let mut routine = self.get(routine_id)?;
        let before = Some(serde_json::to_value(&routine).map_err(|error| {
            TodoError::Internal(format!(
                "failed to snapshot routine before occurrence update: {error}"
            ))
        })?);
        let mut metadata = routine.metadata.clone();
        let mut occurrences = metadata
            .remove("occurrences")
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        let mut occurrence = serde_json::Map::new();
        occurrence.insert(
            "status".to_string(),
            serde_json::Value::String(task.status.as_str().to_string()),
        );
        occurrence.insert(
            "task_id".to_string(),
            serde_json::Value::String(task.id.clone()),
        );
        occurrence.insert(
            "at".to_string(),
            serde_json::Value::String(format_time(task.updated_at)?),
        );
        if let Some(scheduled) = &task.scheduled {
            occurrence.insert(
                "scheduled".to_string(),
                serde_json::Value::String(scheduled.clone()),
            );
        }
        occurrences.insert(
            occurrence_key.clone(),
            serde_json::Value::Object(occurrence.clone()),
        );
        let mut last_occurrence = occurrence;
        last_occurrence.insert(
            "occurrence_key".to_string(),
            serde_json::Value::String(occurrence_key),
        );
        metadata.insert(
            "occurrences".to_string(),
            serde_json::Value::Object(occurrences),
        );
        metadata.insert(
            "last_occurrence".to_string(),
            serde_json::Value::Object(last_occurrence),
        );
        routine.metadata = metadata;
        routine.updated_at = self.next_now();
        self.store_item_and_event(
            actor,
            &format!("routine_occurrence_{}", task.status.as_str()),
            before,
            routine,
            reason,
        )?;
        Ok(())
    }
}
