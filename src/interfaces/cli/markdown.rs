use time::Date;
use time::format_description::parse as parse_format_description;

use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::ListFilter;
use crate::application::service::TodoService;
use crate::domain::{ItemStatus, ItemType, TodoItem};

const ROUTINE_LOOKAHEAD_DAYS: i64 = 7;
const ROUTINE_CATCHUP_DAYS: i64 = 1;

pub(super) fn render_items(title: &str, items: &[TodoItem]) -> String {
    let mut lines = vec![format!("# {title}"), String::new()];
    if items.is_empty() {
        lines.push("_없음_".to_string());
        return finish_markdown(lines);
    }

    for item in items {
        let mut meta = vec![
            item.item_type.as_str().to_string(),
            item.status.as_str().to_string(),
        ];
        if let Some(due) = &item.due {
            meta.push(format!("due:{due}"));
        }
        if let Some(scheduled) = &item.scheduled {
            meta.push(format!("scheduled:{scheduled}"));
        }
        if let Some(area_id) = &item.area_id {
            meta.push(format!("area:{area_id}"));
        }
        if let Some(location) = item
            .metadata
            .get("location")
            .and_then(|value| value.as_str())
        {
            meta.push(format!("location:{location}"));
        }
        if let Some(participants) = participants_label(item) {
            meta.push(format!("with:{participants}"));
        }

        lines.push(format!(
            "- [{}] **{}** `{}`",
            checkbox(item),
            item.title,
            meta.join(" ")
        ));
        if let Some(description) = &item.description {
            lines.push(format!("  - {description}"));
        }
    }

    finish_markdown(lines)
}

pub(super) fn pending_items(service: &mut TodoService) -> TodoResult<Vec<TodoItem>> {
    service.list_items(ListFilter {
        status: Some(ItemStatus::Proposed),
        ..Default::default()
    })
}

pub(super) fn current_today_items(
    service: &mut TodoService,
    today: &str,
) -> TodoResult<Vec<TodoItem>> {
    service.materialize_routines(today, ROUTINE_LOOKAHEAD_DAYS, ROUTINE_CATCHUP_DAYS)?;
    let items = service.list_items(ListFilter {
        item_type: Some(ItemType::Task),
        ..Default::default()
    })?;
    today_tasks(&items, today)
}

fn today_tasks(items: &[TodoItem], today: &str) -> TodoResult<Vec<TodoItem>> {
    let today = parse_day(today)
        .ok_or_else(|| TodoError::Validation(format!("Invalid today date: {today}")))?;
    let visible_statuses = [
        ItemStatus::Proposed,
        ItemStatus::Approved,
        ItemStatus::Active,
    ];

    Ok(items
        .iter()
        .filter(|item| item.item_type == ItemType::Task)
        .filter(|item| visible_statuses.contains(&item.status))
        .filter(|item| match item.scheduled.as_deref() {
            None | Some("today") => true,
            Some(value) => parse_scheduled_day(value).is_some_and(|scheduled| scheduled <= today),
        })
        .cloned()
        .collect())
}

fn checkbox(item: &TodoItem) -> &'static str {
    if item.status == ItemStatus::Completed {
        "x"
    } else {
        " "
    }
}

fn participants_label(item: &TodoItem) -> Option<String> {
    let participants = item.metadata.get("participants")?.as_array()?;
    if participants.is_empty() {
        return None;
    }
    Some(
        participants
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| value.to_string())
            })
            .collect::<Vec<_>>()
            .join(","),
    )
}

fn parse_scheduled_day(value: &str) -> Option<Date> {
    parse_day(value.get(..10)?)
}

fn parse_day(value: &str) -> Option<Date> {
    let format = parse_format_description("[year]-[month]-[day]").ok()?;
    Date::parse(value, &format).ok()
}

fn finish_markdown(lines: Vec<String>) -> String {
    lines.join("\n") + "\n"
}
