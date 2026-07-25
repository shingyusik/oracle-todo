use anyhow::Result;
use serde_json::json;
use std::path::Path;
use time::{Date, format_description::parse};

use super::output::print_json;
use super::{ItemTransitionArgs, PostponeArgs, UpdateArgs, service, today_string};
use crate::application::service::UpdateItem;

pub(super) fn pause(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.pause(&args.item_id, args.reason.as_deref())?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn miss(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let today = today_string();
    let mut service = service(home)?;
    let item = service.miss(&args.item_id, &today, args.reason.as_deref())?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn postpone(home: &Path, args: PostponeArgs) -> Result<()> {
    let today = today_string();
    let scheduled = match args.scheduled {
        Some(scheduled) => scheduled,
        None => next_day(&today)?,
    };
    let mut service = service(home)?;
    let (source, follow_up) =
        service.postpone(&args.item_id, &scheduled, &today, args.reason.as_deref())?;
    print_json(&json!({"source": source, "follow_up": follow_up}))?;
    Ok(())
}

pub(super) fn resume(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.resume(&args.item_id, args.reason.as_deref())?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn complete(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.complete(&args.item_id, args.reason.as_deref())?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn archive(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.archive(&args.item_id, args.reason.as_deref())?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn drop_item(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.drop(&args.item_id, args.reason.as_deref())?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn cancel(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.cancel(&args.item_id, args.reason.as_deref())?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn update(home: &Path, args: UpdateArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.update_item(
        &args.item_id,
        UpdateItem {
            title: args.title,
            description: args.description,
            note: args.note,
            outcome: args.outcome,
            definition_of_done: args.definition_of_done,
            standard: args.standard,
            review_cycle: args.review_cycle,
            recurrence_rule: args.recurrence_rule,
            materialization_policy: args.materialization_policy,
            future_occurrences: args.future_occurrences,
            area: args.area,
            project_id: args.project_id,
            parent_id: args.parent_id,
            routine_id: args.routine_id,
            due: args.due,
            scheduled: args.scheduled,
            horizon: None,
            priority: args.priority,
            tags: if args.tags.is_empty() {
                None
            } else {
                Some(args.tags)
            },
            location: None,
            participants: None,
            commitment_type: None,
            reason: args.reason,
        },
    )?;
    print_json(&item)?;
    Ok(())
}

fn next_day(today: &str) -> Result<String> {
    let format = parse("[year]-[month]-[day]")?;
    let today = Date::parse(today, &format)?;
    let tomorrow = today
        .next_day()
        .ok_or_else(|| anyhow::anyhow!("local date has no following day"))?;
    tomorrow.format(&format).map_err(Into::into)
}
