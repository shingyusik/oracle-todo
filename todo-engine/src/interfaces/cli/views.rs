use anyhow::Result;
use std::path::Path;

use super::markdown::render_items;
use super::output::print_json;
use super::{
    ListArgs, ReadArgs, ReadFormat, RoutineMaterializeArgs, read_service, service, today_string,
};
use crate::application::error::TodoError;
use crate::application::ports::{ItemPageQuery, ItemPageScope, ListFilter};

pub(super) fn list(home: &Path, args: ListArgs) -> Result<()> {
    let mut service = read_service(home)?;
    let items = service.list_items_page(ItemPageQuery {
        filter: ListFilter {
            status: args.status,
            item_type: args.item_type,
            area_id: args.area_id,
            project_id: args.project_id,
            parent_id: args.parent_id,
            routine_id: args.routine_id,
            horizon: args.horizon,
            scheduled: args.scheduled,
            query: args.query,
            include_archived: args.include_archived,
        },
        scope: ItemPageScope::List,
        offset: args.read.offset,
        limit: args.read.limit,
    })?;
    print_items("Items", items, args.read)?;
    Ok(())
}

pub(super) fn routine_materialize(home: &Path, args: RoutineMaterializeArgs) -> Result<()> {
    let mut service = service(home)?;
    let created = if let Some(id) = args.item_id {
        service.materialize_routine(&id, &today_string(), args.future_occurrences)?
    } else {
        service.materialize_routines(&today_string())?
    };
    print_json(&created)?;
    Ok(())
}

pub(super) fn archive_list(home: &Path, args: ReadArgs) -> Result<()> {
    let mut service = read_service(home)?;
    let items = service.list_items_page(ItemPageQuery {
        filter: ListFilter {
            include_archived: true,
            ..Default::default()
        },
        scope: ItemPageScope::Archive,
        offset: args.offset,
        limit: args.limit,
    })?;
    print_items("Archive", items, args)?;
    Ok(())
}

pub(super) fn pending(home: &Path, args: ReadArgs) -> Result<()> {
    let mut service = read_service(home)?;
    let items = service.list_items_page(ItemPageQuery {
        filter: ListFilter {
            status: Some(crate::domain::ItemStatus::Active),
            ..Default::default()
        },
        scope: ItemPageScope::List,
        offset: args.offset,
        limit: args.limit,
    })?;
    print_items("Pending", items, args)?;
    Ok(())
}

pub(super) fn today(home: &Path, args: ReadArgs) -> Result<()> {
    let today = today_string();
    let mut service = read_service(home)?;
    let today = time::Date::parse(
        &today,
        time::macros::format_description!("[year]-[month]-[day]"),
    )
    .map_err(|_| TodoError::Validation("Invalid today date".into()))?;
    let items = service.list_items_page(ItemPageQuery {
        filter: ListFilter::default(),
        scope: ItemPageScope::Today(today),
        offset: args.offset,
        limit: args.limit,
    })?;
    print_items("Today", items, args)?;
    Ok(())
}

fn print_items(
    title: &str,
    (items, next): (Vec<crate::domain::TodoItem>, Option<u64>),
    args: ReadArgs,
) -> Result<()> {
    match args.format {
        ReadFormat::Json => print_json(&serde_json::json!({"items": items, "next": next}))?,
        ReadFormat::Markdown => println!("{}", render_items(title, &items)),
    }
    Ok(())
}
pub(super) fn show(home: &Path, id: &str) -> Result<()> {
    print_json(&read_service(home)?.get(id)?)
}
