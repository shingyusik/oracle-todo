use crate::application::error::TodoResult;
use crate::domain::{ItemStatus, ItemType, TodoEvent, TodoItem};
use time::OffsetDateTime;

pub trait Clock: Send + Sync {
    fn now(&self) -> OffsetDateTime;
}

pub trait IdGenerator: Send + Sync {
    fn new_id(&self, prefix: &str) -> String;
}

pub trait TodoRepository: Send {
    fn save_item(&mut self, item: &TodoItem) -> TodoResult<()>;
    fn get_item(&mut self, id: &str) -> TodoResult<Option<TodoItem>>;
    fn list_items(&mut self, filter: ListFilter) -> TodoResult<Vec<TodoItem>>;
}

pub trait EventRepository: Send {
    fn save_event(&mut self, event: &TodoEvent) -> TodoResult<()>;
}

pub trait TodoStore: TodoRepository + EventRepository {
    fn save_item_and_event(&mut self, item: &TodoItem, event: &TodoEvent) -> TodoResult<()>;
}

#[derive(Clone, Debug, Default)]
pub struct ListFilter {
    pub status: Option<ItemStatus>,
    pub item_type: Option<ItemType>,
    pub area_id: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub query: Option<String>,
    pub include_archived: bool,
}
