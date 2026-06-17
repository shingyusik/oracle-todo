use anyhow::Result;
use std::path::Path;

use super::markdown::{current_today_items, pending_items, render_items};
use super::output::print_json;
use super::{ListArgs, RoutineMaterializeArgs, service, today_string};
use crate::application::ports::ListFilter;

pub(super) fn list(home: &Path, args: ListArgs) -> Result<()> {
    let mut service = service(home)?;
    let items = service.list_items(ListFilter {
        status: args.status,
        item_type: args.item_type,
        area_id: args.area_id,
        project_id: args.project_id,
        routine_id: args.routine_id,
        query: args.query,
        include_archived: args.include_archived,
    })?;
    println!("{}", render_items("Items", &items));
    Ok(())
}

pub(super) fn routine_materialize(home: &Path, args: RoutineMaterializeArgs) -> Result<()> {
    let mut service = service(home)?;
    let now = args.now.unwrap_or_else(today_string);
    let created = service.materialize_routines(&now, args.lookahead_days, args.catchup_days)?;
    if created.is_empty() {
        println!("No routine tasks materialized");
        return Ok(());
    }
    for item in created {
        print_json(&item)?;
    }
    Ok(())
}

pub(super) fn archive_list(home: &Path) -> Result<()> {
    let mut service = service(home)?;
    let items = service.archive_items()?;
    println!("{}", render_items("Archive", &items));
    Ok(())
}

pub(super) fn pending(home: &Path) -> Result<()> {
    let mut service = service(home)?;
    let items = pending_items(&mut service)?;
    println!("{}", render_items("Pending", &items));
    Ok(())
}

pub(super) fn today(home: &Path) -> Result<()> {
    let today = today_string();
    let mut service = service(home)?;
    let items = current_today_items(&mut service, &today)?;
    println!("{}", render_items("Today", &items));
    Ok(())
}
