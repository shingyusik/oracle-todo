use crate::application::error::TodoResult;
use crate::domain::{ItemStatus, ItemType, TodoEvent, TodoItem, hidden_by_default_status};
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

pub fn apply_list_filter(
    items: impl IntoIterator<Item = TodoItem>,
    filter: ListFilter,
) -> Vec<TodoItem> {
    items
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
        .collect()
}
