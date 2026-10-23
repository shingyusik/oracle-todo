//! OAuth scope required per MCP tool. Mirrors `src/policy.js` of `raven-mcp-gateway`
//! (`TOOL_SCOPES`, `allowedTool`); unmapped tools are denied.
use serde_json::Value;

const TODO_READ: &str = "raven.todo.read";
const LEDGER_READ: &str = "raven.ledger.read";
const HEALTH_READ: &str = "raven.health.read";
const TODO_WRITE: &str = "raven.todo.write";
const LEDGER_WRITE: &str = "raven.ledger.write";
const HEALTH_WRITE: &str = "raven.health.write";
const LEDGER_EXPORT: &str = "raven.ledger.export";
const LEDGER_PURGE: &str = "raven.ledger.purge";
const HEALTH_MEDIA: &str = "raven.health.media";

pub(super) const SCOPES: &[&str] = &[
    TODO_READ,
    LEDGER_READ,
    HEALTH_READ,
    TODO_WRITE,
    LEDGER_WRITE,
    HEALTH_WRITE,
    LEDGER_EXPORT,
    LEDGER_PURGE,
    HEALTH_MEDIA,
];

pub(super) fn required(name: &str) -> Option<&'static [&'static str]> {
    Some(match name {
        "raven_dashboard" => &[TODO_READ, LEDGER_READ, HEALTH_READ],
        "todo_search"
        | "todo_choices"
        | "todo_options"
        | "todo_get"
        | "todo_history"
        | "todo_archive_search"
        | "todo_list" => &[TODO_READ],
        "todo_area_create"
        | "todo_area_update"
        | "todo_project_create"
        | "todo_project_update"
        | "todo_goal_create"
        | "todo_goal_update"
        | "todo_routine_create"
        | "todo_routine_update"
        | "todo_task_create"
        | "todo_task_update"
        | "todo_event_create"
        | "todo_event_update"
        | "todo_transition"
        | "todo_routine_materialize"
        | "todo_routines_materialize" => &[TODO_WRITE],
        "ledger_search"
        | "ledger_choices"
        | "ledger_entry_get"
        | "ledger_transfer_get"
        | "ledger_entry_list"
        | "ledger_currency_list"
        | "ledger_account_category_list"
        | "ledger_account_list"
        | "ledger_category_list"
        | "ledger_balances"
        | "ledger_report_summary"
        | "ledger_report_categories"
        | "ledger_report_trend"
        | "ledger_report_compare"
        | "ledger_analysis"
        | "ledger_audit"
        | "ledger_doctor" => &[LEDGER_READ],
        "ledger_currency_create"
        | "ledger_currency_update"
        | "ledger_account_category_create"
        | "ledger_account_category_update"
        | "ledger_account_create"
        | "ledger_account_update"
        | "ledger_category_create"
        | "ledger_category_update"
        | "ledger_entry_create"
        | "ledger_entry_update"
        | "ledger_transfer_create"
        | "ledger_transfer_update"
        | "ledger_entry_archive"
        | "ledger_entry_restore" => &[LEDGER_WRITE],
        "ledger_export" => &[LEDGER_READ, LEDGER_EXPORT],
        "ledger_account_category_purge_preview" => &[LEDGER_READ, LEDGER_PURGE],
        "ledger_account_category_purge" => &[LEDGER_WRITE, LEDGER_PURGE],
        "health_search" | "health_choices" | "health_diet_get" | "health_event_get"
        | "health_event_list" | "health_records" | "health_reports" | "health_audit" => {
            &[HEALTH_READ]
        }
        "health_diet_create"
        | "health_diet_update"
        | "health_bowel_create"
        | "health_bowel_update"
        | "health_medication_create"
        | "health_medication_update"
        | "health_diet_archive"
        | "health_diet_restore"
        | "health_event_archive"
        | "health_event_restore"
        | "health_daily_upsert" => &[HEALTH_WRITE],
        "health_diet_image_get" => &[HEALTH_READ, HEALTH_MEDIA],
        "health_diet_image_create" | "health_diet_image_update" => &[HEALTH_WRITE, HEALTH_MEDIA],
        _ => return None,
    })
}

pub(super) fn visible(name: &str, scopes: &[String]) -> bool {
    required(name).is_some_and(|required| {
        required
            .iter()
            .all(|scope| scopes.iter().any(|held| held == scope))
    })
}

pub(super) fn allowed(name: &str, args: &Value, scopes: &[String]) -> bool {
    if !visible(name, scopes) {
        return false;
    }
    let media = scopes.iter().any(|scope| scope == HEALTH_MEDIA);
    match name {
        "health_audit" => match args["record_type"].as_str() {
            Some("diet_entry" | "health_event") => true,
            Some("media_file") => media,
            _ => false,
        },
        "health_search" | "health_choices" => matches!(
            args["scope"].as_str(),
            Some("health.diet" | "health.bowel" | "health.medication" | "health.metrics")
        ),
        "health_diet_update" => args["remove_image"] != Value::Bool(true) || media,
        _ => true,
    }
}
