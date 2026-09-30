use crate::domain::{ItemStatus, TodoItem};

pub(super) fn render_items(title: &str, items: &[TodoItem]) -> String {
    let mut lines = vec![format!("# {title}"), String::new()];
    if items.is_empty() {
        lines.push("_없음_".to_string());
        return finish_markdown(lines);
    }

    for item in items {
        let mut meta = vec![
            format!("id:{}", item.id),
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

fn finish_markdown(lines: Vec<String>) -> String {
    lines.join("\n") + "\n"
}
