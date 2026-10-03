use rmcp::model::{Tool, ToolAnnotations};
use serde_json::Value;

use super::schema::*;

pub(super) struct Spec {
    pub tool: Tool,
    pub method: &'static str,
    pub path: String,
    pub validator: jsonschema::Validator,
}

impl Spec {
    fn new(
        name: &str,
        description: &str,
        method: &'static str,
        path: &str,
        mut schema: Value,
    ) -> Self {
        if name.ends_with("_create") && name != "ledger_transfer_create" {
            schema["properties"]["timeout_seconds"] = integer(1, 3600);
            schema["properties"]["request_key"] = serde_json::json!({"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9_.:-]+$","description":"Stable create retry key. Reuse only with identical tool/input; durable receipt survives restarts."});
        }
        let validator =
            jsonschema::validator_for(&schema).expect("static MCP input schema is valid");
        let mut tool = Tool::new(
            name.to_owned(),
            description.to_owned(),
            schema.as_object().unwrap().clone(),
        );
        tool.annotations = Some(
            ToolAnnotations::new()
                .read_only(
                    method == "GET"
                        || path.ends_with("/table/query")
                        || path.ends_with("/table/analysis"),
                )
                .open_world(false),
        );
        Self {
            tool,
            method,
            path: path.into(),
            validator,
        }
    }
}

pub(super) fn build() -> Vec<Spec> {
    let mut tools = vec![Spec::new(
        "raven_dashboard",
        "Read the UI Dashboard across all domains; failures remain isolated.",
        "GET",
        "/api/v1/dashboard",
        object(&[], &[]),
    )];
    for (domain, scopes) in [
        ("todo", TODO_SCOPES),
        ("ledger", LEDGER_SCOPES),
        ("health", HEALTH_SCOPES),
    ] {
        tools.push(Spec::new(&format!("{domain}_search"),"Search the same active tables as the UI. Filters, sort fields and groups depend on scope; invalid combinations are rejected. Use choices first. Relative dates require context.reference_date; planner scopes need context.from/to; linked scopes need parent_type/parent_id. Omitted settings use no filters or grouping; Ledger uses its UI default sort (transactions date descending, masters name ascending). Follow next_offset for more results.","POST",&format!("/api/v1/{domain}/table/query"),table(domain)));
        let mut fields = vec![("scope", choices(scopes))];
        if domain == "todo" {
            fields.extend([
                ("item_id", id()),
                ("horizon", choices(&["week", "month", "year"])),
            ]);
        }
        tools.push(Spec::new(&format!("{domain}_choices"),"Read current UI table selections. Choose exact returned IDs. ToDo item_id excludes invalid/self relations; horizon restricts goal parents. Use todo_options for lifecycle and edit fields.","GET",&format!("/api/v1/{domain}/table/lookups"),object(&fields,&["scope"])));
    }
    tools.push(Spec::new("todo_options","Read UI-compatible create types, type-specific status choices, allowed lifecycle actions and editable fields. Supply id for choices valid for an existing item; otherwise supply type for creation.","GET","/api/v1/todo/options",object(&[("type",choices(&["area","project","goal","routine","task","event"])),("id",id())],&[])));
    tools.push(Spec::new(
        "todo_get",
        "Read full ToDo record before editing. Preserve ID and updated_at for guarded updates.",
        "GET",
        "/api/v1/todo/items/{id}",
        object(&[("id", id())], &["id"]),
    ));
    for kind in ["area", "project", "goal", "routine", "task", "event"] {
        let path = if kind == "area" {
            "/api/v1/todo/areas".into()
        } else {
            format!("/api/v1/todo/{kind}s/propose")
        };
        let required = match kind {
            "project" => vec!["title", "definition_of_done"],
            "goal" => vec!["title", "horizon", "scheduled"],
            "routine" => vec!["title", "recurrence_rule"],
            "event" => vec!["title", "scheduled"],
            _ => vec!["title"],
        };
        tools.push(Spec::new(&format!("todo_{kind}_create"),"Create an active UI item. Read todo_options and todo_choices first. Goal scheduled must be the canonical start of its horizon; parent horizon must be coarser. Use request_key for durable create retries; without it, search before retrying an uncertain result.","POST",&path,object(&todo_fields(kind,false),&required)));
        tools.push(Spec::new(&format!("todo_{kind}_update"),"Edit an existing item of this type. Read todo_options(id) for editable fields. Supply expected_updated_at from todo_get; priority:null clears priority. Terminal items reject edits.","PATCH","/api/v1/todo/items/{id}",object(&todo_fields(kind,true),&["id","expected_updated_at"])));
    }
    tools.push(Spec::new("todo_transition","Run a UI lifecycle action selected from todo_options(id). Postpone also needs caller-local today and scheduled. It creates a follow-up, so check current state before retrying an uncertain result.","POST","/api/v1/todo/items/{id}/{action}",object(&[("id",id()),("action",choices(&["pause","miss","postpone","resume","complete","reopen","archive"])),("reason",text()),("today",date()),("scheduled",date())],&["id","action"])));
    let mut history = page();
    history.push(("id", id()));
    tools.push(Spec::new(
        "todo_history",
        "Read a bounded page of immutable item history. Follow next for later pages.",
        "GET",
        "/api/v1/todo/items/{id}/history",
        object(&history, &["id"]),
    ));
    tools.push(Spec::new("todo_archive_search","Read archived/terminal items; active table searches omit these. Follow next for later pages.","GET","/api/v1/todo/items/archive",object(&page(),&[])));
    tools.push(Spec::new("todo_routine_materialize","Generate routine occurrences through the existing UI service policy. future_occurrences sets the requested horizon.","POST","/api/v1/todo/routines/{id}/materialize",object(&[("id",id()),("future_occurrences",integer(1,todo_engine::domain::MAX_FUTURE_OCCURRENCES))],&["id"])));

    let entry = vec![
        ("date", date()),
        ("content", text()),
        ("category", nullable(id())),
        ("account", id()),
        ("entry_type", choices(&["expense", "income"])),
        ("amount", money()),
        ("currency", id()),
        ("notes", nullable(text())),
    ];
    let transfer = vec![
        ("date", date()),
        ("content", text()),
        ("from_account", id()),
        ("to_account", id()),
        ("amount", money()),
        ("currency", id()),
        ("notes", nullable(text())),
    ];
    let masters = [
        (
            "currency",
            "currencies",
            vec![
                ("code", text()),
                ("name", text()),
                ("symbol", text()),
                ("decimal_places", integer(0, 18)),
            ],
            vec!["code", "name", "symbol", "decimal_places"],
        ),
        (
            "account_category",
            "account-categories",
            vec![
                ("name", text()),
                ("parent", nullable(id())),
                ("liability", boolean()),
            ],
            vec!["name"],
        ),
        (
            "account",
            "accounts",
            vec![
                ("name", text()),
                ("category", id()),
                ("currency", id()),
                ("opening_balance", money()),
            ],
            vec!["name", "category", "currency", "opening_balance"],
        ),
        (
            "category",
            "transaction-categories",
            vec![
                ("name", text()),
                ("parent", nullable(id())),
                ("kind", choices(&["expense", "income"])),
            ],
            vec!["name", "kind"],
        ),
    ];
    for (kind, resource, fields, required) in masters {
        let path = format!("/api/v1/ledger/{resource}");
        let mut paging = page();
        paging.extend([("include_inactive", boolean()), ("query", text())]);
        tools.push(Spec::new(&format!("ledger_{kind}_list"),"Read master data for selection; inactive values require include_inactive. Follow next_offset for more pages.","GET",&path,object(&paging,&[])));
        tools.push(Spec::new(&format!("ledger_{kind}_create"),"Create UI master data. Select existing parent, currency or category from current choices/list tools. Use request_key for durable create retries; otherwise inspect before retrying.","POST",&path,object(&fields,&required)));
        let mut updates = fields;
        updates.extend([("id", id()), ("active", boolean())]);
        tools.push(Spec::new(&format!("ledger_{kind}_update"),"Edit or activate/deactivate UI master data. Existing service validates references and cycles.","PATCH",&format!("{path}/{{id}}"),object(&updates,&["id"])));
    }
    for (kind, resource, mut fields, mut required) in [
        (
            "entry",
            "entries",
            entry,
            vec![
                "date",
                "content",
                "account",
                "entry_type",
                "amount",
                "currency",
            ],
        ),
        (
            "transfer",
            "transfers",
            transfer,
            vec![
                "date",
                "content",
                "from_account",
                "to_account",
                "amount",
                "currency",
            ],
        ),
    ] {
        let path = format!("/api/v1/ledger/{resource}");
        tools.push(Spec::new(
            &format!("ledger_{kind}_get"),
            "Read full record before editing or retrying an uncertain mutation.",
            "GET",
            &format!("{path}/{{id}}"),
            object(
                &[("id", id()), ("include_archived", boolean())]
                    .into_iter()
                    .filter(|(key, _)| kind == "entry" || *key != "include_archived")
                    .collect::<Vec<_>>(),
                &["id"],
            ),
        ));
        let mut creation = fields.clone();
        let mut create_required = required.clone();
        if kind == "transfer" {
            creation.push(("operation_key",serde_json::json!({"type":"string","format":"uuid","description":"Generate one UUID v4 for this transfer; reuse it with identical input on retries."})));
            create_required.push("operation_key");
        }
        tools.push(Spec::new(&format!("ledger_{kind}_create"),"Create a UI transaction. entry_type is expense/income only. Transfers use a caller-generated stable operation_key: reuse the same key on retries to avoid duplicates. Regular entries support optional request_key receipts.","POST",&path,object(&creation,&create_required)));
        fields.push(("id", id()));
        if kind == "entry" {
            required = vec!["id"];
        } else {
            required.push("id");
        }
        tools.push(Spec::new(&format!("ledger_{kind}_update"),"Edit UI transaction with the existing money/reference policy. Transfer updates require the complete transaction body.","PATCH",&format!("{path}/{{id}}"),object(&fields,&required)));
    }
    for action in ["archive", "restore"] {
        tools.push(Spec::new(
            &format!("ledger_entry_{action}"),
            "Archive/restore a UI entry. Transfers preserve pair consistency through the service.",
            "POST",
            &format!("/api/v1/ledger/entries/{{id}}/{action}"),
            object(&[("id", id())], &["id"]),
        ));
    }
    tools.push(Spec::new("ledger_account_category_purge_preview","Read confirmation_id before permanent account-category purge. Only this master type supports purge.","GET","/api/v1/ledger/account-categories/{id}/purge",object(&[("id",id())],&["id"])));
    tools.push(Spec::new("ledger_account_category_purge","Permanently purge an account category. Requires explicit user authorization and exact confirmation_id returned by preview; service rejects referenced records.","DELETE","/api/v1/ledger/account-categories/{id}",object(&[("id",id()),("confirmation",id())],&["id","confirmation"])));
    tools.push(Spec::new(
        "ledger_balances",
        "Read current UI account balances.",
        "GET",
        "/api/v1/ledger/account-balances",
        object(&page(), &[]),
    ));
    for report in ["summary", "categories", "trend"] {
        tools.push(Spec::new(
            &format!("ledger_report_{report}"),
            "Read UI report for an inclusive calendar range.",
            "GET",
            &format!("/api/v1/ledger/reports/{report}"),
            object(&[("from", date()), ("to", date())], &["from", "to"]),
        ));
    }
    tools.push(Spec::new("ledger_report_compare","Compare UI report periods. Presets use server local date; custom requires from/to and presets must omit them.","GET","/api/v1/ledger/reports/compare",object(&[("period",choices(&["current_month","previous_month","current_year","custom"])),("from",date()),("to",date())],&["period"])));
    tools.push(Spec::new(
        "ledger_analysis",
        "Read the UI transaction analysis using the same table query, filters and context.",
        "POST",
        "/api/v1/ledger/table/analysis",
        table_for_scope("ledger.transactions"),
    ));

    tools.push(Spec::new("health_diet_create","Create a UI diet record with current meal/tag choices. Use request_key for durable create retries; otherwise search before retrying.","POST","/api/v1/health/diet",object(&diet_fields(false),&["occurred_at","meal_type","food_name"])));
    tools.push(Spec::new("health_diet_update","Edit diet record. expected_updated_at prevents stale edits; note:null clears note; remove_image removes its photo.","PATCH","/api/v1/health/diet/{id}",object(&diet_fields(true),&["id","expected_updated_at"])));
    for update in [false, true] {
        let mut fields = diet_fields(update);
        fields.retain(|(name, _)| !matches!(*name, "id" | "remove_image"));
        let metadata = object(
            &fields,
            if update {
                &["expected_updated_at"]
            } else {
                &["occurred_at", "meal_type", "food_name"]
            },
        );
        let mut input = vec![
            ("metadata", metadata),
            (
                "content_type",
                choices(&["image/png", "image/jpeg", "image/webp"]),
            ),
            (
                "image_base64",
                serde_json::json!({"type":"string","minLength":1,"maxLength":13981016}),
            ),
        ];
        let mut required = vec!["metadata", "content_type", "image_base64"];
        if update {
            input.push(("id", id()));
            required.push("id");
        }
        tools.push(Spec::new(if update { "health_diet_image_update" } else { "health_diet_image_create" },"Save diet with a base64 PNG/JPEG/WebP photo, at most 10 MiB decoded. Metadata uses the same UI fields; updates require expected_updated_at. No local paths or remote URLs. Creates support optional request_key receipts.",if update { "PATCH" } else { "POST" },if update { "/api/v1/health/diet/{id}/with-image" } else { "/api/v1/health/diet/with-image" },object(&input,&required)));
    }
    tools.push(Spec::new(
        "health_diet_image_get",
        "Read the existing diet photo as MCP image content.",
        "GET",
        "/api/v1/health/diet/{id}/image",
        object(&[("id", id())], &["id"]),
    ));
    for kind in ["bowel", "medication"] {
        tools.push(Spec::new(&format!("health_{kind}_create"),"Create a UI bowel/medication event. Choose valid details fields and medication unit from health_choices. Creates support optional request_key receipts.","POST","/api/v1/health/events",object(&event_fields(kind,false),&["occurred_at","details"])));
        tools.push(Spec::new(&format!("health_{kind}_update"),"Edit a UI bowel/medication event. Preserve its kind; supply expected_updated_at from health_event_get.","PATCH","/api/v1/health/events/{id}",object(&event_fields(kind,true),&["id","expected_updated_at"])));
    }
    for (kind, resource) in [("diet", "diet"), ("event", "events")] {
        tools.push(Spec::new(
            &format!("health_{kind}_get"),
            "Read full UI record including updated_at for guarded edits.",
            "GET",
            &format!("/api/v1/health/{resource}/{{id}}"),
            object(&[("id", id()), ("include_archived", boolean())], &["id"]),
        ));
        for action in ["archive", "restore"] {
            tools.push(Spec::new(&format!("health_{kind}_{action}"),"Archive/restore UI record with expected_updated_at. Daily metrics are saved through health_daily_upsert.","POST",&format!("/api/v1/health/{resource}/{{id}}/{action}"),object(&[("id",id()),("expected_updated_at",timestamp())],&["id","expected_updated_at"])));
        }
    }
    let details = serde_json::json!({"oneOf":[event_details("weight"),event_details("sleep"),event_details("lab"),event_details("overall_condition")]});
    let daily = object(
        &[
            ("occurred_at", timestamp()),
            ("details", details),
            ("expected_updated_at", timestamp()),
        ],
        &["occurred_at", "details"],
    );
    let archives = object(
        &[("id", id()), ("expected_updated_at", timestamp())],
        &["id", "expected_updated_at"],
    );
    tools.push(Spec::new("health_daily_upsert","Save the same daily metric row as the UI: weight, sleep, CRP, fecal calprotectin and condition only. Read existing rows first and provide expected_updated_at for changes. Atomic metrics/archives batch, 1..366 operations, UTC+09:00 day. No generic metric-add operation.","POST","/api/v1/health/metrics/daily",object(&[("metrics",array(daily)),("archives",array(archives))],&["metrics"])));
    tools.push(Spec::new(
        "health_records",
        "Read bounded UI record-recovery pages including archived records.",
        "GET",
        "/api/v1/health/records",
        object(&page(), &[]),
    ));
    tools.push(Spec::new(
        "health_reports",
        "Read UI health reports for an inclusive calendar date range.",
        "GET",
        "/api/v1/health/reports",
        object(&[("from", date()), ("to", date())], &["from", "to"]),
    ));
    for (domain, types) in [
        (
            "ledger",
            &[
                "entry",
                "currency",
                "account_category",
                "account",
                "transaction_category",
            ][..],
        ),
        ("health", &["diet_entry", "health_event", "media_file"][..]),
    ] {
        let mut fields = page();
        fields.extend([("record_type", choices(types)), ("id", id())]);
        tools.push(Spec::new(
            &format!("{domain}_audit"),
            "Read a bounded page of immutable UI record audit history.",
            "GET",
            &format!("/api/v1/{domain}/audit/{{record_type}}/{{id}}"),
            object(&fields, &["record_type", "id"]),
        ));
    }
    tools.push(Spec::new("todo_routines_materialize", "Materialize all active due routines through service policy. Uses server local date; creates no occurrences during reads.", "POST", "/api/v1/todo/routines/materialize", object(&[], &[])));
    let mut entries = page();
    entries.extend([
        ("date_from", date()),
        ("date_to", date()),
        (
            "entry_type",
            choices(&[
                "expense",
                "income",
                "transfer_in",
                "transfer_out",
                "adjustment_in",
                "adjustment_out",
            ]),
        ),
        ("account", id()),
        ("category", id()),
        ("currency", id()),
        ("content", text()),
        ("include_archived", boolean()),
    ]);
    tools.push(Spec::new("ledger_entry_list", "Read bounded entries, including archived rows when requested; filters apply before paging.", "GET", "/api/v1/ledger/entries", object(&entries,&[])));
    let budget = vec![
        ("max_records", integer(1, 1_000_000)),
        ("max_bytes", integer(1, 8 * 1024 * 1024)),
    ];
    tools.push(Spec::new(
        "ledger_doctor",
        "Read bounded Ledger integrity and invariant diagnostics. Does not repair or migrate data.",
        "GET",
        "/api/v1/ledger/doctor",
        object(&budget, &[]),
    ));
    let mut export = budget;
    export.push(("include_archived", boolean()));
    tools.push(Spec::new("ledger_export", "Return bounded structured Ledger export. include_archived produces a restore-capable snapshot; no filesystem destination.", "GET", "/api/v1/ledger/export", object(&export,&[])));
    let mut events = page();
    events.extend([
        (
            "category",
            choices(&[
                "weight",
                "bowel",
                "sleep",
                "lab",
                "symptom",
                "medication",
                "overall_condition",
            ]),
        ),
        ("metric_key", text()),
        ("daily_only", boolean()),
        ("metrics_only", boolean()),
    ]);
    tools.push(Spec::new("health_event_list", "Read bounded event history, including historical metric categories and keys. daily_only is optional; metrics_only restricts to metrics.", "GET", "/api/v1/health/events/page", object(&events,&[])));
    let mut items = page();
    items.extend([
        (
            "type",
            choices(&[
                "area",
                "project",
                "goal",
                "routine",
                "task",
                "event",
                "review",
                "archive_item",
            ]),
        ),
        (
            "status",
            choices(&[
                "active",
                "waiting",
                "paused",
                "completed",
                "cancelled",
                "dropped",
                "archived",
                "missed",
                "rejected",
            ]),
        ),
        ("area_id", id()),
        ("project_id", id()),
        ("parent_id", id()),
        ("routine_id", id()),
        ("horizon", choices(&["week", "month", "year"])),
        ("scheduled", text()),
        ("query", text()),
        ("include_archived", boolean()),
        ("scope", choices(&["list", "archive", "today"])),
        ("today", date()),
    ]);
    tools.push(Spec::new("todo_list", "Read CLI-compatible bounded items. scope=archive includes terminal records; status=active gives pending work; scope=today requires caller-local today and never materializes routines.", "GET", "/api/v1/todo/items/page", object(&items,&[])));
    tools
}
