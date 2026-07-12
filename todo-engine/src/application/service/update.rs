use super::TodoService;
use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::ListFilter;
use crate::domain::{Actor, Horizon, ItemType, TodoItem, terminal_status};

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
    pub horizon: Option<String>,
    pub priority: Option<i64>,
    pub tags: Option<Vec<String>>,
    pub location: Option<String>,
    pub participants: Option<Vec<String>>,
    pub commitment_type: Option<String>,
    pub reason: Option<String>,
}

impl TodoService {
    pub fn update_item(&mut self, item_id: &str, request: UpdateItem) -> TodoResult<TodoItem> {
        let UpdateItem {
            title,
            description,
            note,
            outcome,
            definition_of_done,
            standard,
            review_cycle,
            recurrence_rule,
            materialization_policy,
            area,
            project_id,
            parent_id,
            routine_id,
            due,
            scheduled,
            horizon,
            priority,
            tags,
            location,
            participants,
            commitment_type,
            reason,
        } = request;
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

        if horizon.is_some() && item.item_type != ItemType::Goal {
            return Err(TodoError::Policy(
                "Horizon can only be updated on goal items".to_string(),
            ));
        }
        if (location.is_some() || participants.is_some() || commitment_type.is_some())
            && item.item_type != ItemType::Event
        {
            return Err(TodoError::Policy(
                "Event metadata fields can only be updated on event items".to_string(),
            ));
        }

        let mut next_goal_parent_id = None;
        if item.item_type == ItemType::Goal
            && (parent_id.is_some() || horizon.is_some() || scheduled.is_some())
        {
            let next_horizon = horizon
                .as_deref()
                .or(item.horizon.as_deref())
                .ok_or_else(|| TodoError::Policy("Goal missing horizon".to_string()))?
                .parse::<Horizon>()
                .map_err(TodoError::Validation)?;
            let next_scheduled = scheduled
                .as_deref()
                .or(item.scheduled.as_deref())
                .ok_or_else(|| TodoError::Policy("Goal missing scheduled anchor".to_string()))?;
            let resolved_parent_id = if let Some(parent_id) = parent_id.clone() {
                if parent_id.trim().is_empty() {
                    None
                } else {
                    self.ensure_relation(Some(parent_id), ItemType::Goal, "Goal parent")?
                }
            } else {
                item.parent_id.clone()
            };
            let canonical_scheduled = self.validate_goal_anchor(next_horizon, next_scheduled)?;
            self.validate_goal_nesting(resolved_parent_id.as_deref(), next_horizon)?;

            let duplicate = self
                .list_items(ListFilter {
                    item_type: Some(ItemType::Goal),
                    ..Default::default()
                })?
                .into_iter()
                .any(|existing| {
                    existing.id != item.id
                        && existing.horizon.as_deref() == Some(next_horizon.as_str())
                        && existing.scheduled.as_deref() == Some(canonical_scheduled.as_str())
                        && existing.parent_id == resolved_parent_id
                });
            if duplicate {
                return Err(TodoError::GoalDuplicatePeriod {
                    horizon: next_horizon,
                    scheduled: canonical_scheduled,
                    parent_id: resolved_parent_id,
                });
            }

            next_goal_parent_id = Some(resolved_parent_id);
            item.horizon = Some(next_horizon.as_str().to_string());
            item.scheduled = Some(canonical_scheduled);
        }

        if let Some(title) = title {
            item.title = title;
        }
        if let Some(description) = description {
            item.description = Some(description);
        }
        if let Some(note) = note {
            item.note = Some(note);
        }
        if let Some(outcome) = outcome {
            item.outcome = Some(outcome);
        }
        if let Some(definition_of_done) = definition_of_done {
            item.definition_of_done = Some(definition_of_done);
        }
        if let Some(standard) = standard {
            item.standard = Some(standard);
        }
        if let Some(review_cycle) = review_cycle {
            item.review_cycle = Some(review_cycle);
        }
        if let Some(recurrence_rule) = recurrence_rule {
            item.recurrence_rule = Some(recurrence_rule);
        }
        if let Some(materialization_policy) = materialization_policy {
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
        if let Some(area) = area {
            item.area_id = self.find_area(Some(area))?;
        }
        if let Some(project_id) = project_id {
            item.project_id = if project_id.trim().is_empty() {
                None
            } else {
                self.ensure_relation(Some(project_id), ItemType::Project, "Project")?
            };
        }
        if item.item_type == ItemType::Goal {
            if let Some(parent_id) = next_goal_parent_id {
                item.parent_id = parent_id;
            }
        } else if let Some(parent_id) = parent_id {
            item.parent_id = if parent_id.trim().is_empty() {
                None
            } else {
                self.ensure_relation(Some(parent_id), ItemType::Goal, "Goal parent")?
            };
        }
        if let Some(routine_id) = routine_id {
            item.routine_id = if routine_id.trim().is_empty() {
                None
            } else {
                self.ensure_relation(Some(routine_id), ItemType::Routine, "Routine")?
            };
        }
        if let Some(due) = due {
            item.due = Some(due);
        }
        if item.item_type != ItemType::Goal {
            if let Some(scheduled) = scheduled {
                item.scheduled = Some(scheduled);
            }
        }
        if let Some(priority) = priority {
            item.priority = Some(priority);
        }
        if let Some(tags) = tags {
            item.tags = super::normalize_tags(tags);
        }
        if let Some(location) = location {
            item.metadata
                .insert("location".to_string(), serde_json::Value::String(location));
        }
        if let Some(participants) = participants {
            item.metadata.insert(
                "participants".to_string(),
                serde_json::Value::Array(
                    participants
                        .into_iter()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            );
        }
        if let Some(commitment_type) = commitment_type {
            item.metadata.insert(
                "commitment_type".to_string(),
                serde_json::Value::String(commitment_type),
            );
        }

        let now = self.next_now();
        item.updated_at = now;
        self.store_item_and_event(Actor::User, "update_item", before, item, reason.as_deref())
    }
}
