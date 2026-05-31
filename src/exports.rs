use std::fs;
use std::path::{Path, PathBuf};

use time::Date;
use time::format_description::parse as parse_format_description;

use crate::application::error::{TodoError, TodoResult};
use crate::domain::{ItemStatus, ItemType, TodoItem};

pub fn render_items(title: &str, items: &[TodoItem]) -> String {
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

pub fn today_tasks(items: &[TodoItem], today: &str) -> TodoResult<Vec<TodoItem>> {
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

pub fn write_exports(items: &[TodoItem], out_dir: &Path, today: &str) -> TodoResult<Vec<PathBuf>> {
    fs::create_dir_all(out_dir).map_err(|error| TodoError::Storage(error.to_string()))?;

    let activeish = items
        .iter()
        .filter(|item| {
            !matches!(
                item.status,
                ItemStatus::Archived | ItemStatus::Cancelled | ItemStatus::Dropped
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    let views = vec![
        ("today.md", today_tasks(&activeish, today)?),
        (
            "events.md",
            activeish
                .iter()
                .filter(|item| item.item_type == ItemType::Event)
                .cloned()
                .collect(),
        ),
        (
            "projects.md",
            activeish
                .iter()
                .filter(|item| item.item_type == ItemType::Project)
                .cloned()
                .collect(),
        ),
        (
            "areas.md",
            activeish
                .iter()
                .filter(|item| item.item_type == ItemType::Area)
                .cloned()
                .collect(),
        ),
        (
            "routines.md",
            activeish
                .iter()
                .filter(|item| item.item_type == ItemType::Routine)
                .cloned()
                .collect(),
        ),
        (
            "proposed.md",
            items
                .iter()
                .filter(|item| item.status == ItemStatus::Proposed)
                .cloned()
                .collect(),
        ),
        (
            "archive.md",
            items
                .iter()
                .filter(|item| {
                    matches!(
                        item.status,
                        ItemStatus::Archived
                            | ItemStatus::Completed
                            | ItemStatus::Dropped
                            | ItemStatus::Cancelled
                            | ItemStatus::Someday
                    )
                })
                .cloned()
                .collect(),
        ),
    ];

    let mut written = Vec::new();
    for (name, view_items) in views {
        let path = out_dir.join(name);
        let title = view_title(name);
        fs::write(&path, render_items(&title, &view_items))
            .map_err(|error| TodoError::Storage(error.to_string()))?;
        written.push(path);
    }
    Ok(written)
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

fn view_title(name: &str) -> String {
    let stem = name.strip_suffix(".md").unwrap_or(name);
    let mut chars = stem.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn finish_markdown(lines: Vec<String>) -> String {
    lines.join("\n") + "\n"
}
