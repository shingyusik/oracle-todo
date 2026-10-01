use super::TodoService;
use crate::application::error::{TodoError, TodoResult};
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
    pub future_occurrences: Option<i64>,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    pub routine_id: Option<String>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub horizon: Option<String>,
    pub priority: Option<i64>,
    pub clear_priority: bool,
    pub tags: Option<Vec<String>>,
    pub location: Option<String>,
    pub participants: Option<Vec<String>>,
    pub commitment_type: Option<String>,
    pub reason: Option<String>,
}

impl TodoService {
    pub fn update_item(&mut self, item_id: &str, request: UpdateItem) -> TodoResult<TodoItem> {
        self.update_item_if_current(item_id, request, None)
    }

    pub fn update_item_if_current(
        &mut self,
        item_id: &str,
        request: UpdateItem,
        expected_updated_at: Option<time::OffsetDateTime>,
    ) -> TodoResult<TodoItem> {
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
            future_occurrences,
            area,
            project_id,
            parent_id,
            routine_id,
            due,
            scheduled,
            horizon,
            priority,
            clear_priority,
            tags,
            location,
            participants,
            commitment_type,
            reason,
        } = request;
        let mut item = self.get(item_id)?;
        if expected_updated_at.is_some_and(|expected| expected != item.updated_at) {
            return Err(TodoError::Conflict(
                "Item changed since it was read".to_string(),
            ));
        }
        if terminal_status(item.status) {
            return Err(TodoError::Policy(format!(
                "Cannot update terminal item: {}",
                item.status.as_str()
            )));
        }
        super::policy::deprecated(description.as_deref(), routine_id.as_deref())?;
        super::policy::priority(priority)?;
        if clear_priority && priority.is_some() {
            return Err(TodoError::Validation(
                "priority and clear_priority cannot be combined".into(),
            ));
        }
        super::policy::review_cycle(review_cycle.as_deref())?;
        super::policy::date(due.as_deref(), "due", false)?;
        if item.item_type != ItemType::Goal {
            super::policy::date(
                scheduled.as_deref(),
                "scheduled",
                item.item_type == ItemType::Event,
            )?;
        }
        let recurrence_rule = recurrence_rule
            .map(|rule| super::policy::recurrence(&rule, item.created_at.date()))
            .transpose()?;
        let kind = item.item_type;
        for (provided, allowed, field) in [
            (
                outcome.is_some() || definition_of_done.is_some(),
                kind == ItemType::Project,
                "project fields",
            ),
            (
                standard.is_some() || review_cycle.is_some(),
                kind == ItemType::Area,
                "area fields",
            ),
            (
                recurrence_rule.is_some() || materialization_policy.is_some(),
                kind == ItemType::Routine,
                "routine fields",
            ),
            (
                area.is_some(),
                matches!(
                    kind,
                    ItemType::Project | ItemType::Routine | ItemType::Task | ItemType::Event
                ),
                "area",
            ),
            (
                project_id.is_some(),
                matches!(kind, ItemType::Routine | ItemType::Task | ItemType::Event),
                "project_id",
            ),
            (
                parent_id.is_some(),
                matches!(kind, ItemType::Goal | ItemType::Task),
                "parent_id",
            ),
            (
                due.is_some(),
                matches!(kind, ItemType::Project | ItemType::Task | ItemType::Event),
                "due",
            ),
            (
                scheduled.is_some(),
                matches!(kind, ItemType::Goal | ItemType::Task | ItemType::Event),
                "scheduled",
            ),
            (
                priority.is_some() || clear_priority,
                matches!(kind, ItemType::Routine | ItemType::Task | ItemType::Event),
                "priority",
            ),
        ] {
            if provided && !allowed {
                return Err(TodoError::Validation(format!(
                    "{field} is unsupported on {}",
                    kind.as_str()
                )));
            }
        }
        if future_occurrences.is_some() {
            return Err(TodoError::Validation(
                "future_occurrences can only change through materialize".into(),
            ));
        }
        if definition_of_done
            .as_ref()
            .is_some_and(|v| v.trim().is_empty())
        {
            return Err(TodoError::Validation(
                "definition_of_done must not be blank".into(),
            ));
        }
        if kind == ItemType::Event && scheduled.as_ref().is_some_and(|v| v.trim().is_empty()) {
            return Err(TodoError::Validation(
                "Event requires scheduled time".into(),
            ));
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
            self.validate_goal_nesting(
                resolved_parent_id.as_deref(),
                next_horizon,
                Some(&item.id),
            )?;

            next_goal_parent_id = Some(resolved_parent_id);
            item.horizon = Some(next_horizon.as_str().to_string());
            item.scheduled = Some(canonical_scheduled);
        }

        if let Some(title) = title {
            item.title = title;
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
            item.area_id = if area.trim().is_empty() {
                None
            } else {
                self.find_area(Some(area))?
            };
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
        if let Some(due) = due {
            item.due = if due.is_empty() { None } else { Some(due) };
        }
        match scheduled {
            Some(scheduled) if item.item_type != ItemType::Goal => {
                item.scheduled = if scheduled.is_empty() {
                    None
                } else {
                    Some(scheduled)
                };
            }
            _ => {}
        }
        if let Some(priority) = priority {
            item.priority = Some(priority);
        }
        if clear_priority {
            item.priority = None;
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
        self.store_items_and_events_checked(
            vec![(Actor::User, "update_item", before, item, reason.as_deref())],
            expected_updated_at,
        )?
        .pop()
        .ok_or_else(|| TodoError::Internal("Update returned no item".to_string()))
    }
}
