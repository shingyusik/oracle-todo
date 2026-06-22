use std::collections::HashMap;

use time::format_description::parse as parse_format_description;
use time::{Date, Duration, OffsetDateTime, macros::datetime};
use uuid::Uuid;

use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::{ListFilter, TodoStore};
use crate::domain::{Actor, ItemStatus, ItemType, TodoEvent, TodoItem, terminal_status};

mod creation;
mod goal;
mod materialization;
mod queries;
mod transitions;
mod update;

pub use creation::{
    CreateArea, ProposeEvent, ProposeGoal, ProposeProject, ProposeRoutine, ProposeTask,
};
pub use update::UpdateItem;

pub struct TodoService {
    pub(super) store: ServiceStore,
    pub(super) events: Vec<TodoEvent>,
    pub(super) id_counter: u64,
    pub(super) event_counter: u64,
    pub(super) clock_counter: i64,
}

pub(super) enum ServiceStore {
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

    pub fn events(&self) -> &[TodoEvent] {
        &self.events
    }

    pub(super) fn next_id(&mut self, prefix: &str) -> String {
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

    pub(super) fn next_now(&mut self) -> OffsetDateTime {
        if matches!(self.store, ServiceStore::Persistent(_)) {
            return OffsetDateTime::now_utc();
        }
        let now = datetime!(2026-05-31 12:00 UTC) + Duration::seconds(self.clock_counter);
        self.clock_counter += 1;
        now
    }

    pub(super) fn find_area(&mut self, area: Option<String>) -> TodoResult<Option<String>> {
        let Some(area) = area else {
            return Ok(None);
        };

        match self.get(&area) {
            Ok(item) if item.item_type == ItemType::Area && !terminal_status(item.status) => {
                return Ok(Some(item.id));
            }
            Ok(item) => {
                return Err(TodoError::Policy(format!("Area must be area: {}", item.id)));
            }
            Err(TodoError::NotFound(_)) => {}
            Err(error) => return Err(error),
        }

        self.list_items(ListFilter {
            item_type: Some(ItemType::Area),
            ..Default::default()
        })?
        .into_iter()
        .find(|item| item.title == area && !terminal_status(item.status))
        .map(|item| Some(item.id))
        .ok_or(TodoError::NotFound(area))
    }

    pub(super) fn store_item_and_event(
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

    pub(super) fn set_terminal_status(
        &mut self,
        item_id: &str,
        status: ItemStatus,
        action: &str,
        reason: Option<&str>,
    ) -> TodoResult<TodoItem> {
        let item = self.get(item_id)?;
        self.set_terminal_status_from(item, status, action, reason)
    }

    pub(super) fn set_terminal_status_from(
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

    pub(super) fn ensure_relation(
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

    pub(super) fn next_event_id(&mut self) -> String {
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

pub(super) fn generated_by_routine(item: &TodoItem) -> bool {
    item.metadata
        .get("generated_by")
        .and_then(|value| value.as_str())
        == Some("routine")
}

pub(super) fn parse_day(value: &str) -> TodoResult<Date> {
    let format = parse_format_description("[year]-[month]-[day]")
        .map_err(|error| TodoError::Internal(format!("failed to prepare date parser: {error}")))?;
    Date::parse(value, &format)
        .map_err(|error| TodoError::Validation(format!("Invalid date {value}: {error}")))
}

pub(super) fn format_time(value: OffsetDateTime) -> TodoResult<String> {
    value
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| TodoError::Storage(error.to_string()))
}
