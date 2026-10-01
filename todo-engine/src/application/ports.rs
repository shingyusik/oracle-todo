use crate::application::error::TodoResult;
use crate::application::table::{
    TablePage, TodoTableLookup, TodoTableQuery, TodoTableRow, TodoTableScope,
};
use crate::domain::{ItemStatus, ItemType, TodoEvent, TodoItem, hidden_by_default_status};

pub trait TodoRepository: Send {
    fn save_item(&mut self, item: &TodoItem) -> TodoResult<()>;
    fn get_item(&mut self, id: &str) -> TodoResult<Option<TodoItem>>;
    fn list_items(&mut self, filter: ListFilter) -> TodoResult<Vec<TodoItem>>;
    fn list_items_page(&mut self, query: &ItemPageQuery) -> TodoResult<Vec<TodoItem>>;
}

pub trait EventRepository: Send {
    fn save_event(&mut self, event: &TodoEvent) -> TodoResult<()>;
}

pub trait TodoStore: TodoRepository + EventRepository {
    fn item_history(
        &mut self,
        _item_id: &str,
        _offset: u32,
        _limit: u32,
    ) -> TodoResult<Vec<TodoEvent>> {
        Err(crate::application::error::TodoError::Policy(
            "Store does not support history reads".into(),
        ))
    }
    fn save_item_and_event(&mut self, item: &TodoItem, event: &TodoEvent) -> TodoResult<()>;
    /// Atomically compare the persisted version and save the item plus audit event.
    fn save_item_and_event_if_current(
        &mut self,
        _item: &TodoItem,
        _event: &TodoEvent,
        _expected_updated_at: time::OffsetDateTime,
    ) -> TodoResult<()> {
        Err(crate::application::error::TodoError::Policy(
            "Store does not support conditional updates".to_string(),
        ))
    }
    /// Persist every item/event pair as one atomic unit. On error, none of the
    /// supplied items or events may remain visible.
    fn save_items_and_events(&mut self, writes: &[(TodoItem, TodoEvent)]) -> TodoResult<()>;

    fn query_table(&mut self, query: &TodoTableQuery) -> TodoResult<TablePage<TodoTableRow>>;

    fn table_lookups(&mut self, scope: TodoTableScope) -> TodoResult<Vec<TodoTableLookup>>;
}

#[derive(Clone, Debug, Default)]
pub struct ListFilter {
    pub status: Option<ItemStatus>,
    pub item_type: Option<ItemType>,
    pub area_id: Option<String>,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    pub routine_id: Option<String>,
    pub horizon: Option<String>,
    pub scheduled: Option<String>,
    pub query: Option<String>,
    pub include_archived: bool,
}

#[derive(Clone, Copy, Debug)]
pub enum ItemPageScope {
    List,
    Archive,
    Today(time::Date),
}

#[derive(Clone, Debug)]
pub struct ItemPageQuery {
    pub filter: ListFilter,
    pub scope: ItemPageScope,
    pub offset: u32,
    pub limit: u32,
}

pub fn apply_list_filter(
    items: impl IntoIterator<Item = TodoItem>,
    filter: ListFilter,
) -> Vec<TodoItem> {
    let search = filter
        .query
        .as_deref()
        .map(crate::application::table::unicode_fold);
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
                .parent_id
                .as_ref()
                .is_none_or(|parent_id| item.parent_id.as_ref() == Some(parent_id))
        })
        .filter(|item| {
            filter
                .routine_id
                .as_ref()
                .is_none_or(|routine_id| item.routine_id.as_ref() == Some(routine_id))
        })
        .filter(|item| {
            filter
                .horizon
                .as_ref()
                .is_none_or(|horizon| item.horizon.as_ref() == Some(horizon))
        })
        .filter(|item| {
            filter
                .scheduled
                .as_ref()
                .is_none_or(|scheduled| item.scheduled.as_ref() == Some(scheduled))
        })
        .filter(|item| {
            search.as_ref().is_none_or(|query| {
                [
                    Some(item.title.as_str()),
                    item.note.as_deref(),
                    item.description.as_deref(),
                    item.outcome.as_deref(),
                ]
                .into_iter()
                .flatten()
                .any(|value| crate::application::table::unicode_fold(value).contains(query))
            })
        })
        .collect()
}
