use anyhow::Result;
use std::path::Path;

use super::output::print_json;
use super::{ItemTransitionArgs, UpdateArgs, service};
use crate::application::service::UpdateItem;

pub(super) fn approve(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.approve(&args.item_id, args.reason.as_deref())?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn activate(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.activate(&args.item_id, args.reason.as_deref())?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn pause(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.pause(&args.item_id, args.reason.as_deref())?;
    print_json(&item)?;
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
            area: args.area,
            project_id: args.project_id,
            parent_id: args.parent_id,
            routine_id: args.routine_id,
            due: args.due,
            scheduled: args.scheduled,
            horizon: None,
            priority: args.priority,
            location: None,
            participants: None,
            commitment_type: None,
            reason: args.reason,
        },
    )?;
    print_json(&item)?;
    Ok(())
}
