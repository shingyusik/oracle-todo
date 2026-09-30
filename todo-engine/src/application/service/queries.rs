use serde::Serialize;
use time::Date;

use super::{ServiceStore, TodoService, parse_day};
use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::{ItemPageQuery, ItemPageScope, ListFilter, apply_list_filter};
use crate::domain::{ItemStatus, ItemType, TodoItem, terminal_status};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TodoDashboardSummary {
    pub active: u64,
    pub today_completed: u64,
    pub today_incomplete: u64,
    pub today_missed: u64,
    pub today_total: u64,
    pub overdue: u64,
}

impl TodoService {
    pub fn item_history(
        &mut self,
        item_id: &str,
        offset: u32,
        limit: u32,
    ) -> TodoResult<(Vec<crate::domain::TodoEvent>, Option<u64>)> {
        self.get(item_id)?;
        if !(1..=100).contains(&limit) {
            return Err(TodoError::Validation(
                "history limit must be between 1 and 100".into(),
            ));
        }
        let mut events = match &mut self.store {
            ServiceStore::Persistent(store) => store.item_history(item_id, offset, limit + 1)?,
            ServiceStore::InMemory(_) => {
                let mut events = self
                    .events
                    .iter()
                    .filter(|event| event.object_id == item_id)
                    .cloned()
                    .collect::<Vec<_>>();
                events.sort_by(|left, right| {
                    right.at.cmp(&left.at).then_with(|| right.id.cmp(&left.id))
                });
                events
                    .into_iter()
                    .skip(offset as usize)
                    .take(limit as usize + 1)
                    .collect()
            }
        };
        let next = (events.len() > limit as usize).then_some(u64::from(offset) + u64::from(limit));
        events.truncate(limit as usize);
        Ok((events, next))
    }
    pub fn list_items_page(
        &mut self,
        query: ItemPageQuery,
    ) -> TodoResult<(Vec<TodoItem>, Option<u64>)> {
        if !(1..=1000).contains(&query.limit) {
            return Err(TodoError::Validation(
                "limit must be between 1 and 1000".into(),
            ));
        }
        let mut items = match &mut self.store {
            ServiceStore::Persistent(store) => store.list_items_page(&query)?,
            ServiceStore::InMemory(_) => self
                .list_items(query.filter)?
                .into_iter()
                .filter(|item| match query.scope {
                    ItemPageScope::List => true,
                    ItemPageScope::Archive => terminal_status(item.status),
                    ItemPageScope::Today(today) => {
                        item.item_type == ItemType::Task
                            && item.status == ItemStatus::Active
                            && match item.scheduled.as_deref() {
                                None | Some("today") => true,
                                Some(value) => value
                                    .get(..10)
                                    .and_then(|value| parse_day(value).ok())
                                    .is_some_and(|date| date <= today),
                            }
                    }
                })
                .skip(query.offset as usize)
                .take(query.limit as usize + 1)
                .collect(),
        };
        let next = (items.len() > query.limit as usize)
            .then_some(u64::from(query.offset) + u64::from(query.limit));
        items.truncate(query.limit as usize);
        Ok((items, next))
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
                Ok(apply_list_filter(items, filter))
            }
            ServiceStore::Persistent(store) => store.list_items(filter),
        }
    }

    pub fn dashboard_summary(&mut self, today: Date) -> TodoResult<TodoDashboardSummary> {
        let work = self
            .list_items(ListFilter::default())?
            .into_iter()
            .filter(|item| matches!(item.item_type, ItemType::Task | ItemType::Event))
            .filter(|item| {
                matches!(
                    item.status,
                    ItemStatus::Active
                        | ItemStatus::Waiting
                        | ItemStatus::Paused
                        | ItemStatus::Completed
                        | ItemStatus::Missed
                )
            })
            .collect::<Vec<_>>();
        let today_work = work.iter().filter(|item| {
            iso_day(item.scheduled.as_deref()) == Some(today)
                || iso_day(item.due.as_deref()) == Some(today)
        });
        let mut summary = TodoDashboardSummary {
            active: work
                .iter()
                .filter(|item| item.status == ItemStatus::Active)
                .count() as u64,
            today_completed: 0,
            today_incomplete: 0,
            today_missed: 0,
            today_total: 0,
            overdue: work
                .iter()
                .filter(|item| iso_day(item.scheduled.as_deref()).is_some_and(|date| date < today))
                .count() as u64,
        };
        for item in today_work {
            match item.status {
                ItemStatus::Completed => summary.today_completed += 1,
                ItemStatus::Active | ItemStatus::Waiting | ItemStatus::Paused => {
                    summary.today_incomplete += 1;
                }
                ItemStatus::Missed => summary.today_missed += 1,
                _ => {}
            }
        }
        summary.today_total =
            summary.today_completed + summary.today_incomplete + summary.today_missed;
        Ok(summary)
    }
}

fn iso_day(value: Option<&str>) -> Option<Date> {
    parse_day(value?.get(..10)?).ok()
}
