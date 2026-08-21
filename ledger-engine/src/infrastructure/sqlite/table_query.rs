use std::collections::HashMap;

use rusqlite::{Connection, params_from_iter, types::Value};
use time::{Date, Duration, Month};

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::queries::EntryView;
use crate::application::table::{
    AccountTableFilterField, AccountTableGroup, AccountTableRecord, AccountTableSortField,
    CategoryTableFilterField, CategoryTableGroup, CategoryTableRecord, CategoryTableSortField,
    FilterMode, GroupSort, LedgerFilterOperator, LedgerTableFilter, LedgerTableFilterValue,
    LedgerTableGroup, LedgerTableQuery, LedgerTableRecord, LedgerTableRow, LedgerTableScope,
    LedgerTableSort, RelativeDateUnit, SortDirection, TablePage, TransactionRowKind,
    TransactionTableFilterField, TransactionTableGroup, TransactionTableRecord,
    TransactionTableSortField,
};
use crate::domain::{EntryType, TransactionCategoryKind};

use super::mapping::{ENTRY_COLUMNS, row_to_account, row_to_entry, row_to_transaction_category};
use super::storage_error;

#[derive(Debug)]
struct PageKey {
    id: String,
    pair_id: Option<String>,
    group_key: String,
    group_label: String,
}

pub(super) fn query_table(
    connection: &Connection,
    query: &LedgerTableQuery,
) -> LedgerResult<TablePage<LedgerTableRow>> {
    let (sql, values) = page_sql(query);
    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    let mut keys = statement
        .query_map(params_from_iter(values), |row| {
            Ok(PageKey {
                id: row.get(0)?,
                pair_id: row.get(1)?,
                group_key: row.get(2)?,
                group_label: row.get(3)?,
            })
        })
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;

    debug_assert!(keys.len() <= usize::from(query.limit()) + 1);
    let has_more = keys.len() > usize::from(query.limit());
    keys.truncate(usize::from(query.limit()));
    let records = load_records(connection, query.scope(), &keys)?;
    let mut rows = Vec::with_capacity(keys.len());
    for key in keys {
        let record = records.get(&key.id).cloned().ok_or_else(|| {
            LedgerError::Storage("selected ledger table record disappeared".into())
        })?;
        rows.push(LedgerTableRow::new(
            (!key.group_key.is_empty()).then_some(key.group_key),
            (!key.group_label.is_empty()).then_some(key.group_label),
            record,
        )?);
    }
    let next_offset = if has_more {
        Some(
            query
                .offset()
                .checked_add(u32::from(query.limit()))
                .ok_or_else(|| LedgerError::Validation {
                    field: "page",
                    message: "page offset exceeds the supported range".into(),
                })?,
        )
    } else {
        None
    };
    Ok(TablePage {
        items: rows,
        next_offset,
    })
}

fn page_sql(query: &LedgerTableQuery) -> (String, Vec<Value>) {
    let mut values = Vec::new();
    let (base, group_key, group_label) = match query.scope() {
        LedgerTableScope::Transactions => transaction_base(query.group_settings().group_by()),
        LedgerTableScope::Accounts => account_base(query.group_settings().group_by()),
        LedgerTableScope::Categories => category_base(query.group_settings().group_by()),
    };
    let filters = filter_sql(query, &mut values);
    let hidden = hidden_sql(query, &mut values);
    let group_order = group_order_sql(query, &mut values);
    let record_order = record_order_sql(query);
    values.push(Value::Integer(i64::from(query.limit()) + 1));
    values.push(Value::Integer(i64::from(query.offset())));
    let occurrences = occurrence_sql(query, &group_key, &group_label);
    let sql = format!(
        "WITH base AS ({base}), filtered AS (
            SELECT * FROM base WHERE {filters}
        ), occurrences AS ({occurrences})
        SELECT id, pair_id, group_key, group_label FROM occurrences
        WHERE 1{hidden}
        ORDER BY {group_order}{record_order}, logical_id ASC, group_key ASC, id ASC
        LIMIT ? OFFSET ?"
    );
    (sql, values)
}

fn occurrence_sql(query: &LedgerTableQuery, group_key: &str, group_label: &str) -> String {
    let first = format!(
        "SELECT id, pair_id, {group_key} AS group_key, {group_label} AS group_label, filtered.* FROM filtered"
    );
    if matches!(
        query.group_settings().group_by(),
        LedgerTableGroup::Transactions(TransactionTableGroup::Account)
    ) {
        format!(
            "{first} UNION ALL SELECT id, pair_id, pair_account_id AS group_key,
             COALESCE(pair_account_name,'') AS group_label, filtered.*
             FROM filtered WHERE pair_account_id IS NOT NULL"
        )
    } else {
        first
    }
}

fn transaction_base(group: LedgerTableGroup) -> (String, String, String) {
    let base = "SELECT
        COALESCE(d.transfer_group_id, d.id) AS logical_id,
        d.id AS id,
        p.id AS pair_id,
        d.date, d.content,
        CASE WHEN d.entry_type IN ('expense','adjustment_out') THEN 'expense'
             WHEN d.entry_type IN ('income','adjustment_in') THEN 'income' ELSE 'transfer' END AS kind,
        d.account_id, da.name AS account_name,
        p.account_id AS pair_account_id, pa.name AS pair_account_name,
        COALESCE(da.name,'') || CASE WHEN p.id IS NULL THEN '' ELSE ' -> ' || COALESCE(pa.name,'') END AS account_sort_name,
        d.transaction_category_id AS category_id, COALESCE(tc.name,'') AS category_name,
        d.currency_id, COALESCE(c.code,'') AS currency_code, c.decimal_places,
        d.amount_minor, ledger_money_key(d.amount_minor,c.decimal_places) AS amount_sort_key, d.updated_at
      FROM ledger_entries d
      LEFT JOIN ledger_entries p ON p.id=(
          SELECT p2.id FROM ledger_entries p2
          WHERE p2.deleted_at IS NULL AND p2.transfer_group_id=d.transfer_group_id
            AND p2.id<>d.id AND p2.entry_type<>d.entry_type ORDER BY p2.id LIMIT 1)
      LEFT JOIN accounts da ON da.id=d.account_id
      LEFT JOIN accounts pa ON pa.id=p.account_id
      LEFT JOIN transaction_categories tc ON tc.id=d.transaction_category_id
      LEFT JOIN currencies c ON c.id=d.currency_id
      WHERE d.deleted_at IS NULL AND (
          d.entry_type NOT IN ('transfer_in','transfer_out')
          OR d.entry_type='transfer_out'
          OR (d.entry_type='transfer_in' AND NOT EXISTS (
              SELECT 1 FROM ledger_entries o WHERE o.deleted_at IS NULL
                AND o.transfer_group_id=d.transfer_group_id AND o.entry_type='transfer_out'))
      )";
    let (key, label) = match group {
        LedgerTableGroup::Transactions(TransactionTableGroup::None) => ("''", "''"),
        LedgerTableGroup::Transactions(TransactionTableGroup::Month) => {
            ("substr(date,1,7)", "substr(date,1,7)")
        }
        LedgerTableGroup::Transactions(TransactionTableGroup::Week) => (
            "date(date, '-' || ((CAST(strftime('%w',date) AS INTEGER)+6)%7) || ' days')",
            "'Week of ' || date(date, '-' || ((CAST(strftime('%w',date) AS INTEGER)+6)%7) || ' days')",
        ),
        LedgerTableGroup::Transactions(TransactionTableGroup::Day) => ("date", "date"),
        LedgerTableGroup::Transactions(TransactionTableGroup::Account) => {
            ("account_id", "COALESCE(account_name,'')")
        }
        LedgerTableGroup::Transactions(TransactionTableGroup::Category) => (
            "COALESCE(category_id,'uncategorized')",
            "CASE WHEN category_id IS NULL THEN 'Uncategorized' ELSE category_name END",
        ),
        LedgerTableGroup::Transactions(TransactionTableGroup::EntryType) => ("kind", "kind"),
        _ => unreachable!("validated transaction group"),
    };
    (base.into(), key.into(), label.into())
}

fn account_base(group: LedgerTableGroup) -> (String, String, String) {
    let base = "SELECT a.id AS logical_id, a.id, NULL AS pair_id, a.name, a.account_category_id AS account_type_id,
        ac.name AS account_type_name, a.currency_id, c.code AS currency_code,
        a.opening_balance_minor + COALESCE(SUM(CASE e.entry_type
          WHEN 'expense' THEN -e.amount_minor WHEN 'income' THEN e.amount_minor
          WHEN 'transfer_out' THEN -e.amount_minor WHEN 'transfer_in' THEN e.amount_minor
          WHEN 'adjustment_out' THEN -e.amount_minor WHEN 'adjustment_in' THEN e.amount_minor
          ELSE 0 END),0) AS current_balance_minor,
        ledger_money_key(a.opening_balance_minor + COALESCE(SUM(CASE e.entry_type
          WHEN 'expense' THEN -e.amount_minor WHEN 'income' THEN e.amount_minor
          WHEN 'transfer_out' THEN -e.amount_minor WHEN 'transfer_in' THEN e.amount_minor
          WHEN 'adjustment_out' THEN -e.amount_minor WHEN 'adjustment_in' THEN e.amount_minor
          ELSE 0 END),0),c.decimal_places) AS current_balance_sort_key
      FROM accounts a JOIN account_categories ac ON ac.id=a.account_category_id
      JOIN currencies c ON c.id=a.currency_id
      LEFT JOIN ledger_entries e ON e.account_id=a.id AND e.deleted_at IS NULL
      WHERE a.active=1 AND a.deleted_at IS NULL GROUP BY a.id";
    let (key, label) = match group {
        LedgerTableGroup::Accounts(AccountTableGroup::None) => ("''", "''"),
        LedgerTableGroup::Accounts(AccountTableGroup::AccountType) => {
            ("account_type_id", "account_type_name")
        }
        LedgerTableGroup::Accounts(AccountTableGroup::Currency) => ("currency_id", "currency_code"),
        _ => unreachable!("validated account group"),
    };
    (base.into(), key.into(), label.into())
}

fn category_base(group: LedgerTableGroup) -> (String, String, String) {
    let base = "SELECT tc.id AS logical_id, tc.id, NULL AS pair_id, tc.name, tc.kind,
        COALESCE(tc.parent_id,'') AS parent_id, COALESCE(parent.name,'') AS parent_name
      FROM transaction_categories tc
      LEFT JOIN transaction_categories parent ON parent.id=tc.parent_id
      WHERE tc.active=1 AND tc.deleted_at IS NULL";
    let (key, label) = match group {
        LedgerTableGroup::Categories(CategoryTableGroup::None) => ("''", "''"),
        LedgerTableGroup::Categories(CategoryTableGroup::Kind) => (
            "kind",
            "CASE kind WHEN 'expense' THEN 'Expense' ELSE 'Income' END",
        ),
        LedgerTableGroup::Categories(CategoryTableGroup::Parent) => (
            "CASE WHEN parent_id='' THEN 'none' ELSE parent_id END",
            "CASE WHEN parent_id='' THEN 'No parent' ELSE parent_name END",
        ),
        _ => unreachable!("validated category group"),
    };
    (base.into(), key.into(), label.into())
}

fn filter_sql(query: &LedgerTableQuery, values: &mut Vec<Value>) -> String {
    if query.filters().is_empty() {
        return "1".into();
    }
    let joiner = match query.filter_mode() {
        FilterMode::And => " AND ",
        FilterMode::Or => " OR ",
    };
    query
        .filters()
        .iter()
        .map(|filter| {
            format!(
                "({})",
                one_filter_sql(filter, query.reference_date(), values)
            )
        })
        .collect::<Vec<_>>()
        .join(joiner)
}

fn one_filter_sql(
    filter: &LedgerTableFilter,
    reference_date: Option<Date>,
    values: &mut Vec<Value>,
) -> String {
    let (expressions, operator, value) = match filter {
        LedgerTableFilter::Transactions {
            field,
            operator,
            value,
        } => {
            let expressions: &[&str] = match field {
                TransactionTableFilterField::Date => &["date"],
                TransactionTableFilterField::Content => &["content"],
                TransactionTableFilterField::EntryType => &["kind"],
                TransactionTableFilterField::Account => &[
                    "account_id",
                    "account_name",
                    "pair_account_id",
                    "pair_account_name",
                ],
                TransactionTableFilterField::Category => &["category_id", "category_name"],
                TransactionTableFilterField::Currency => &["currency_id", "currency_code"],
                TransactionTableFilterField::Amount => &["amount_sort_key"],
            };
            (expressions, *operator, value)
        }
        LedgerTableFilter::Accounts {
            field,
            operator,
            value,
        } => {
            let expressions: &[&str] = match field {
                AccountTableFilterField::Name => &["name"],
                AccountTableFilterField::AccountType => &["account_type_id", "account_type_name"],
                AccountTableFilterField::Currency => &["currency_id", "currency_code"],
                AccountTableFilterField::CurrentBalance => &["current_balance_sort_key"],
            };
            (expressions, *operator, value)
        }
        LedgerTableFilter::Categories {
            field,
            operator,
            value,
        } => {
            let expressions: &[&str] = match field {
                CategoryTableFilterField::Name => &["name"],
                CategoryTableFilterField::Kind => &["kind"],
                CategoryTableFilterField::Parent => &["parent_id", "parent_name"],
            };
            (expressions, *operator, value)
        }
    };
    let negative = matches!(
        operator,
        LedgerFilterOperator::IsNot | LedgerFilterOperator::DoesNotContain
    );
    let glue = if negative { " AND " } else { " OR " };
    expressions
        .iter()
        .map(|expression| scalar_filter_sql(expression, operator, value, reference_date, values))
        .collect::<Vec<_>>()
        .join(glue)
}

fn scalar_filter_sql(
    expression: &str,
    operator: LedgerFilterOperator,
    value: &LedgerTableFilterValue,
    reference_date: Option<Date>,
    values: &mut Vec<Value>,
) -> String {
    use LedgerFilterOperator as O;
    let numeric = matches!(expression, "amount_sort_key" | "current_balance_sort_key");
    match operator {
        O::IsEmpty => format!("COALESCE({expression},'')=''"),
        O::IsNotEmpty => format!("COALESCE({expression},'')<>''"),
        O::Contains | O::DoesNotContain if matches!(value, LedgerTableFilterValue::Text(_)) => {
            let LedgerTableFilterValue::Text(text) = value else {
                unreachable!()
            };
            values.push(Value::Text(text.clone()));
            let not = if operator == O::DoesNotContain {
                "NOT "
            } else {
                ""
            };
            format!("{not}ledger_content_contains(COALESCE({expression},''), ?)")
        }
        O::StartsWith | O::EndsWith => {
            let LedgerTableFilterValue::Text(text) = value else {
                unreachable!()
            };
            values.push(Value::Text(text.clone()));
            values.push(Value::Text(text.clone()));
            if operator == O::StartsWith {
                format!("LOWER(substr(COALESCE({expression},''),1,length(?)))=LOWER(?)")
            } else {
                format!("LOWER(substr(COALESCE({expression},''),-length(?)))=LOWER(?)")
            }
        }
        O::IsBetween => {
            let LedgerTableFilterValue::Range { start, end } = value else {
                unreachable!()
            };
            values.push(Value::Text(start.clone()));
            values.push(Value::Text(end.clone()));
            format!("{expression} BETWEEN ? AND ?")
        }
        O::IsRelativeToToday => {
            let LedgerTableFilterValue::Relative { amount, unit } = value else {
                unreachable!()
            };
            let amount = amount.parse::<u32>().expect("validated relative amount");
            let target = relative_target_date(
                reference_date.expect("relative date query was validated"),
                amount,
                *unit,
            )
            .map_or_else(|| "__out_of_range__".to_string(), |date| date.to_string());
            values.push(Value::Text(target));
            format!("{expression} = ?")
        }
        _ if matches!(value, LedgerTableFilterValue::TextList(_)) => {
            let LedgerTableFilterValue::TextList(items) = value else {
                unreachable!()
            };
            values.extend(items.iter().cloned().map(Value::Text));
            let placeholders = vec!["LOWER(?)"; items.len()].join(",");
            let not = if matches!(operator, O::IsNot | O::DoesNotContain) {
                " NOT"
            } else {
                ""
            };
            format!("LOWER(COALESCE({expression},'')){not} IN ({placeholders})")
        }
        _ => {
            let LedgerTableFilterValue::Text(text) = value else {
                unreachable!()
            };
            values.push(Value::Text(text.clone()));
            let comparison = match operator {
                O::Is => "=",
                O::IsNot => "<>",
                O::IsBefore | O::LessThan => "<",
                O::IsAfter | O::GreaterThan => ">",
                O::IsOnOrBefore => "<=",
                O::IsOnOrAfter => ">=",
                _ => unreachable!("validated operator"),
            };
            if numeric {
                format!("{expression} {comparison} ledger_number_key(?)")
            } else {
                format!("LOWER(COALESCE({expression},'')) {comparison} LOWER(?)")
            }
        }
    }
}

fn hidden_sql(query: &LedgerTableQuery, values: &mut Vec<Value>) -> String {
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

fn relative_target_date(reference: Date, amount: u32, unit: RelativeDateUnit) -> Option<Date> {
    match unit {
        RelativeDateUnit::Day => reference.checked_add(Duration::days(i64::from(amount))),
        RelativeDateUnit::Week => {
            reference.checked_add(Duration::days(i64::from(amount).checked_mul(7)?))
        }
        RelativeDateUnit::Month => {
            let month_zero = i64::from(u8::from(reference.month()) - 1);
            let total = i64::from(reference.year())
                .checked_mul(12)?
                .checked_add(month_zero)?
                .checked_add(i64::from(amount))?;
            let year = i32::try_from(total.div_euclid(12)).ok()?;
            let month = Month::try_from(u8::try_from(total.rem_euclid(12) + 1).ok()?).ok()?;
            Date::from_calendar_date(year, month, 1)
                .ok()?
                .checked_add(Duration::days(i64::from(reference.day() - 1)))
        }
    }
}

fn group_order_sql(query: &LedgerTableQuery, values: &mut Vec<Value>) -> String {
    match query.group_settings().sort() {
        GroupSort::Alphabetical => "group_label ASC, ".into(),
        GroupSort::ReverseAlphabetical => "group_label DESC, ".into(),
        GroupSort::Manual => {
            let manual = query.group_settings().manual_order();
            if manual.is_empty() {
                return "group_label ASC, ".into();
            }
            let mut sql = "CASE group_key ".to_string();
            for (index, key) in manual.iter().enumerate() {
                sql.push_str(&format!("WHEN ? THEN {index} "));
                values.push(Value::Text(key.clone()));
            }
            sql.push_str(&format!("ELSE {} END ASC, group_label ASC, ", manual.len()));
            sql
        }
    }
}

fn record_order_sql(query: &LedgerTableQuery) -> String {
    query
        .sorts()
        .iter()
        .map(|sort| {
            let (field, direction) = match sort {
                LedgerTableSort::Transactions { field, direction } => (
                    match field {
                        TransactionTableSortField::Date => "date",
                        TransactionTableSortField::Content => "content",
                        TransactionTableSortField::Account => "account_sort_name",
                        TransactionTableSortField::Category => "category_name",
                        TransactionTableSortField::Amount => "amount_sort_key",
                        TransactionTableSortField::Updated => "updated_at",
                    },
                    *direction,
                ),
                LedgerTableSort::Accounts { field, direction } => (
                    match field {
                        AccountTableSortField::Name => "name",
                        AccountTableSortField::AccountType => "account_type_name",
                        AccountTableSortField::Currency => "currency_code",
                        AccountTableSortField::CurrentBalance => "current_balance_sort_key",
                    },
                    *direction,
                ),
                LedgerTableSort::Categories { field, direction } => (
                    match field {
                        CategoryTableSortField::Name => "name",
                        CategoryTableSortField::Kind => "kind",
                        CategoryTableSortField::Parent => "parent_name",
                    },
                    *direction,
                ),
            };
            format!(
                "{field} {}",
                if direction == SortDirection::Asc {
                    "ASC"
                } else {
                    "DESC"
                }
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn load_records(
    connection: &Connection,
    scope: LedgerTableScope,
    keys: &[PageKey],
) -> LedgerResult<HashMap<String, LedgerTableRecord>> {
    match scope {
        LedgerTableScope::Transactions => load_transaction_records(connection, keys),
        LedgerTableScope::Accounts => load_account_records(connection, keys),
        LedgerTableScope::Categories => load_category_records(connection, keys),
    }
}

fn load_transaction_records(
    connection: &Connection,
    keys: &[PageKey],
) -> LedgerResult<HashMap<String, LedgerTableRecord>> {
    let mut ids = keys
        .iter()
        .flat_map(|key| std::iter::once(&key.id).chain(key.pair_id.iter()))
        .cloned()
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let sql = format!(
        "SELECT e.*, a.name, tc.name, c.code, c.decimal_places FROM (SELECT {ENTRY_COLUMNS} FROM ledger_entries WHERE id IN ({})) e
         LEFT JOIN accounts a ON a.id=e.account_id
         LEFT JOIN transaction_categories tc ON tc.id=e.transaction_category_id
         LEFT JOIN currencies c ON c.id=e.currency_id",
        vec!["?"; ids.len()].join(",")
    );
    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    let entries = statement
        .query_map(params_from_iter(ids.iter()), |row| {
            Ok((
                EntryView {
                    entry: row_to_entry(row).map_err(to_sql_error)?,
                    account_name: row.get(15)?,
                    category_name: row.get(16)?,
                    currency_code: row.get(17)?,
                },
                row.get::<_, u8>(18)?,
            ))
        })
        .map_err(storage_error)?
        .map(|entry| entry.map(|entry| (entry.0.id().to_string(), entry)))
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(storage_error)?;
    let mut records = HashMap::new();
    for key in keys {
        if records.contains_key(&key.id) {
            continue;
        }
        let (detail, decimal_places) = entries
            .get(&key.id)
            .cloned()
            .ok_or_else(|| LedgerError::Storage("selected ledger entry disappeared".into()))?;
        let transfer = key
            .pair_id
            .as_ref()
            .map(|id| {
                entries.get(id).map(|entry| entry.0.clone()).ok_or_else(|| {
                    LedgerError::Storage("selected transfer entry disappeared".into())
                })
            })
            .transpose()?;
        records.insert(
            key.id.clone(),
            transaction_record(detail, transfer, decimal_places),
        );
    }
    Ok(records)
}

fn transaction_record(
    detail: EntryView,
    transfer: Option<EntryView>,
    decimal_places: u8,
) -> LedgerTableRecord {
    let kind = match detail.entry_type() {
        EntryType::Expense | EntryType::AdjustmentOut => TransactionRowKind::Expense,
        EntryType::Income | EntryType::AdjustmentIn => TransactionRowKind::Income,
        EntryType::TransferIn | EntryType::TransferOut => TransactionRowKind::Transfer,
    };
    let mut account_ids = vec![detail.account_id().to_string()];
    let mut account_labels = vec![detail.account_name.clone().unwrap_or_default()];
    if let Some(other) = &transfer {
        account_ids.push(other.account_id().to_string());
        account_labels.push(other.account_name.clone().unwrap_or_default());
    }
    LedgerTableRecord::Transactions(Box::new(TransactionTableRecord {
        id: detail
            .transfer_group_id()
            .unwrap_or(detail.id())
            .to_string(),
        archive_entry_id: detail.id().to_string(),
        kind,
        date: detail.date().to_string(),
        content: detail.content().to_string(),
        account_label: account_labels.join(" -> "),
        account_ids,
        account_labels,
        category_id: detail.transaction_category_id().map(str::to_string),
        category_label: detail.category_name.clone().unwrap_or_default(),
        amount_minor: detail.amount().minor_units(),
        currency_id: detail.currency_id().to_string(),
        currency_code: detail.currency_code.clone().unwrap_or_default(),
        decimal_places,
        updated_at: detail.updated_at().to_string(),
        detail_entry: detail,
        transfer_entry: transfer,
    }))
}

fn load_account_records(
    connection: &Connection,
    keys: &[PageKey],
) -> LedgerResult<HashMap<String, LedgerTableRecord>> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }
    let sql = format!(
        "SELECT a.id,a.name,a.account_category_id,a.currency_id,a.opening_balance_minor,a.active,a.created_at,a.updated_at,a.deleted_at,ac.name,c.code,c.decimal_places,a.opening_balance_minor+COALESCE(SUM(CASE e.entry_type WHEN 'expense' THEN -e.amount_minor WHEN 'income' THEN e.amount_minor WHEN 'transfer_out' THEN -e.amount_minor WHEN 'transfer_in' THEN e.amount_minor WHEN 'adjustment_out' THEN -e.amount_minor WHEN 'adjustment_in' THEN e.amount_minor ELSE 0 END),0) FROM accounts a JOIN account_categories ac ON ac.id=a.account_category_id JOIN currencies c ON c.id=a.currency_id LEFT JOIN ledger_entries e ON e.account_id=a.id AND e.deleted_at IS NULL WHERE a.id IN ({}) GROUP BY a.id",
        vec!["?"; keys.len()].join(",")
    );
    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    statement
        .query_map(params_from_iter(keys.iter().map(|key| &key.id)), |row| {
            let account = row_to_account(row).map_err(to_sql_error)?;
            let id = account.id().to_string();
            Ok((
                id.clone(),
                LedgerTableRecord::Accounts(AccountTableRecord {
                    id,
                    name: account.name().to_string(),
                    account_type_id: account.category_id().to_string(),
                    account_type_label: row.get(9)?,
                    currency_id: account.currency_id().to_string(),
                    currency_code: row.get(10)?,
                    decimal_places: row.get(11)?,
                    current_balance_minor: row.get(12)?,
                    account,
                }),
            ))
        })
        .map_err(storage_error)?
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(storage_error)
}

fn load_category_records(
    connection: &Connection,
    keys: &[PageKey],
) -> LedgerResult<HashMap<String, LedgerTableRecord>> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }
    let sql = format!(
        "SELECT tc.id,tc.name,tc.parent_id,tc.kind,tc.active,tc.created_at,tc.updated_at,tc.deleted_at,parent.name FROM transaction_categories tc LEFT JOIN transaction_categories parent ON parent.id=tc.parent_id WHERE tc.id IN ({})",
        vec!["?"; keys.len()].join(",")
    );
    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    statement
        .query_map(params_from_iter(keys.iter().map(|key| &key.id)), |row| {
            let category = row_to_transaction_category(row).map_err(to_sql_error)?;
            let kind = category.kind();
            let id = category.id().to_string();
            Ok((
                id.clone(),
                LedgerTableRecord::Categories(CategoryTableRecord {
                    id,
                    name: category.name().to_string(),
                    kind,
                    kind_label: kind_label(kind).to_string(),
                    parent_id: category.parent_id().map(str::to_string),
                    parent_label: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                    category,
                }),
            ))
        })
        .map_err(storage_error)?
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(storage_error)
}

fn to_sql_error(error: LedgerError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

const fn kind_label(kind: TransactionCategoryKind) -> &'static str {
    match kind {
        TransactionCategoryKind::Expense => "Expense",
        TransactionCategoryKind::Income => "Income",
    }
}

#[cfg(test)]
mod tests {
    use time::{Date, Month};

    use super::{RelativeDateUnit, relative_target_date};

    #[test]
    fn relative_dates_select_one_future_target_and_match_calendar_rollover() {
        let reference = Date::from_calendar_date(2025, Month::January, 31).unwrap();
        assert_eq!(
            relative_target_date(reference, 1, RelativeDateUnit::Day),
            Some(Date::from_calendar_date(2025, Month::February, 1).unwrap())
        );
        assert_eq!(
            relative_target_date(reference, 1, RelativeDateUnit::Week),
            Some(Date::from_calendar_date(2025, Month::February, 7).unwrap())
        );
        assert_eq!(
            relative_target_date(reference, 1, RelativeDateUnit::Month),
            Some(Date::from_calendar_date(2025, Month::March, 3).unwrap())
        );
        assert_ne!(
            relative_target_date(reference, 1, RelativeDateUnit::Day),
            Some(reference)
        );
        assert_ne!(
            relative_target_date(reference, 1, RelativeDateUnit::Day),
            reference.previous_day()
        );
    }
}
