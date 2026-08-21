use std::collections::HashMap;

use rusqlite::{Connection, params_from_iter, types::Value};
use time::{Date, Duration, Month};

use crate::application::{
    error::{HealthError, HealthResult},
    table::*,
};
use crate::domain::{HealthCategory, HealthEventDetails, MealType, MedicationUnit};

use super::{
    mapping::{DIET_COLUMNS, EVENT_COLUMNS, row_to_diet, row_to_event},
    storage_error,
};

struct PageKey {
    id: String,
    group_key: String,
    group_label: String,
}

pub(super) fn query_table(
    connection: &Connection,
    query: &HealthTableQuery,
) -> HealthResult<TablePage<HealthTableRow>> {
    let (sql, values) = page_sql(query);
    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    let mut keys = statement
        .query_map(params_from_iter(values), |r| {
            Ok(PageKey {
                id: r.get(0)?,
                group_key: r.get(1)?,
                group_label: r.get(2)?,
            })
        })
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    debug_assert!(keys.len() <= usize::from(query.limit()) + 1);
    let more = keys.len() > usize::from(query.limit());
    keys.truncate(usize::from(query.limit()));
    let records = load_records(connection, query.scope(), &keys)?;
    let mut items = Vec::with_capacity(keys.len());
    for key in keys {
        let record = records.get(&key.id).cloned().ok_or_else(|| {
            HealthError::Storage("selected health table record disappeared".into())
        })?;
        items.push(HealthTableRow::new(
            (!key.group_key.is_empty()).then_some(key.group_key),
            (!key.group_label.is_empty()).then_some(key.group_label),
            record,
        )?);
    }
    Ok(TablePage {
        items,
        next_offset: if more {
            Some(
                query
                    .offset()
                    .checked_add(u32::from(query.limit()))
                    .ok_or_else(|| HealthError::Validation {
                        field: "page",
                        message: "page offset exceeds the supported range".into(),
                    })?,
            )
        } else {
            None
        },
    })
}

fn page_sql(query: &HealthTableQuery) -> (String, Vec<Value>) {
    let mut values = Vec::new();
    let (base, key, label) = base_sql(query.group_settings().group_by());
    let filters = filters_sql(query, &mut values);
    let hidden = hidden_sql(query, &mut values);
    let group_order = group_order(query, &mut values);
    let row_order = row_order(query);
    let occurrences = if matches!(
        query.group_settings().group_by(),
        HealthTableGroup::Diet(DietTableGroup::Tag)
    ) {
        "SELECT filtered.*,CASE WHEN t.name IS NULL THEN 'untagged' WHEN t.name='untagged' OR substr(t.name,1,1)='\\' THEN '\\'||t.name ELSE t.name END group_key,COALESCE(t.name,'Untagged') group_label FROM filtered LEFT JOIN diet_entry_tags l ON l.diet_entry_id=filtered.id LEFT JOIN diet_tags t ON t.id=l.tag_id".to_string()
    } else {
        format!("SELECT filtered.*,{key} group_key,{label} group_label FROM filtered")
    };
    values.push(Value::Integer(i64::from(query.limit()) + 1));
    values.push(Value::Integer(i64::from(query.offset())));
    (
        format!(
            "WITH base AS ({base}),filtered AS (SELECT * FROM base WHERE {filters}),occurrences AS ({occurrences}),ranked AS (SELECT occurrences.*,ROW_NUMBER() OVER (ORDER BY {row_order},logical_id ASC,group_key ASC,id ASC) occurrence_rank FROM occurrences),ranked_groups AS (SELECT ranked.*,MIN(occurrence_rank) OVER (PARTITION BY group_key) group_rank FROM ranked) SELECT id,group_key,group_label FROM ranked_groups WHERE 1{hidden} ORDER BY {group_order}{row_order},logical_id ASC,group_key ASC,id ASC LIMIT ? OFFSET ?"
        ),
        values,
    )
}

fn base_sql(group: HealthTableGroup) -> (String, String, String) {
    match group {
        HealthTableGroup::Diet(g) => {
            let (k, l) = date_group(g, "local_date");
            let (k,l)=match g{DietTableGroup::MealType=>("meal_type".into(),"CASE meal_type WHEN 'late_night' THEN 'Late night' ELSE upper(substr(meal_type,1,1))||substr(meal_type,2) END".into()),DietTableGroup::HasPhoto=>("CASE WHEN media_id IS NULL THEN 'without-photo' ELSE 'with-photo' END".into(),"CASE WHEN media_id IS NULL THEN 'Without photo' ELSE 'With photo' END".into()),DietTableGroup::Tag=>("''".into(),"''".into()),_ =>(k,l)};
            (
                "SELECT d.id logical_id,d.* FROM diet_entries d WHERE deleted_at IS NULL".into(),
                k,
                l,
            )
        }
        HealthTableGroup::Bowel(g) => {
            let (k, l) = date_group_bowel(g, "local_date");
            let (k,l)=match g{BowelTableGroup::BristolScale=>("CAST(json_extract(attributes_json,'$.bristol_scale') AS TEXT)".into(),"'Type '||json_extract(attributes_json,'$.bristol_scale')".into()),BowelTableGroup::BloodVisible=>("CASE json_extract(attributes_json,'$.blood_visible') WHEN 1 THEN 'yes' ELSE 'no' END".into(),"CASE json_extract(attributes_json,'$.blood_visible') WHEN 1 THEN 'Yes' ELSE 'No' END".into()),_=>(k,l)};
            (event_base("bowel"), k, l)
        }
        HealthTableGroup::Medication(g) => {
            let (k, l) = date_group_med(g, "local_date");
            let (k, l) = match g {
                MedicationTableGroup::MedicationName => (
                    "json_extract(attributes_json,'$.medication_name')".into(),
                    "json_extract(attributes_json,'$.medication_name')".into(),
                ),
                MedicationTableGroup::MedicationUnit => (
                    "json_extract(attributes_json,'$.unit')".into(),
                    "CASE json_extract(attributes_json,'$.unit') WHEN 'tablet' THEN '정' WHEN 'capsule' THEN '캡슐' WHEN 'packet' THEN '포' WHEN 'drop' THEN '방울' WHEN 'dose' THEN '회' ELSE json_extract(attributes_json,'$.unit') END".into(),
                ),
                _ => (k, l),
            };
            (event_base("medication"), k, l)
        }
        HealthTableGroup::Metrics(g) => {
            let (k, l) = match g {
                MetricsTableGroup::None => ("''".into(), "''".into()),
                MetricsTableGroup::Month => month("local_date"),
                MetricsTableGroup::Week => week("local_date"),
            };
            (metrics_base(), k, l)
        }
    }
}
fn event_base(category: &str) -> String {
    format!(
        "SELECT id logical_id,e.* FROM health_events e WHERE deleted_at IS NULL AND category='{category}'"
    )
}
fn metrics_base() -> String {
    "SELECT local_date logical_id,local_date id,local_date,
 MAX(CASE WHEN category='weight' AND metric_key='body_weight' AND name='Body weight' AND unit='kg' THEN value_num END) weight,
 MAX(CASE WHEN category='sleep' AND metric_key='sleep_duration' AND name='Sleep' AND unit='hours' THEN value_num END) sleep,
 MAX(CASE WHEN category='lab' AND metric_key='crp' AND name='CRP' AND unit='mg/L' THEN value_num END) crp,
 MAX(CASE WHEN category='lab' AND metric_key='fecal_calprotectin' AND name='Fecal calprotectin' AND unit='µg/g' THEN value_num END) calprotectin,
 MAX(CASE WHEN category='symptom' AND metric_key='overall_condition' AND name='Overall condition' AND (unit IS NULL OR unit='score') THEN value_num END) condition,
 MIN(created_at) created_at,MAX(updated_at) updated_at
 FROM health_events WHERE deleted_at IS NULL AND daily_upsert=1 AND ".to_string() + metric_identity_sql() + " GROUP BY local_date"
}
fn metric_identity_sql() -> &'static str {
    "((category='weight' AND metric_key='body_weight' AND name='Body weight' AND unit='kg') OR
      (category='sleep' AND metric_key='sleep_duration' AND name='Sleep' AND unit='hours') OR
      (category='lab' AND metric_key='crp' AND name='CRP' AND unit='mg/L') OR
      (category='lab' AND metric_key='fecal_calprotectin' AND name='Fecal calprotectin' AND unit='µg/g') OR
      (category='symptom' AND metric_key='overall_condition' AND name='Overall condition' AND (unit IS NULL OR unit='score')))"
}
fn date_group(g: DietTableGroup, c: &str) -> (String, String) {
    match g {
        DietTableGroup::None => ("''".into(), "''".into()),
        DietTableGroup::Month => month(c),
        DietTableGroup::Week => week(c),
        DietTableGroup::Day => (c.into(), c.into()),
        _ => ("''".into(), "''".into()),
    }
}
fn date_group_bowel(g: BowelTableGroup, c: &str) -> (String, String) {
    match g {
        BowelTableGroup::None => ("''".into(), "''".into()),
        BowelTableGroup::Month => month(c),
        BowelTableGroup::Week => week(c),
        BowelTableGroup::Day => (c.into(), c.into()),
        _ => ("''".into(), "''".into()),
    }
}
fn date_group_med(g: MedicationTableGroup, c: &str) -> (String, String) {
    match g {
        MedicationTableGroup::None => ("''".into(), "''".into()),
        MedicationTableGroup::Month => month(c),
        MedicationTableGroup::Week => week(c),
        MedicationTableGroup::Day => (c.into(), c.into()),
        _ => ("''".into(), "''".into()),
    }
}
fn week(c: &str) -> (String, String) {
    let k = format!("date({c},'-'||((CAST(strftime('%w',{c}) AS INTEGER)+6)%7)||' days')");
    (k.clone(), format!("'Week of '||{k}"))
}
fn month(c: &str) -> (String, String) {
    let key = format!("substr({c},1,7)");
    let label = format!(
        "CASE substr({c},6,2) WHEN '01' THEN 'January' WHEN '02' THEN 'February' WHEN '03' THEN 'March' WHEN '04' THEN 'April' WHEN '05' THEN 'May' WHEN '06' THEN 'June' WHEN '07' THEN 'July' WHEN '08' THEN 'August' WHEN '09' THEN 'September' WHEN '10' THEN 'October' WHEN '11' THEN 'November' ELSE 'December' END||' '||substr({c},1,4)"
    );
    (key, label)
}

fn relative_date(reference: Date, amount: u32, unit: RelativeDateUnit) -> Option<Date> {
    match unit {
        RelativeDateUnit::Day => reference.checked_add(Duration::days(i64::from(amount))),
        RelativeDateUnit::Week => {
            reference.checked_add(Duration::days(i64::from(amount).checked_mul(7)?))
        }
        RelativeDateUnit::Month => {
            let total = i64::from(reference.year())
                .checked_mul(12)?
                .checked_add(i64::from(u8::from(reference.month()) - 1))?
                .checked_add(i64::from(amount))?;
            let year = i32::try_from(total.div_euclid(12)).ok()?;
            let month = Month::try_from(u8::try_from(total.rem_euclid(12) + 1).ok()?).ok()?;
            Date::from_calendar_date(year, month, 1)
                .ok()?
                .checked_add(Duration::days(i64::from(reference.day() - 1)))
        }
    }
}

fn filters_sql(query: &HealthTableQuery, values: &mut Vec<Value>) -> String {
    if query.filters().is_empty() {
        return "1".into();
    }
    let glue = if query.filter_mode() == FilterMode::And {
        " AND "
    } else {
        " OR "
    };
    query
        .filters()
        .iter()
        .map(|f| format!("({})", one_filter(f, query.reference_date(), values)))
        .collect::<Vec<_>>()
        .join(glue)
}
fn one_filter(
    filter: &HealthTableFilter,
    reference: Option<Date>,
    values: &mut Vec<Value>,
) -> String {
    if let HealthTableFilter::Diet {
        field: DietTableFilterField::Tags,
        operator,
        value,
    } = filter
    {
        return tag_filter(*operator, value, values);
    }
    let (expr, op, val) = match filter {
        HealthTableFilter::Diet {
            field,
            operator,
            value,
        } => (
            match field {
                DietTableFilterField::Date => "local_date",
                DietTableFilterField::MealType => "meal_type",
                DietTableFilterField::Food => "food_name",
                DietTableFilterField::Tags => unreachable!("tag filters are handled above"),
                DietTableFilterField::HasPhoto => {
                    "CASE WHEN media_id IS NULL THEN 'without-photo' ELSE 'with-photo' END"
                }
            },
            *operator,
            value,
        ),
        HealthTableFilter::Bowel {
            field,
            operator,
            value,
        } => (
            match field {
                BowelTableFilterField::Date => "local_date",
                BowelTableFilterField::BristolScale => {
                    "CAST(json_extract(attributes_json,'$.bristol_scale') AS TEXT)"
                }
                BowelTableFilterField::BloodVisible => {
                    "CASE json_extract(attributes_json,'$.blood_visible') WHEN 1 THEN 'yes' ELSE 'no' END"
                }
            },
            *operator,
            value,
        ),
        HealthTableFilter::Medication {
            field,
            operator,
            value,
        } => (
            match field {
                MedicationTableFilterField::Date => "local_date",
                MedicationTableFilterField::MedicationName => {
                    "json_extract(attributes_json,'$.medication_name')"
                }
                MedicationTableFilterField::MedicationUnit => {
                    "json_extract(attributes_json,'$.unit')"
                }
            },
            *operator,
            value,
        ),
        HealthTableFilter::Metrics {
            field,
            operator,
            value,
        } => (
            match field {
                MetricsTableFilterField::Date => "local_date",
                MetricsTableFilterField::Weight => "weight",
                MetricsTableFilterField::Sleep => "sleep",
                MetricsTableFilterField::Crp => "crp",
                MetricsTableFilterField::Calprotectin => "calprotectin",
                MetricsTableFilterField::Condition => "condition",
            },
            *operator,
            value,
        ),
    };
    scalar(expr, op, val, reference, values)
}
fn tag_filter(
    operator: HealthFilterOperator,
    value: &HealthTableFilterValue,
    values: &mut Vec<Value>,
) -> String {
    use HealthFilterOperator as O;
    let exists = "EXISTS (SELECT 1 FROM diet_entry_tags links JOIN diet_tags tags ON tags.id=links.tag_id WHERE links.diet_entry_id=base.id";
    match operator {
        O::IsEmpty => format!("NOT {exists})"),
        O::IsNotEmpty => format!("{exists})"),
        O::Is | O::Contains | O::IsNot | O::DoesNotContain => {
            let HealthTableFilterValue::TextList(tags) = value else {
                unreachable!()
            };
            values.extend(tags.iter().cloned().map(Value::Text));
            let predicate = format!(
                "{exists} AND tags.name IN ({}))",
                vec!["?"; tags.len()].join(",")
            );
            if matches!(operator, O::IsNot | O::DoesNotContain) {
                format!("NOT {predicate}")
            } else {
                predicate
            }
        }
        _ => unreachable!("validated tag filter operator"),
    }
}
fn scalar(
    expr: &str,
    op: HealthFilterOperator,
    val: &HealthTableFilterValue,
    reference: Option<Date>,
    values: &mut Vec<Value>,
) -> String {
    use HealthFilterOperator as O;
    match op {
        O::IsEmpty => format!("{expr} IS NULL OR COALESCE({expr},'')=''"),
        O::IsNotEmpty => format!("{expr} IS NOT NULL AND COALESCE({expr},'')<>''"),
        O::Contains | O::DoesNotContain if matches!(val, HealthTableFilterValue::Text(_)) => {
            let HealthTableFilterValue::Text(v) = val else {
                unreachable!()
            };
            values.push(Value::Text(v.clone()));
            format!(
                "{}instr(LOWER(COALESCE({expr},'')),LOWER(?))>0",
                if op == O::DoesNotContain { "NOT " } else { "" }
            )
        }
        O::StartsWith | O::EndsWith => {
            let HealthTableFilterValue::Text(v) = val else {
                unreachable!()
            };
            values.push(Value::Text(v.clone()));
            values.push(Value::Text(v.clone()));
            if op == O::StartsWith {
                format!("LOWER(substr(COALESCE({expr},''),1,length(?)))=LOWER(?)")
            } else {
                format!("LOWER(substr(COALESCE({expr},''),-length(?)))=LOWER(?)")
            }
        }
        O::IsBetween => {
            let HealthTableFilterValue::Range { start, end } = val else {
                unreachable!()
            };
            values.push(Value::Text(start.clone()));
            values.push(Value::Text(end.clone()));
            format!("{expr} BETWEEN ? AND ?")
        }
        O::IsRelativeToToday => {
            let HealthTableFilterValue::Relative { amount, unit } = val else {
                unreachable!()
            };
            let target = relative_date(reference.unwrap(), amount.parse().unwrap(), *unit)
                .map_or("__out_of_range__".into(), |d| d.to_string());
            values.push(Value::Text(target));
            format!("{expr}=?")
        }
        _ if matches!(val, HealthTableFilterValue::TextList(_)) => {
            let HealthTableFilterValue::TextList(xs) = val else {
                unreachable!()
            };
            let clauses = xs
                .iter()
                .map(|x| {
                    values.push(Value::Text(x.to_lowercase()));
                    if expr == "tags_text" {
                        "instr(char(31)||LOWER(tags_text)||char(31),char(31)||?||char(31))>0"
                    } else {
                        "LOWER(COALESCE("
                    }
                })
                .collect::<Vec<_>>();
            if expr == "tags_text" {
                let joined = clauses.join(" OR ");
                if matches!(op, O::IsNot | O::DoesNotContain) {
                    format!("NOT ({joined})")
                } else {
                    format!("({joined})")
                }
            } else {
                let placeholders = vec!["?"; xs.len()].join(",");
                format!(
                    "LOWER(COALESCE({expr},'')) {}IN ({placeholders})",
                    if matches!(op, O::IsNot | O::DoesNotContain) {
                        "NOT "
                    } else {
                        ""
                    }
                )
            }
        }
        _ => {
            let HealthTableFilterValue::Text(v) = val else {
                unreachable!()
            };
            let numeric = matches!(
                expr,
                "weight" | "sleep" | "crp" | "calprotectin" | "condition"
            );
            if numeric {
                values.push(Value::Real(v.parse().expect("validated numeric filter")));
            } else {
                values.push(Value::Text(v.clone()));
            }
            let cmp = match op {
                O::Is => "=",
                O::IsNot => "<>",
                O::IsBefore | O::LessThan => "<",
                O::IsAfter | O::GreaterThan => ">",
                O::IsOnOrBefore => "<=",
                O::IsOnOrAfter => ">=",
                _ => unreachable!(),
            };
            if numeric && op == O::IsNot {
                format!("{expr} IS NULL OR {expr} <> ?")
            } else if numeric || expr == "local_date" {
                format!("{expr} {cmp} ?")
            } else {
                format!("LOWER(COALESCE({expr},'')) {cmp} LOWER(?)")
            }
        }
    }
}

fn hidden_sql(query: &HealthTableQuery, values: &mut Vec<Value>) -> String {
    let mut clauses = Vec::new();
    let hidden = query.group_settings().hidden_group_keys();
    if !hidden.is_empty() {
        values.extend(hidden.iter().cloned().map(Value::Text));
        clauses.push(format!(
            "group_key NOT IN ({})",
            vec!["?"; hidden.len()].join(",")
        ));
    }
    if clauses.is_empty() {
        String::new()
    } else {
        format!(" AND {}", clauses.join(" AND "))
    }
}
fn group_order(query: &HealthTableQuery, values: &mut Vec<Value>) -> String {
    match query.group_settings().sort() {
        GroupSort::Alphabetical => "LOWER(group_label) ASC,group_key ASC,".into(),
        GroupSort::ReverseAlphabetical => "LOWER(group_label) DESC,group_key DESC,".into(),
        GroupSort::Manual => {
            let order = query.group_settings().manual_order();
            if order.is_empty() {
                "group_rank ASC,".into()
            } else {
                let mut s = "CASE group_key".to_string();
                for (i, k) in order.iter().enumerate() {
                    values.push(Value::Text(k.clone()));
                    s.push_str(&format!(" WHEN ? THEN {i}"));
                }
                s.push_str(&format!(" ELSE {}+group_rank END,", order.len()));
                s
            }
        }
    }
}
fn row_order(query: &HealthTableQuery) -> String {
    if query.sorts().is_empty() {
        return match query.scope() {
            HealthTableScope::Metrics => "local_date DESC".into(),
            HealthTableScope::Diet | HealthTableScope::Bowel | HealthTableScope::Medication => {
                "occurred_at DESC".into()
            }
        };
    }
    query
        .sorts()
        .iter()
        .map(|s| {
            let e = match s {
                HealthTableSort::Diet { field, .. } => match field {
                    DietTableSortField::Date => "occurred_at",
                    DietTableSortField::MealType => "meal_type",
                    DietTableSortField::Food => "food_name",
                    DietTableSortField::Created => "created_at",
                    DietTableSortField::Updated => "updated_at",
                },
                HealthTableSort::Bowel { field, .. } => match field {
                    BowelTableSortField::Date => "occurred_at",
                    BowelTableSortField::BristolScale => {
                        "json_extract(attributes_json,'$.bristol_scale')"
                    }
                    BowelTableSortField::Created => "created_at",
                    BowelTableSortField::Updated => "updated_at",
                },
                HealthTableSort::Medication { field, .. } => match field {
                    MedicationTableSortField::Date => "occurred_at",
                    MedicationTableSortField::MedicationName => {
                        "json_extract(attributes_json,'$.medication_name')"
                    }
                    MedicationTableSortField::Dose => "json_extract(attributes_json,'$.dose')",
                    MedicationTableSortField::Created => "created_at",
                    MedicationTableSortField::Updated => "updated_at",
                },
                HealthTableSort::Metrics { field, .. } => match field {
                    MetricsTableSortField::Date => "local_date",
                    MetricsTableSortField::Weight => "weight",
                    MetricsTableSortField::Sleep => "sleep",
                    MetricsTableSortField::Crp => "crp",
                    MetricsTableSortField::Calprotectin => "calprotectin",
                    MetricsTableSortField::Condition => "condition",
                },
            };
            let direction = if s.direction() == SortDirection::Asc {
                "ASC"
            } else {
                "DESC"
            };
            if matches!(
                s,
                HealthTableSort::Metrics {
                    field: MetricsTableSortField::Weight
                        | MetricsTableSortField::Sleep
                        | MetricsTableSortField::Crp
                        | MetricsTableSortField::Calprotectin
                        | MetricsTableSortField::Condition,
                    ..
                }
            ) {
                format!("{e} IS NULL ASC,{e} {direction}")
            } else {
                format!("{e} {direction}")
            }
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn load_records(
    connection: &Connection,
    scope: HealthTableScope,
    keys: &[PageKey],
) -> HealthResult<HashMap<String, HealthTableRecord>> {
    match scope {
        HealthTableScope::Diet => load_diet(connection, keys),
        HealthTableScope::Bowel | HealthTableScope::Medication => {
            load_events(connection, scope, keys)
        }
        HealthTableScope::Metrics => load_metrics(connection, keys),
    }
}
fn load_diet(
    connection: &Connection,
    keys: &[PageKey],
) -> HealthResult<HashMap<String, HealthTableRecord>> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }
    let ids: Vec<_> = keys.iter().map(|k| k.id.clone()).collect();
    let mut tags: HashMap<String, Vec<String>> = HashMap::new();
    let sql = format!(
        "SELECT l.diet_entry_id,t.name FROM diet_entry_tags l JOIN diet_tags t ON t.id=l.tag_id WHERE l.diet_entry_id IN ({}) ORDER BY t.name",
        vec!["?"; ids.len()].join(",")
    );
    for item in connection
        .prepare(&sql)
        .map_err(storage_error)?
        .query_map(params_from_iter(ids.iter()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(storage_error)?
    {
        let (id, tag) = item.map_err(storage_error)?;
        tags.entry(id).or_default().push(tag)
    }
    let sql = format!(
        "SELECT {DIET_COLUMNS} FROM diet_entries WHERE id IN ({})",
        vec!["?"; ids.len()].join(",")
    );
    let mut stmt = connection.prepare(&sql).map_err(storage_error)?;
    let mut rows = stmt
        .query(params_from_iter(ids.iter()))
        .map_err(storage_error)?;
    let mut out = HashMap::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        let id: String = row.get(0).map_err(storage_error)?;
        let date: String = row.get(2).map_err(storage_error)?;
        let entry = row_to_diet(row, tags.remove(&id).unwrap_or_default())?;
        let meal = match entry.meal_type() {
            MealType::LateNight => "Late night".into(),
            other => {
                let s = other.to_string();
                format!("{}{}", s[..1].to_uppercase(), &s[1..])
            }
        };
        out.insert(
            id.clone(),
            HealthTableRecord::Diet(DietTableRecord {
                id,
                has_photo: entry.media_id().is_some(),
                food: entry.food_name().to_string(),
                tags: entry.tags().to_vec(),
                note: entry.note().unwrap_or_default().to_string(),
                entry,
                date,
                meal_label: meal,
            }),
        );
    }
    Ok(out)
}
fn load_events(
    connection: &Connection,
    scope: HealthTableScope,
    keys: &[PageKey],
) -> HealthResult<HashMap<String, HealthTableRecord>> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }
    let ids: Vec<_> = keys.iter().map(|k| k.id.clone()).collect();
    let sql = format!(
        "SELECT {EVENT_COLUMNS} FROM health_events WHERE id IN ({})",
        vec!["?"; ids.len()].join(",")
    );
    let mut stmt = connection.prepare(&sql).map_err(storage_error)?;
    let mut rows = stmt
        .query(params_from_iter(ids.iter()))
        .map_err(storage_error)?;
    let mut out = HashMap::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        let date: String = row.get(2).map_err(storage_error)?;
        let event = row_to_event(row)?;
        let id = event.id().as_str().to_string();
        let record = match (
            scope,
            event
                .details()
                .map_err(|e| HealthError::Storage(e.to_string()))?,
        ) {
            (HealthTableScope::Bowel, HealthEventDetails::Bowel(a)) => {
                HealthTableRecord::Bowel(BowelTableRecord {
                    id: id.clone(),
                    bristol_scale: a.bristol_scale(),
                    blood_visible: a.blood_visible(),
                    blood_label: if a.blood_visible() {
                        "Yes".into()
                    } else {
                        "No".into()
                    },
                    note: event.note().unwrap_or_default().to_string(),
                    event,
                    date,
                })
            }
            (HealthTableScope::Medication, HealthEventDetails::Medication(a)) => {
                let unit = a.unit().to_string();
                HealthTableRecord::Medication(MedicationTableRecord {
                    id: id.clone(),
                    medication_name: a.medication_name().into(),
                    dose: a.dose(),
                    unit_label: medication_unit_label(a.unit()).to_string(),
                    unit,
                    note: event.note().unwrap_or_default().to_string(),
                    event,
                    date,
                })
            }
            _ => {
                return Err(HealthError::Storage(
                    "health table event category mismatch".into(),
                ));
            }
        };
        out.insert(id, record);
    }
    Ok(out)
}
fn medication_unit_label(unit: MedicationUnit) -> &'static str {
    match unit {
        MedicationUnit::Tablet => "정",
        MedicationUnit::Capsule => "캡슐",
        MedicationUnit::Packet => "포",
        MedicationUnit::Mg => "mg",
        MedicationUnit::G => "g",
        MedicationUnit::Ml => "ml",
        MedicationUnit::Drop => "방울",
        MedicationUnit::Dose => "회",
    }
}
fn load_metrics(
    connection: &Connection,
    keys: &[PageKey],
) -> HealthResult<HashMap<String, HealthTableRecord>> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }
    let dates: Vec<_> = keys.iter().map(|k| k.id.clone()).collect();
    let sql = format!(
        "SELECT {EVENT_COLUMNS} FROM health_events WHERE deleted_at IS NULL AND daily_upsert=1 AND {} AND local_date IN ({}) ORDER BY local_date,id",
        metric_identity_sql(),
        vec!["?"; dates.len()].join(",")
    );
    let mut stmt = connection.prepare(&sql).map_err(storage_error)?;
    let mut rows = stmt
        .query(params_from_iter(dates.iter()))
        .map_err(storage_error)?;
    let mut grouped: HashMap<String, Vec<_>> = HashMap::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        let local_date: String = row.get(2).map_err(storage_error)?;
        let event = row_to_event(row)?;
        grouped.entry(local_date).or_default().push(event)
    }
    let mut out = HashMap::new();
    for date in dates {
        let events = grouped.remove(&date).unwrap_or_default();
        let mut record = HealthMetricsTableRecord {
            id: date.clone(),
            date: date.clone(),
            events,
            weight: None,
            sleep: None,
            crp: None,
            calprotectin: None,
            condition: None,
            note: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
        };
        for e in &record.events {
            let v = e.value_num();
            match (e.category(), e.metric_key().as_str()) {
                (HealthCategory::Weight, "body_weight") => record.weight = v,
                (HealthCategory::Sleep, "sleep_duration") => record.sleep = v,
                (HealthCategory::Lab, "crp") => record.crp = v,
                (HealthCategory::Lab, "fecal_calprotectin") => record.calprotectin = v,
                (HealthCategory::Symptom, "overall_condition") => {
                    record.condition = v;
                    record.note = e
                        .attributes()
                        .get("condition_note")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .into()
                }
                _ => {}
            }
            let c = crate::application::table::rfc3339(e.created_at());
            let u = crate::application::table::rfc3339(e.updated_at());
            if record.created_at.is_empty() || c < record.created_at {
                record.created_at = c
            }
            if u > record.updated_at {
                record.updated_at = u
            }
        }
        out.insert(date, HealthTableRecord::Metrics(record));
    }
    Ok(out)
}
