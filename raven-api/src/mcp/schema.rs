use serde_json::{Value, json};

pub(super) fn object(fields: &[(&str, Value)], required: &[&str]) -> Value {
    json!({"type":"object", "additionalProperties":false,
        "properties":fields.iter().cloned().map(|(k,v)|(k.to_owned(),v)).collect::<serde_json::Map<_,_>>(),
        "required":required})
}

pub(super) fn text() -> Value {
    json!({"type":"string"})
}
pub(super) fn boolean() -> Value {
    json!({"type":"boolean"})
}
pub(super) fn number() -> Value {
    json!({"type":"number"})
}
pub(super) fn integer(min: i64, max: i64) -> Value {
    json!({"type":"integer","minimum":min,"maximum":max})
}
pub(super) fn choices(values: &[&str]) -> Value {
    json!({"type":"string","enum":values})
}
pub(super) fn strings() -> Value {
    array(text())
}
pub(super) fn array(items: Value) -> Value {
    json!({"type":"array","items":items})
}
pub(super) fn nullable(value: Value) -> Value {
    json!({"anyOf":[value,{"type":"null"}]})
}
pub(super) fn id() -> Value {
    json!({"type":"string","minLength":1,"maxLength":256,"description":"Exact record ID from a search or choices result."})
}
pub(super) fn date() -> Value {
    json!({"type":"string","pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}$","description":"Calendar date YYYY-MM-DD."})
}
pub(super) fn timestamp() -> Value {
    json!({"type":"string","description":"RFC 3339 timestamp with explicit offset. Health daily dates use UTC+09:00."})
}
pub(super) fn money() -> Value {
    json!({"type":"string","description":"Decimal amount in the selected currency. Use a string; never floating-point JSON money."})
}

pub(super) fn page() -> Vec<(&'static str, Value)> {
    vec![
        ("offset", integer(0, u32::MAX.into())),
        ("limit", integer(1, 100)),
    ]
}

pub(super) fn todo_fields(kind: &str, update: bool) -> Vec<(&'static str, Value)> {
    let mut fields = vec![("title", text()), ("note", text()), ("tags", strings())];
    fields.extend(match kind {
        "area" => vec![
            ("standard", text()),
            (
                "review_cycle",
                choices(&["daily", "weekly", "monthly", "quarterly"]),
            ),
        ],
        "project" => vec![
            ("area", id()),
            ("definition_of_done", text()),
            ("outcome", text()),
            ("due", date()),
        ],
        "goal" => vec![
            ("horizon", choices(&["week", "month", "year"])),
            ("scheduled", date()),
            ("parent_id", id()),
        ],
        "routine" => vec![
            ("area", id()),
            ("project_id", id()),
            ("priority", integer(1, 10)),
            ("recurrence_rule", text()),
            (
                "materialization_policy",
                choices(&["single_open", "per_occurrence"]),
            ),
        ],
        "task" => vec![
            ("area", id()),
            ("project_id", id()),
            ("scheduled", date()),
            ("due", date()),
            ("priority", integer(1, 10)),
        ],
        "event" => vec![
            ("area", id()),
            ("project_id", id()),
            ("scheduled", timestamp()),
            ("due", date()),
            ("priority", integer(1, 10)),
            ("location", text()),
            ("participants", strings()),
            ("commitment_type", text()),
        ],
        _ => unreachable!("catalog only contains UI create types"),
    });
    if !update && kind != "area" {
        fields.push(("actor", choices(&["agent", "user", "system"])));
    }
    if kind == "routine" {
        fields.push((
            "future_occurrences",
            integer(1, todo_engine::domain::MAX_FUTURE_OCCURRENCES),
        ));
    }
    if update {
        if kind == "task" {
            fields.push(("parent_id", id()));
        }
        for (name, value) in &mut fields {
            if *name == "priority" {
                *value = nullable(value.clone());
            } else if matches!(
                *name,
                "area" | "project_id" | "parent_id" | "due" | "scheduled" | "review_cycle"
            ) && (kind != "goal" || *name == "parent_id")
            {
                *value = json!({"anyOf":[value.clone(),{"const":""}]});
            }
        }
        fields.extend([
            ("id", id()),
            ("expected_updated_at", timestamp()),
            ("reason", text()),
        ]);
    }
    fields
}

pub(super) fn diet_fields(update: bool) -> Vec<(&'static str, Value)> {
    let mut fields = vec![
        ("occurred_at", timestamp()),
        (
            "meal_type",
            choices(&["breakfast", "lunch", "dinner", "snack", "late_night"]),
        ),
        ("food_name", text()),
        ("tags", strings()),
        ("note", nullable(text())),
    ];
    if update {
        fields.extend([
            ("id", id()),
            ("expected_updated_at", timestamp()),
            ("remove_image", boolean()),
        ]);
    }
    fields
}

pub(super) fn event_details(kind: &str) -> Value {
    let mut fields = vec![("kind", choices(&[kind]))];
    let required: &[&str] = match kind {
        "bowel" => {
            fields.extend([
                ("bristol_scale", integer(1, 7)),
                ("blood_visible", boolean()),
            ]);
            &["kind", "bristol_scale"]
        }
        "medication" => {
            fields.extend([
                ("medication_name", text()),
                ("dose", number()),
                (
                    "unit",
                    choices(&[
                        "tablet", "capsule", "packet", "mg", "g", "ml", "drop", "dose",
                    ]),
                ),
            ]);
            &["kind", "medication_name", "dose", "unit"]
        }
        "weight" => {
            fields.extend([
                ("value", number()),
                ("key", choices(&["body_weight"])),
                ("name", choices(&["Body weight"])),
                ("unit", choices(&["kg"])),
            ]);
            &["kind", "value", "unit"]
        }
        "sleep" => {
            fields.extend([
                ("value", number()),
                ("key", choices(&["sleep_duration"])),
                ("name", choices(&["Sleep duration"])),
            ]);
            &["kind", "value"]
        }
        "lab" => {
            fields.extend([
                ("value", number()),
                ("key", choices(&["crp", "fecal_calprotectin"])),
                ("name", choices(&["CRP", "Fecal calprotectin"])),
                ("unit", choices(&["mg/L", "µg/g"])),
            ]);
            &["kind", "value", "key", "name", "unit"]
        }
        "overall_condition" => {
            fields.extend([
                ("score", integer(1, 10)),
                ("name", choices(&["Overall condition"])),
                ("condition_note", nullable(text())),
            ]);
            &["kind", "score"]
        }
        _ => unreachable!("catalog only contains UI event kinds"),
    };
    object(&fields, required)
}

pub(super) fn event_fields(kind: &str, update: bool) -> Vec<(&'static str, Value)> {
    let mut fields = vec![
        ("occurred_at", timestamp()),
        ("details", event_details(kind)),
        ("note", nullable(text())),
    ];
    if update {
        fields.extend([("id", id()), ("expected_updated_at", timestamp())]);
    }
    fields
}

pub(super) const TODO_SCOPES: &[&str] = &[
    "workspace.area",
    "workspace.project",
    "workspace.goal",
    "workspace.routine",
    "workspace.task",
    "workspace.event",
    "planner.yearly-period-goals",
    "planner.yearly-month-goals",
    "planner.monthly-period-goals",
    "planner.monthly-week-goals",
    "planner.weekly-month-goals",
    "planner.weekly-week-goals",
    "planner.monthly-calendar",
    "planner.weekly-day-grid",
    "planner.daily-today",
    "planner.daily-overdue",
    "planner.daily-unscheduled",
    "linked.area.project",
    "linked.area.routine",
    "linked.area.task",
    "linked.area.event",
    "linked.project.routine",
    "linked.project.task",
    "linked.project.event",
    "linked.routine.task",
    "linked.goal.goal",
    "linked.goal.task",
];
pub(super) const LEDGER_SCOPES: &[&str] = &[
    "ledger.transactions",
    "ledger.accounts",
    "ledger.categories",
];
pub(super) const HEALTH_SCOPES: &[&str] = &[
    "health.diet",
    "health.bowel",
    "health.medication",
    "health.metrics",
];

pub(super) fn table(domain: &str) -> Value {
    let (scopes, fields, groups): (&[&str], &[&str], &[&str]) = match domain {
        "todo" => (
            TODO_SCOPES,
            &[
                "title",
                "status",
                "tags",
                "note",
                "area",
                "project",
                "routine",
                "due",
                "horizon",
                "scheduled",
                "parent",
                "priority",
                "recurrence_rule",
                "materialization_policy",
                "description",
                "location",
                "participants",
                "commitment_type",
            ],
            &[
                "none",
                "tag",
                "status",
                "area",
                "project",
                "routine",
                "month",
                "week",
                "day",
                "item_type",
            ],
        ),
        "ledger" => (
            LEDGER_SCOPES,
            &[
                "date",
                "content",
                "entry_type",
                "account",
                "category",
                "currency",
                "amount",
                "name",
                "account_type",
                "current_balance",
                "kind",
                "parent",
            ],
            &[
                "none",
                "month",
                "week",
                "day",
                "entry_type",
                "account",
                "category",
                "currency",
                "account_type",
                "kind",
                "parent",
            ],
        ),
        "health" => (
            HEALTH_SCOPES,
            &[
                "date",
                "meal_type",
                "food",
                "tags",
                "has_photo",
                "bristol_scale",
                "blood_visible",
                "medication_name",
                "dose",
                "medication_unit",
                "weight",
                "sleep",
                "crp",
                "calprotectin",
                "condition",
            ],
            &[
                "none",
                "month",
                "week",
                "day",
                "meal_type",
                "tag",
                "has_photo",
                "bristol_scale",
                "blood_visible",
                "medication_name",
                "medication_unit",
            ],
        ),
        _ => unreachable!(),
    };
    let filter_value = json!({"oneOf":[
        object(&[("text",text())],&["text"]), object(&[("list",strings())],&["list"]),
        object(&[("range",object(&[("start",text()),("end",text())],&["start","end"]))],&["range"]),
        object(&[("relative",object(&[("amount",text()),("unit",choices(&["day","week","month"]))],&["amount","unit"]))],&["relative"]),
        object(&[("empty",json!({"const":true}))],&["empty"])
    ]});
    let filter = object(
        &[
            ("field", choices(fields)),
            (
                "operator",
                choices(&[
                    "is",
                    "is_not",
                    "contains",
                    "does_not_contain",
                    "starts_with",
                    "ends_with",
                    "is_before",
                    "is_after",
                    "is_on_or_before",
                    "is_on_or_after",
                    "is_between",
                    "is_relative_to_today",
                    "greater_than",
                    "less_than",
                    "is_empty",
                    "is_not_empty",
                ]),
            ),
            ("value", filter_value),
        ],
        &["field", "operator", "value"],
    );
    let mut sort_fields = fields.to_vec();
    sort_fields.push("updated");
    if domain == "health" {
        sort_fields.push("created");
    }
    let sort = object(
        &[
            ("field", choices(&sort_fields)),
            ("direction", choices(&["asc", "desc"])),
        ],
        &["field", "direction"],
    );
    let mut context = vec![("reference_date", date())];
    if domain == "todo" {
        context.extend([
            ("from", date()),
            ("to", date()),
            (
                "parent_type",
                choices(&["area", "project", "goal", "routine"]),
            ),
            ("parent_id", id()),
        ]);
    }
    let group_settings = object(
        &[
            (
                "sort",
                choices(&["manual", "alphabetical", "reverse_alphabetical"]),
            ),
            ("hide_empty", boolean()),
            ("manual_order", strings()),
            ("hidden_group_keys", strings()),
        ],
        &["sort", "hide_empty", "manual_order", "hidden_group_keys"],
    );
    object(
        &[
            ("scope", choices(scopes)),
            ("offset", integer(0, u32::MAX.into())),
            ("limit", integer(1, 50)),
            ("filter_mode", choices(&["and", "or"])),
            ("filters", array(filter)),
            ("sorts", array(sort)),
            ("group_by", choices(groups)),
            ("group_settings", group_settings),
            ("context", object(&context, &[])),
        ],
        &["scope"],
    )
}

pub(super) fn table_for_scope(scope: &str) -> Value {
    let domain = scope.split('.').next().unwrap();
    let domain = if domain == "workspace" || domain == "planner" || domain == "linked" {
        "todo"
    } else {
        domain
    };
    let (fields, sorts, groups): (&[&str], &[&str], &[&str]) = match scope {
        "ledger.transactions" => (
            &[
                "date",
                "content",
                "entry_type",
                "account",
                "category",
                "currency",
                "amount",
            ],
            &[
                "date", "content", "account", "category", "amount", "updated",
            ],
            &[
                "none",
                "month",
                "week",
                "day",
                "account",
                "category",
                "entry_type",
            ],
        ),
        "ledger.accounts" => (
            &["name", "account_type", "currency", "current_balance"],
            &["name", "account_type", "currency", "current_balance"],
            &["none", "account_type", "currency"],
        ),
        "ledger.categories" => (
            &["name", "kind", "parent"],
            &["name", "kind", "parent"],
            &["none", "kind", "parent"],
        ),
        "health.diet" => (
            &["date", "meal_type", "food", "tags", "has_photo"],
            &["date", "meal_type", "food", "created", "updated"],
            &[
                "none",
                "month",
                "week",
                "day",
                "meal_type",
                "tag",
                "has_photo",
            ],
        ),
        "health.bowel" => (
            &["date", "bristol_scale", "blood_visible"],
            &["date", "bristol_scale", "created", "updated"],
            &[
                "none",
                "month",
                "week",
                "day",
                "bristol_scale",
                "blood_visible",
            ],
        ),
        "health.medication" => (
            &["date", "medication_name", "medication_unit"],
            &["date", "medication_name", "dose", "created", "updated"],
            &[
                "none",
                "month",
                "week",
                "day",
                "medication_name",
                "medication_unit",
            ],
        ),
        "health.metrics" => (
            &[
                "date",
                "weight",
                "sleep",
                "crp",
                "calprotectin",
                "condition",
            ],
            &[
                "date",
                "weight",
                "sleep",
                "crp",
                "calprotectin",
                "condition",
            ],
            &["none", "month", "week"],
        ),
        _ if scope.starts_with("planner.") && scope.ends_with("goals") => (
            &[
                "title",
                "status",
                "tags",
                "horizon",
                "scheduled",
                "due",
                "parent",
                "note",
            ],
            &[],
            &["none", "tag", "status"],
        ),
        _ if scope.starts_with("planner.") => (
            &[
                "title",
                "status",
                "tags",
                "area",
                "project",
                "routine",
                "scheduled",
                "due",
                "priority",
                "recurrence_rule",
                "materialization_policy",
                "location",
                "participants",
                "commitment_type",
                "description",
                "note",
            ],
            &[],
            &[
                "none",
                "month",
                "week",
                "day",
                "area",
                "project",
                "routine",
                "tag",
                "item_type",
                "status",
            ],
        ),
        _ => match scope.rsplit('.').next().unwrap() {
            "area" => (
                &["title", "status", "tags", "note"],
                &[],
                &["none", "tag", "status"],
            ),
            "project" => (
                &["title", "status", "tags", "area", "due", "note"],
                &[],
                &["none", "tag", "status", "area"],
            ),
            "goal" => (
                &[
                    "title",
                    "status",
                    "tags",
                    "horizon",
                    "scheduled",
                    "parent",
                    "note",
                ],
                &[],
                &["none", "tag", "status"],
            ),
            "routine" => (
                &[
                    "title",
                    "status",
                    "tags",
                    "area",
                    "project",
                    "recurrence_rule",
                    "materialization_policy",
                    "priority",
                    "description",
                    "note",
                ],
                &[],
                &["none", "tag", "status", "area", "project"],
            ),
            "task" => (
                &[
                    "title",
                    "status",
                    "tags",
                    "area",
                    "project",
                    "routine",
                    "scheduled",
                    "due",
                    "priority",
                    "description",
                    "note",
                ],
                &[],
                &["none", "tag", "status", "area", "project", "routine"],
            ),
            "event" => (
                &[
                    "title",
                    "status",
                    "tags",
                    "area",
                    "project",
                    "scheduled",
                    "due",
                    "priority",
                    "location",
                    "participants",
                    "commitment_type",
                    "description",
                    "note",
                ],
                &[],
                &["none", "tag", "status", "area", "project"],
            ),
            _ => unreachable!("scope validated against catalog"),
        },
    };
    let mut schema = table(domain);
    let properties = &mut schema["properties"];
    properties["scope"] = choices(&[scope]);
    properties["filters"]["items"]["properties"]["field"] = choices(fields);
    let mut default_sorts = fields.to_vec();
    default_sorts.push("updated");
    properties["sorts"]["items"]["properties"]["field"] = choices(if sorts.is_empty() {
        &default_sorts
    } else {
        sorts
    });
    properties["group_by"] = choices(groups);
    if scope.starts_with("planner.") {
        properties["context"] = object(
            &[("from", date()), ("to", date()), ("reference_date", date())],
            &["from", "to"],
        );
    } else if scope.starts_with("linked.") {
        let parent = scope.split('.').nth(1).unwrap();
        properties["context"] = object(
            &[
                ("parent_type", choices(&[parent])),
                ("parent_id", id()),
                ("reference_date", date()),
            ],
            &["parent_type", "parent_id"],
        );
    } else {
        properties["context"] = object(&[("reference_date", date())], &[]);
    }
    if scope.starts_with("planner.") || scope.starts_with("linked.") {
        schema["required"]
            .as_array_mut()
            .unwrap()
            .push(json!("context"));
    }
    schema
}
