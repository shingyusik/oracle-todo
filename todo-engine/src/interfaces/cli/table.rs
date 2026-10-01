use std::path::Path;

use anyhow::Result;
use serde_json::{Value, json};

use super::{TableCommand, output::print_json, read_service};

pub(super) fn run(home: &Path, command: TableCommand) -> Result<()> {
    print_json(&response(home, command)?)
}

pub(super) fn response(home: &Path, command: TableCommand) -> Result<Value> {
    match command {
        TableCommand::Query { json } => {
            let query = crate::interfaces::api::decode_table_query_json(&json)?;
            Ok(serde_json::to_value(
                read_service(home)?.query_table(&query)?,
            )?)
        }
        TableCommand::Lookups { scope, id, horizon } => {
            let items = read_service(home)?.table_lookups_for_item(
                scope,
                id.as_deref(),
                horizon.as_deref(),
            )?;
            Ok(json!({"items": items}))
        }
    }
}
