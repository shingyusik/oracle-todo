use std::path::Path;

use anyhow::Result;
use serde_json::{Value, json};

use super::{OptionsArgs, output::print_json, read_service};
use crate::domain::{ItemStatus, ItemType, TodoItem};

const TYPES: [ItemType; 8] = [
    ItemType::Area,
    ItemType::Project,
    ItemType::Goal,
    ItemType::Routine,
    ItemType::Task,
    ItemType::Event,
    ItemType::Review,
    ItemType::ArchiveItem,
];
const STATUSES: [ItemStatus; 9] = [
    ItemStatus::Active,
    ItemStatus::Waiting,
    ItemStatus::Paused,
    ItemStatus::Completed,
    ItemStatus::Cancelled,
    ItemStatus::Dropped,
    ItemStatus::Archived,
    ItemStatus::Missed,
    ItemStatus::Rejected,
];

pub(super) fn run(home: &Path, args: OptionsArgs) -> Result<()> {
    let item = args
        .id
        .as_deref()
        .map(|id| -> Result<TodoItem> { Ok(read_service(home)?.get(id)?) })
        .transpose()?;
    print_json(&value(args.item_type, item.as_ref()))
}

pub(super) fn value(item_type: Option<ItemType>, item: Option<&TodoItem>) -> Value {
    let selected_type = item.map(|item| item.item_type).or(item_type);
    let types = TYPES.into_iter()
        .filter(|kind| selected_type.is_none_or(|selected| selected == *kind))
        .map(|kind| {
            let transitions = transitions(kind, item);
            let choices = status_choices(kind, item, &transitions);
            let update_fields = if item.is_some_and(|item| crate::domain::terminal_status(item.status)) { Vec::new() } else { fields(kind) };
            json!({"type": kind, "update_fields": update_fields, "status_choices": choices, "actions": transitions})
        }).collect::<Vec<_>>();
    json!({
        "item": item.map(|item| json!({"id": item.id, "type": item.item_type, "status": item.status})),
        "enums": {
            "read_types": TYPES, "create_types": &TYPES[..6], "read_statuses": STATUSES,
            "horizon": ["week", "month", "year"],
            "review_cycle": ["daily", "weekly", "monthly", "quarterly"],
            "materialization_policy": ["single_open", "per_occurrence"],
            "priority": (1..=10).collect::<Vec<_>>(), "actor": ["agent", "user", "system"]
        },
        "types": types,
        "status_policy": "read_statuses include historical records; status_choices match the UI dropdown, while actions list permitted lifecycle commands",
        "postpone_policy": "target must be later than today, or today when the source is overdue; creates an active follow-up",
        "lookup_command": "raven todo table lookups --scope <scope> [--id <item-id>] [--horizon <week|month|year>]"
    })
}

fn status_choices(kind: ItemType, item: Option<&TodoItem>, actions: &[Value]) -> Vec<&'static str> {
    if let Some(item) = item.filter(|item| crate::domain::terminal_status(item.status)) {
        return if item.status == ItemStatus::Completed
            && matches!(kind, ItemType::Task | ItemType::Event)
        {
            vec!["completed", "active"]
        } else {
            vec![item.status.as_str()]
        };
    }
    let mut choices = match kind {
        ItemType::Area => vec!["active", "archived"],
        ItemType::Task => vec!["active", "completed"],
        _ => vec!["active", "paused", "completed"],
    };
    if let Some(item) = item.filter(|item| !choices.contains(&item.status.as_str())) {
        choices.insert(0, item.status.as_str());
    }
    if let Some(item) = item {
        choices.retain(|choice| {
            *choice == item.status.as_str()
                || actions
                    .iter()
                    .any(|action| action["to"].as_str() == Some(choice))
        });
    }
    choices
}

fn fields(kind: ItemType) -> Vec<&'static str> {
    let mut fields = vec!["title", "note", "tags"];
    fields.extend(match kind {
        ItemType::Area => &["standard", "review_cycle"][..],
        ItemType::Project => &["area", "definition_of_done", "outcome", "due"],
        ItemType::Goal => &["horizon", "scheduled", "parent_id"],
        ItemType::Routine => &[
            "area",
            "project_id",
            "recurrence_rule",
            "materialization_policy",
            "priority",
        ],
        ItemType::Task => &[
            "area",
            "project_id",
            "parent_id",
            "due",
            "scheduled",
            "priority",
        ],
        ItemType::Event => &[
            "area",
            "project_id",
            "due",
            "scheduled",
            "priority",
            "location",
            "participants",
            "commitment_type",
        ],
        ItemType::Review | ItemType::ArchiveItem => &[],
    });
    fields
}

fn transitions(kind: ItemType, item: Option<&TodoItem>) -> Vec<Value> {
    use ItemStatus as S;
    let open = &[S::Active, S::Waiting, S::Paused][..];
    let mut actions = Vec::new();
    let mut add = |action: &str, from: &[S], to: S| {
        if item.is_none_or(|item| from.contains(&item.status)) {
            actions.push(json!({"action": action, "from": from, "to": to}));
        }
    };
    if !matches!(kind, ItemType::Area | ItemType::Task) {
        add("pause", open, S::Paused);
    }
    if kind != ItemType::Area {
        if kind != ItemType::Routine || item.is_none_or(|item| item.recurrence_rule.is_some()) {
            add("resume", &[S::Paused], S::Active);
        }
        add("complete", open, S::Completed);
    }
    if matches!(kind, ItemType::Task | ItemType::Event) {
        add("miss", &[S::Active], S::Missed);
        add("postpone", &[S::Active], S::Missed);
        add("reopen", &[S::Completed], S::Active);
    }
    add("archive", &STATUSES, S::Archived);
    actions
}
