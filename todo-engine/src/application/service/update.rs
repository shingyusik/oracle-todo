use super::TodoService;
use crate::application::error::{TodoError, TodoResult};
use crate::domain::{Actor, ItemType, TodoItem, terminal_status};

#[derive(Default)]
pub struct UpdateItem {
    pub title: Option<String>,
    pub description: Option<String>,
    pub note: Option<String>,
    pub outcome: Option<String>,
    pub definition_of_done: Option<String>,
    pub standard: Option<String>,
    pub review_cycle: Option<String>,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: Option<String>,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    pub routine_id: Option<String>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub priority: Option<i64>,
    pub reason: Option<String>,
}

impl TodoService {
    pub fn update_item(&mut self, item_id: &str, request: UpdateItem) -> TodoResult<TodoItem> {
        let mut item = self.get(item_id)?;
        if terminal_status(item.status) {
            return Err(TodoError::Policy(format!(
                "Cannot update terminal item: {}",
                item.status.as_str()
            )));
        }
        let before = Some(serde_json::to_value(&item).map_err(|error| {
            TodoError::Internal(format!(
                "failed to snapshot item before update_item: {error}"
            ))
        })?);

        if let Some(title) = request.title {
            item.title = title;
        }
        if let Some(description) = request.description {
            item.description = Some(description);
        }
        if let Some(note) = request.note {
            item.note = Some(note);
        }
        if let Some(outcome) = request.outcome {
            item.outcome = Some(outcome);
        }
        if let Some(definition_of_done) = request.definition_of_done {
            item.definition_of_done = Some(definition_of_done);
        }
        if let Some(standard) = request.standard {
            item.standard = Some(standard);
        }
        if let Some(review_cycle) = request.review_cycle {
            item.review_cycle = Some(review_cycle);
        }
        if let Some(recurrence_rule) = request.recurrence_rule {
            item.recurrence_rule = Some(recurrence_rule);
        }
        if let Some(materialization_policy) = request.materialization_policy {
            if !matches!(
                materialization_policy.as_str(),
                "single_open" | "per_occurrence"
            ) {
                return Err(TodoError::Policy(format!(
                    "Unsupported materialization_policy: {materialization_policy}"
                )));
            }
            item.materialization_policy = materialization_policy;
        }
        if let Some(area) = request.area {
            item.area_id = self.find_area(Some(area))?;
        }
        if let Some(project_id) = request.project_id {
            item.project_id =
                self.ensure_relation(Some(project_id), ItemType::Project, "Project")?;
        }
        if let Some(parent_id) = request.parent_id {
            item.parent_id = self.ensure_relation(Some(parent_id), ItemType::Goal, "Goal parent")?;
        }
        if let Some(routine_id) = request.routine_id {
            item.routine_id =
                self.ensure_relation(Some(routine_id), ItemType::Routine, "Routine")?;
        }
        if let Some(due) = request.due {
            item.due = Some(due);
        }
        if let Some(scheduled) = request.scheduled {
            item.scheduled = Some(scheduled);
        }
        if let Some(priority) = request.priority {
            item.priority = Some(priority);
        }

        let now = self.next_now();
        item.updated_at = now;
        self.store_item_and_event(
            Actor::User,
            "update_item",
            before,
            item,
            request.reason.as_deref(),
        )
    }
}
