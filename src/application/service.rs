use std::collections::HashMap;

use time::{Duration, OffsetDateTime, macros::datetime};

use crate::application::error::{TodoError, TodoResult};
use crate::domain::{Actor, ItemStatus, ItemType, TodoEvent, TodoItem, terminal_status};

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

pub struct TodoService {
    items: HashMap<String, TodoItem>,
    events: Vec<TodoEvent>,
    id_counter: u64,
    event_counter: u64,
    clock_counter: i64,
}

impl TodoService {
    pub fn in_memory() -> Self {
        Self {
            items: HashMap::new(),
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
        let item = self.store(item);
        self.record_event(Actor::User, "create_area", None, &item, None);
        Ok(item)
    }

    pub fn propose_task(
        &mut self,
        title: impl Into<String>,
        request: ProposeTask,
    ) -> TodoResult<TodoItem> {
        let now = self.next_now();
        let mut item = TodoItem::new_task(self.next_id("task"), title, request.actor, now);
        item.area_id = request.area;
        item.project_id = request.project_id;
        item.routine_id = request.routine_id;
        item.due = request.due;
        item.scheduled = request.scheduled;
        item.priority = request.priority;
        item.description = request.description;
        let item = self.store(item);
        self.record_event(item.proposed_by, "propose_task", None, &item, None);
        Ok(item)
    }

    pub fn propose_project(&mut self, request: ProposeProject) -> TodoResult<TodoItem> {
        let now = self.next_now();
        let mut item = TodoItem::new(
            self.next_id("project"),
            ItemType::Project,
            request.title,
            request.actor,
            now,
        );
        item.area_id = request.area;
        item.definition_of_done = request.definition_of_done;
        item.outcome = request.outcome;
        item.due = request.due;
        let item = self.store(item);
        self.record_event(item.proposed_by, "propose_project", None, &item, None);
        Ok(item)
    }

    pub fn get(&self, item_id: &str) -> TodoResult<TodoItem> {
        self.items
            .get(item_id)
            .cloned()
            .ok_or_else(|| TodoError::NotFound(item_id.to_string()))
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
        let item = self.store(item);
        self.record_event(Actor::User, "approve", before, &item, _reason);
        Ok(item)
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
        let item = self.store(item);
        self.record_event(Actor::User, "activate", before, &item, _reason);
        Ok(item)
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
        let item = self.store(item);
        self.record_event(Actor::User, "complete", before, &item, _reason);
        Ok(item)
    }

    pub fn events(&self) -> &[TodoEvent] {
        &self.events
    }

    fn next_id(&mut self, prefix: &str) -> String {
        let id = format!("{prefix}_{:06}", self.id_counter);
        self.id_counter += 1;
        id
    }

    fn next_now(&mut self) -> OffsetDateTime {
        let now = datetime!(2026-05-31 12:00 UTC) + Duration::seconds(self.clock_counter);
        self.clock_counter += 1;
        now
    }

    fn store(&mut self, item: TodoItem) -> TodoItem {
        self.items.insert(item.id.clone(), item.clone());
        item
    }

    fn record_event(
        &mut self,
        actor: Actor,
        action: &str,
        before: Option<serde_json::Value>,
        item: &TodoItem,
        reason: Option<&str>,
    ) {
        let event = TodoEvent {
            id: self.next_event_id(),
            at: item.updated_at,
            actor,
            action: action.to_string(),
            object_type: item.item_type.as_str().to_string(),
            object_id: item.id.clone(),
            before,
            after: Some(serde_json::to_value(item).expect("TodoItem serialization cannot fail")),
            reason: reason.map(ToOwned::to_owned),
        };
        self.events.push(event);
    }

    fn next_event_id(&mut self) -> String {
        let id = format!("evt_{:06}", self.event_counter);
        self.event_counter += 1;
        id
    }
}
