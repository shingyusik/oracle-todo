use anyhow::Result;
use std::path::Path;

use super::markdown::{current_today_items, pending_items, render_items};
use super::output::print_json;
use super::{
    AgendaArgs, DateRangeArgs, ListArgs, PeriodArgs, RoutineMaterializeArgs, service, today_string,
};
use crate::application::error::TodoError;
use crate::application::ports::ListFilter;
use crate::domain::Horizon;

pub(super) fn list(home: &Path, args: ListArgs) -> Result<()> {
    let mut service = service(home)?;
    let items = service.list_items(ListFilter {
        status: args.status,
        item_type: args.item_type,
        area_id: args.area_id,
        project_id: args.project_id,
        parent_id: None,
        routine_id: args.routine_id,
        horizon: None,
        scheduled: None,
        query: args.query,
        include_archived: args.include_archived,
    })?;
    println!("{}", render_items("Items", &items));
    Ok(())
}

pub(super) fn routine_materialize(home: &Path, args: RoutineMaterializeArgs) -> Result<()> {
    let mut service = service(home)?;
    let _ = args;
    let created = service.materialize_routines(&today_string())?;
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

pub(super) fn agenda(home: &Path, args: AgendaArgs) -> Result<()> {
    let mut service = service(home)?;
    print_json(&service.agenda(&args.date)?)?;
    Ok(())
}

pub(super) fn date_range(home: &Path, args: DateRangeArgs) -> Result<()> {
    let mut service = service(home)?;
    print_json(&service.date_range(&args.from, &args.to)?)?;
    Ok(())
}

pub(super) fn period(home: &Path, args: PeriodArgs) -> Result<()> {
    let mut service = service(home)?;
    let horizon = args
        .horizon
        .parse::<Horizon>()
        .map_err(TodoError::Validation)?;
    print_json(&service.period_view(horizon, &args.period)?)?;
    Ok(())
}
