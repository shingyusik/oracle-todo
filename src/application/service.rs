use std::collections::HashMap;

use time::{Duration, OffsetDateTime, macros::datetime};
use uuid::Uuid;

use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::{ListFilter, TodoStore};
use crate::domain::{
    Actor, ItemStatus, ItemType, TodoEvent, TodoItem, hidden_by_default_status, terminal_status,
};

pub struct CreateArea {
    pub title: String,
    pub review_cycle: Option<String>,
    pub standard: Option<String>,
}

pub struct ProposeTask {
    pub actor: Actor,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub priority: Option<i64>,
    pub description: Option<String>,
}

impl Default for ProposeTask {
    fn default() -> Self {
        Self {
            actor: Actor::Oracle,
            area: None,
            project_id: None,
            routine_id: None,
            due: None,
            scheduled: None,
            priority: None,
            description: None,
        }
    }
}

pub struct ProposeProject {
    pub title: String,
    pub area: Option<String>,
    pub definition_of_done: Option<String>,
    pub outcome: Option<String>,
    pub due: Option<String>,
    pub actor: Actor,
}

pub struct ProposeEvent {
    pub title: String,
    pub actor: Actor,
    pub scheduled: Option<String>,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub due: Option<String>,
    pub priority: Option<i64>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub participants: Vec<String>,
    pub commitment_type: String,
}

#[derive(Default)]
pub struct UpdateItem {
    pub title: Option<String>,
    pub description: Option<String>,
    pub outcome: Option<String>,
    pub definition_of_done: Option<String>,
    pub standard: Option<String>,
    pub review_cycle: Option<String>,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: Option<String>,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub priority: Option<i64>,
    pub reason: Option<String>,
}

pub struct TodoService {
    store: ServiceStore,
    events: Vec<TodoEvent>,
    id_counter: u64,
    event_counter: u64,
    clock_counter: i64,
}

enum ServiceStore {
    InMemory(HashMap<String, TodoItem>),
    Persistent(Box<dyn TodoStore>),
}

impl TodoService {
    pub fn in_memory() -> Self {
        Self {
            store: ServiceStore::InMemory(HashMap::new()),
            events: Vec::new(),
            id_counter: 1,
            event_counter: 1,
            clock_counter: 0,
        }
    }

    pub fn persistent(store: impl TodoStore + 'static) -> Self {
        Self {
            store: ServiceStore::Persistent(Box::new(store)),
            events: Vec::new(),
            id_counter: 1,
            event_counter: 1,
            clock_counter: 0,
        }
    }

    pub fn create_area(&mut self, request: CreateArea) -> TodoResult<TodoItem> {
        let now = self.next_now();
        let mut item = TodoItem::new(
            self.next_id("area"),
            ItemType::Area,
            request.title,
            Actor::User,
            now,
        );
        item.status = ItemStatus::Active;
        item.review_cycle = request.review_cycle;
        item.standard = request.standard;
        self.store_item_and_event(Actor::User, "create_area", None, item, None)
    }

    pub fn propose_task(
        &mut self,
        title: impl Into<String>,
        request: ProposeTask,
    ) -> TodoResult<TodoItem> {
        let area_id = self.ensure_relation(request.area, ItemType::Area, "Area")?;
        let project_id = self.ensure_relation(request.project_id, ItemType::Project, "Project")?;
        let routine_id = self.ensure_relation(request.routine_id, ItemType::Routine, "Routine")?;
        let now = self.next_now();
        let mut item = TodoItem::new_task(self.next_id("task"), title, request.actor, now);
        item.area_id = area_id;
        item.project_id = project_id;
        item.routine_id = routine_id;
        item.due = request.due;
        item.scheduled = request.scheduled;
        item.priority = request.priority;
        item.description = request.description;
        self.store_item_and_event(item.proposed_by, "propose_task", None, item, None)
    }

    pub fn propose_project(&mut self, request: ProposeProject) -> TodoResult<TodoItem> {
        let area_id = self.ensure_relation(request.area, ItemType::Area, "Area")?;
        let now = self.next_now();
        let mut item = TodoItem::new(
            self.next_id("project"),
            ItemType::Project,
            request.title,
            request.actor,
            now,
        );
        item.area_id = area_id;
        item.definition_of_done = request.definition_of_done;
        item.outcome = request.outcome;
        item.due = request.due;
        self.store_item_and_event(item.proposed_by, "propose_project", None, item, None)
    }

    pub fn propose_event(&mut self, request: ProposeEvent) -> TodoResult<TodoItem> {
        let scheduled = request
            .scheduled
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| TodoError::Policy("Event requires scheduled time".to_string()))?;
        let area_id = self.ensure_relation(request.area, ItemType::Area, "Area")?;
        let project_id = self.ensure_relation(request.project_id, ItemType::Project, "Project")?;
        let now = self.next_now();
        let mut item = TodoItem::new(
            self.next_id("evt"),
            ItemType::Event,
            request.title,
            request.actor,
            now,
        );
        item.area_id = area_id;
        item.project_id = project_id;
        item.due = request.due;
        item.scheduled = Some(scheduled);
        item.priority = request.priority;
        item.description = request.description;
        item.metadata.insert(
            "commitment_type".to_string(),
            serde_json::Value::String(request.commitment_type),
        );
        item.metadata.insert(
            "schedule_kind".to_string(),
            serde_json::Value::String("external_commitment".to_string()),
        );
        if let Some(location) = request.location {
            item.metadata
                .insert("location".to_string(), serde_json::Value::String(location));
        }
        if !request.participants.is_empty() {
            item.metadata.insert(
                "participants".to_string(),
                serde_json::Value::Array(
                    request
                        .participants
                        .into_iter()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            );
        }
        self.store_item_and_event(item.proposed_by, "propose_event", None, item, None)
    }

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
                Ok(items
                    .into_iter()
                    .filter(|item| {
                        filter.include_archived
                            || filter.status.is_some()
                            || !hidden_by_default_status(item.status)
                    })
                    .filter(|item| filter.status.is_none_or(|status| item.status == status))
                    .filter(|item| {
                        filter
                            .item_type
                            .is_none_or(|item_type| item.item_type == item_type)
                    })
                    .filter(|item| {
                        filter
                            .area_id
                            .as_ref()
                            .is_none_or(|area_id| item.area_id.as_ref() == Some(area_id))
                    })
                    .filter(|item| {
                        filter
                            .project_id
                            .as_ref()
                            .is_none_or(|project_id| item.project_id.as_ref() == Some(project_id))
                    })
                    .filter(|item| {
                        filter
                            .routine_id
                            .as_ref()
                            .is_none_or(|routine_id| item.routine_id.as_ref() == Some(routine_id))
                    })
                    .filter(|item| {
                        filter.query.as_ref().is_none_or(|query| {
                            item.title.contains(query)
                                || item
                                    .description
                                    .as_ref()
                                    .is_some_and(|value| value.contains(query))
                                || item
                                    .outcome
                                    .as_ref()
                                    .is_some_and(|value| value.contains(query))
                        })
                    })
                    .collect())
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

    pub fn approve(&mut self, item_id: &str, _reason: Option<&str>) -> TodoResult<TodoItem> {
        let mut item = self.get(item_id)?;
        let before = Some(serde_json::to_value(&item).map_err(|error| {
            TodoError::Internal(format!("failed to snapshot item before approve: {error}"))
        })?);
        if !matches!(item.status, ItemStatus::Proposed | ItemStatus::Approved) {
            return Err(TodoError::Policy(format!(
                "Cannot approve item in status {}",
                item.status.as_str()
            )));
        }

        let now = self.next_now();
        item.status = ItemStatus::Approved;
        item.approved_by = Some(Actor::User);
        item.approved_at = Some(now);
        item.updated_at = now;
        self.store_item_and_event(Actor::User, "approve", before, item, _reason)
    }

    pub fn activate(&mut self, item_id: &str, _reason: Option<&str>) -> TodoResult<TodoItem> {
        let mut item = self.get(item_id)?;
        let before = Some(serde_json::to_value(&item).map_err(|error| {
            TodoError::Internal(format!("failed to snapshot item before activate: {error}"))
        })?);
        if item.proposed_by != Actor::User && item.approved_at.is_none() {
            return Err(TodoError::Policy(
                "Agent-created items must be approved before activation".to_string(),
            ));
        }
        if item.item_type == ItemType::Project && item.definition_of_done.is_none() {
            return Err(TodoError::Policy(
                "Project requires definition_of_done before activation".to_string(),
            ));
        }
        if item.item_type == ItemType::Area {
            return Err(TodoError::Policy(
                "Areas are ongoing and are active at creation; do not activate as work".to_string(),
            ));
        }
        if terminal_status(item.status) {
            return Err(TodoError::Policy(format!(
                "Cannot activate terminal item: {}",
                item.status.as_str()
            )));
        }

        let now = self.next_now();
        item.status = ItemStatus::Active;
        item.updated_at = now;
        self.store_item_and_event(Actor::User, "activate", before, item, _reason)
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
        self.store_item_and_event(Actor::User, "complete", before, item, _reason)
    }

    pub fn archive(&mut self, item_id: &str, reason: Option<&str>) -> TodoResult<TodoItem> {
        self.set_terminal_status(item_id, ItemStatus::Archived, "archive", reason)
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
        self.set_terminal_status_from(item, ItemStatus::Dropped, "drop", reason)
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
        self.set_terminal_status_from(item, ItemStatus::Cancelled, "cancel", reason)
    }

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
            item.area_id = self.ensure_relation(Some(area), ItemType::Area, "Area")?;
        }
        if let Some(project_id) = request.project_id {
            item.project_id =
                self.ensure_relation(Some(project_id), ItemType::Project, "Project")?;
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

    pub fn events(&self) -> &[TodoEvent] {
        &self.events
    }

    fn next_id(&mut self, prefix: &str) -> String {
        if matches!(self.store, ServiceStore::Persistent(_)) {
            return format!(
                "{prefix}_{}",
                Uuid::new_v4()
                    .simple()
                    .to_string()
                    .chars()
                    .take(12)
                    .collect::<String>()
            );
        }
        let id = format!("{prefix}_{:06}", self.id_counter);
        self.id_counter += 1;
        id
    }

    fn next_now(&mut self) -> OffsetDateTime {
        let now = datetime!(2026-05-31 12:00 UTC) + Duration::seconds(self.clock_counter);
        self.clock_counter += 1;
        now
    }

    fn store_item_and_event(
        &mut self,
        actor: Actor,
        action: &str,
        before: Option<serde_json::Value>,
        item: TodoItem,
        reason: Option<&str>,
    ) -> TodoResult<TodoItem> {
        let event = TodoEvent {
            id: self.next_event_id(),
            at: item.updated_at,
            actor,
            action: action.to_string(),
            object_type: item.item_type.as_str().to_string(),
            object_id: item.id.clone(),
            before,
            after: Some(serde_json::to_value(&item).expect("TodoItem serialization cannot fail")),
            reason: reason.map(ToOwned::to_owned),
        };
        match &mut self.store {
            ServiceStore::InMemory(items) => {
                items.insert(item.id.clone(), item.clone());
            }
            ServiceStore::Persistent(store) => {
                store.save_item_and_event(&item, &event)?;
            }
        }
        self.events.push(event);
        Ok(item)
    }

    fn set_terminal_status(
        &mut self,
        item_id: &str,
        status: ItemStatus,
        action: &str,
        reason: Option<&str>,
    ) -> TodoResult<TodoItem> {
        let item = self.get(item_id)?;
        self.set_terminal_status_from(item, status, action, reason)
    }

    fn set_terminal_status_from(
        &mut self,
        mut item: TodoItem,
        status: ItemStatus,
        action: &str,
        reason: Option<&str>,
    ) -> TodoResult<TodoItem> {
        let before = Some(serde_json::to_value(&item).map_err(|error| {
            TodoError::Internal(format!("failed to snapshot item before {action}: {error}"))
        })?);
        let now = self.next_now();
        item.status = status;
        item.archived_at = Some(now);
        item.updated_at = now;
        self.store_item_and_event(Actor::User, action, before, item, reason)
    }

    fn ensure_relation(
        &mut self,
        item_id: Option<String>,
        expected: ItemType,
        label: &str,
    ) -> TodoResult<Option<String>> {
        let Some(item_id) = item_id else {
            return Ok(None);
        };
        let item = self.get(&item_id)?;
        if item.item_type != expected {
            return Err(TodoError::Policy(format!(
                "{label} must be {}: {item_id}",
                expected.as_str()
            )));
        }
        if terminal_status(item.status) {
            return Err(TodoError::Policy(format!(
                "{label} is terminal: {}",
                item.status.as_str()
            )));
        }
        Ok(Some(item.id))
    }

    fn next_event_id(&mut self) -> String {
        if matches!(self.store, ServiceStore::Persistent(_)) {
            return format!(
                "evt_{}",
                Uuid::new_v4()
                    .simple()
                    .to_string()
                    .chars()
                    .take(12)
                    .collect::<String>()
            );
        }
        let id = format!("evt_{:06}", self.event_counter);
        self.event_counter += 1;
        id
    }
}
