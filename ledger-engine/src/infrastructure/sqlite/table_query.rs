use std::cmp::Ordering;

use rusqlite::Connection;
use time::{Date, Duration, OffsetDateTime, macros::format_description};

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::queries::EntryView;
use crate::application::table::{
    AccountTableFilterField, AccountTableGroup, AccountTableRecord, AccountTableSortField,
    CategoryTableFilterField, CategoryTableGroup, CategoryTableRecord, CategoryTableSortField,
    FilterMode, GroupSort, LedgerFilterOperator, LedgerTableFilter, LedgerTableFilterValue,
    LedgerTableGroup, LedgerTableQuery, LedgerTableRecord, LedgerTableRow, LedgerTableScope,
    LedgerTableSort, SortDirection, TablePage, TransactionRowKind, TransactionTableFilterField,
    TransactionTableGroup, TransactionTableRecord, TransactionTableSortField,
};
use crate::domain::{EntryType, TransactionCategoryKind};

use super::mapping::{ENTRY_COLUMNS, row_to_account, row_to_entry, row_to_transaction_category};
use super::storage_error;

pub(super) fn query_table(
    connection: &Connection,
    query: &LedgerTableQuery,
) -> LedgerResult<TablePage<LedgerTableRow>> {
    let mut records = match query.scope() {
        LedgerTableScope::Transactions => transaction_records(connection)?,
        LedgerTableScope::Accounts => account_records(connection)?,
        LedgerTableScope::Categories => category_records(connection)?,
    };
    records.retain(|record| matches_filters(record, query));
    records.sort_by(|left, right| compare_records(left, right, query));

    let mut rows = Vec::new();
    for record in records {
        for (key, label) in groups(&record, query) {
            if has_group(query) && query.group_settings().hide_empty() && key.is_empty() {
                continue;
            }
            if query.group_settings().hidden_group_keys().contains(&key) {
                continue;
            }
            rows.push(LedgerTableRow::new(
                (!key.is_empty()).then_some(key),
                (!label.is_empty()).then_some(label),
                record.clone(),
            )?);
        }
    }
    rows.sort_by(|left, right| compare_groups(left, right, query));
    let start = usize::try_from(query.offset())
        .unwrap_or(usize::MAX)
        .min(rows.len());
    let take = usize::from(query.limit()) + 1;
    TablePage::from_limit_plus_one(
        rows.into_iter().skip(start).take(take).collect(),
        query.offset(),
        query.limit(),
    )
}

fn has_group(query: &LedgerTableQuery) -> bool {
    !matches!(
        query.group_settings().group_by(),
        LedgerTableGroup::Transactions(TransactionTableGroup::None)
            | LedgerTableGroup::Accounts(AccountTableGroup::None)
            | LedgerTableGroup::Categories(CategoryTableGroup::None)
    )
}

fn transaction_records(connection: &Connection) -> LedgerResult<Vec<LedgerTableRecord>> {
    let sql = format!(
        "SELECT e.*, a.name, tc.name, c.code FROM (SELECT {ENTRY_COLUMNS} FROM ledger_entries WHERE deleted_at IS NULL) e
         LEFT JOIN accounts a ON a.id=e.account_id
         LEFT JOIN transaction_categories tc ON tc.id=e.transaction_category_id
         LEFT JOIN currencies c ON c.id=e.currency_id ORDER BY e.id"
    );
    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    let mapped = statement
        .query_map([], |row| {
            let entry = row_to_entry(row).map_err(to_sql_error)?;
            Ok(EntryView {
                entry,
                account_name: row.get(15)?,
                category_name: row.get(16)?,
                currency_code: row.get(17)?,
            })
        })
        .map_err(storage_error)?;
    let entries = mapped
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    let mut records = Vec::new();
    let mut used = vec![false; entries.len()];
    for (index, entry) in entries.iter().enumerate() {
        if used[index] {
            continue;
        }
        used[index] = true;
        let pair_index = entry.transfer_group_id().and_then(|group| {
            entries.iter().enumerate().find_map(|(candidate, other)| {
                (!used[candidate]
                    && other.transfer_group_id() == Some(group)
                    && other.entry_type() != entry.entry_type())
                .then_some(candidate)
            })
        });
        let pair = pair_index.map(|pair_index| {
            used[pair_index] = true;
            entries[pair_index].clone()
        });
        let (detail, transfer, kind) = match (entry.entry_type(), pair) {
            (EntryType::TransferIn, Some(out)) => {
                (out, Some(entry.clone()), TransactionRowKind::Transfer)
            }
            (EntryType::TransferOut, Some(incoming)) => {
                (entry.clone(), Some(incoming), TransactionRowKind::Transfer)
            }
            (EntryType::Expense | EntryType::AdjustmentOut, _) => {
                (entry.clone(), None, TransactionRowKind::Expense)
            }
            (EntryType::Income | EntryType::AdjustmentIn, _) => {
                (entry.clone(), None, TransactionRowKind::Income)
            }
            (EntryType::TransferIn | EntryType::TransferOut, None) => {
                (entry.clone(), None, TransactionRowKind::Transfer)
            }
        };
        let id = detail
            .transfer_group_id()
            .unwrap_or(detail.id())
            .to_string();
        let mut account_ids = vec![detail.account_id().to_string()];
        let mut account_labels = vec![detail.account_name.clone().unwrap_or_default()];
        if let Some(other) = transfer.as_ref() {
            account_ids.push(other.account_id().to_string());
            account_labels.push(other.account_name.clone().unwrap_or_default());
        }
        let account_label = account_labels.join(" -> ");
        records.push(LedgerTableRecord::Transactions(Box::new(
            TransactionTableRecord {
                id,
                archive_entry_id: detail.id().to_string(),
                kind,
                date: detail.date().to_string(),
                content: detail.content().to_string(),
                account_ids,
                account_labels,
                account_label,
                category_id: detail.transaction_category_id().map(str::to_string),
                category_label: detail.category_name.clone().unwrap_or_default(),
                amount_minor: detail.amount().minor_units(),
                currency_id: detail.currency_id().to_string(),
                currency_code: detail.currency_code.clone().unwrap_or_default(),
                updated_at: detail.updated_at().to_string(),
                detail_entry: detail,
                transfer_entry: transfer,
            },
        )));
    }
    Ok(records)
}

fn account_records(connection: &Connection) -> LedgerResult<Vec<LedgerTableRecord>> {
    let sql = "SELECT a.id, a.name, a.account_category_id, a.currency_id, a.opening_balance_minor, a.active, a.created_at, a.updated_at, a.deleted_at, ac.name, c.code, c.decimal_places,
         COALESCE(SUM(CASE e.entry_type WHEN 'expense' THEN -e.amount_minor WHEN 'income' THEN e.amount_minor WHEN 'transfer_out' THEN -e.amount_minor WHEN 'transfer_in' THEN e.amount_minor WHEN 'adjustment_out' THEN -e.amount_minor WHEN 'adjustment_in' THEN e.amount_minor ELSE 0 END),0)
         FROM accounts a JOIN account_categories ac ON ac.id=a.account_category_id JOIN currencies c ON c.id=a.currency_id
         LEFT JOIN ledger_entries e ON e.account_id=a.id AND e.deleted_at IS NULL
         WHERE a.active=1 AND a.deleted_at IS NULL GROUP BY a.id ORDER BY a.id";
    let mut statement = connection.prepare(sql).map_err(storage_error)?;
    let rows = statement
        .query_map([], |row| {
            let account = row_to_account(row).map_err(to_sql_error)?;
            let opening = account.opening_balance().minor_units();
            Ok(LedgerTableRecord::Accounts(AccountTableRecord {
                id: account.id().to_string(),
                name: account.name().to_string(),
                account_type_id: account.category_id().to_string(),
                account_type_label: row.get(9)?,
                currency_id: account.currency_id().to_string(),
                currency_code: row.get(10)?,
                decimal_places: row.get(11)?,
                current_balance_minor: opening + row.get::<_, i64>(12)?,
                account,
            }))
        })
        .map_err(storage_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
}

fn category_records(connection: &Connection) -> LedgerResult<Vec<LedgerTableRecord>> {
    let sql = "SELECT tc.id, tc.name, tc.parent_id, tc.kind, tc.active, tc.created_at, tc.updated_at, tc.deleted_at, parent.name FROM transaction_categories tc
         LEFT JOIN transaction_categories parent ON parent.id=tc.parent_id
         WHERE tc.active=1 AND tc.deleted_at IS NULL ORDER BY tc.id";
    let mut statement = connection.prepare(sql).map_err(storage_error)?;
    let rows = statement
        .query_map([], |row| {
            let category = row_to_transaction_category(row).map_err(to_sql_error)?;
            let kind = category.kind();
            Ok(LedgerTableRecord::Categories(CategoryTableRecord {
                id: category.id().to_string(),
                name: category.name().to_string(),
                kind,
                kind_label: kind_label(kind).to_string(),
                parent_id: category.parent_id().map(str::to_string),
                parent_label: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                category,
            }))
        })
        .map_err(storage_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
}

fn to_sql_error(error: LedgerError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn matches_filters(record: &LedgerTableRecord, query: &LedgerTableQuery) -> bool {
    if query.filters().is_empty() {
        return true;
    }
    let matches = |filter| matches_filter(record, filter);
    match query.filter_mode() {
        FilterMode::And => query.filters().iter().all(matches),
        FilterMode::Or => query.filters().iter().any(matches),
    }
}

fn matches_filter(record: &LedgerTableRecord, filter: &LedgerTableFilter) -> bool {
    match (record, filter) {
        (
            LedgerTableRecord::Transactions(row),
            LedgerTableFilter::Transactions {
                field,
                operator,
                value,
            },
        ) => match field {
            TransactionTableFilterField::Date => date_match(&row.date, *operator, value),
            TransactionTableFilterField::Content => text_match(&row.content, *operator, value),
            TransactionTableFilterField::EntryType => {
                list_match(kind_name(row.kind), *operator, value)
            }
            TransactionTableFilterField::Account => {
                row.account_ids
                    .iter()
                    .any(|v| list_match(v, *operator, value))
                    || row
                        .account_labels
                        .iter()
                        .any(|v| list_match(v, *operator, value))
            }
            TransactionTableFilterField::Category => {
                list_match(row.category_id.as_deref().unwrap_or(""), *operator, value)
                    || list_match(&row.category_label, *operator, value)
            }
            TransactionTableFilterField::Currency => {
                list_match(&row.currency_id, *operator, value)
                    || list_match(&row.currency_code, *operator, value)
            }
            TransactionTableFilterField::Amount => number_match(row.amount_minor, *operator, value),
        },
        (
            LedgerTableRecord::Accounts(row),
            LedgerTableFilter::Accounts {
                field,
                operator,
                value,
            },
        ) => match field {
            AccountTableFilterField::Name => text_match(&row.name, *operator, value),
            AccountTableFilterField::AccountType => {
                list_match(&row.account_type_id, *operator, value)
                    || list_match(&row.account_type_label, *operator, value)
            }
            AccountTableFilterField::Currency => {
                list_match(&row.currency_id, *operator, value)
                    || list_match(&row.currency_code, *operator, value)
            }
            AccountTableFilterField::CurrentBalance => {
                number_match(row.current_balance_minor, *operator, value)
            }
        },
        (
            LedgerTableRecord::Categories(row),
            LedgerTableFilter::Categories {
                field,
                operator,
                value,
            },
        ) => match field {
            CategoryTableFilterField::Name => text_match(&row.name, *operator, value),
            CategoryTableFilterField::Kind => list_match(kind_label(row.kind), *operator, value),
            CategoryTableFilterField::Parent => {
                list_match(row.parent_id.as_deref().unwrap_or(""), *operator, value)
                    || list_match(&row.parent_label, *operator, value)
            }
        },
        _ => false,
    }
}

fn text_match(
    actual: &str,
    operator: LedgerFilterOperator,
    value: &LedgerTableFilterValue,
) -> bool {
    use LedgerFilterOperator as O;
    if matches!(operator, O::IsEmpty) {
        return actual.is_empty();
    }
    if matches!(operator, O::IsNotEmpty) {
        return !actual.is_empty();
    }
    let LedgerTableFilterValue::Text(expected) = value else {
        return false;
    };
    let (actual, expected) = (actual.to_lowercase(), expected.to_lowercase());
    match operator {
        O::Is => actual == expected,
        O::IsNot => actual != expected,
        O::Contains => actual.contains(&expected),
        O::DoesNotContain => !actual.contains(&expected),
        O::StartsWith => actual.starts_with(&expected),
        O::EndsWith => actual.ends_with(&expected),
        O::IsBefore | O::LessThan => actual < expected,
        O::IsAfter | O::GreaterThan => actual > expected,
        O::IsOnOrBefore => actual <= expected,
        O::IsOnOrAfter => actual >= expected,
        _ => false,
    }
}

fn date_match(
    actual: &str,
    operator: LedgerFilterOperator,
    value: &LedgerTableFilterValue,
) -> bool {
    use LedgerFilterOperator as O;
    let parse = |value: &str| Date::parse(value, format_description!("[year]-[month]-[day]")).ok();
    let Some(actual) = parse(actual) else {
        return false;
    };
    match (operator, value) {
        (O::IsBetween, LedgerTableFilterValue::Range { start, end }) => parse(start)
            .zip(parse(end))
            .is_some_and(|(start, end)| actual >= start && actual <= end),
        (O::IsRelativeToToday, LedgerTableFilterValue::Relative { amount, unit }) => {
            let Ok(amount) = amount.parse::<i64>() else {
                return false;
            };
            let days = match unit {
                crate::application::table::RelativeDateUnit::Day => amount,
                crate::application::table::RelativeDateUnit::Week => amount.saturating_mul(7),
                crate::application::table::RelativeDateUnit::Month => amount.saturating_mul(30),
            };
            let today = OffsetDateTime::now_utc().date();
            actual >= today - Duration::days(days) && actual <= today + Duration::days(days)
        }
        (_, LedgerTableFilterValue::Text(expected)) => {
            parse(expected).is_some_and(|expected| match operator {
                O::Is => actual == expected,
                O::IsNot => actual != expected,
                O::IsBefore => actual < expected,
                O::IsAfter => actual > expected,
                O::IsOnOrBefore => actual <= expected,
                O::IsOnOrAfter => actual >= expected,
                _ => false,
            })
        }
        _ => false,
    }
}

fn list_match(
    actual: &str,
    operator: LedgerFilterOperator,
    value: &LedgerTableFilterValue,
) -> bool {
    use LedgerFilterOperator as O;
    if matches!(operator, O::IsEmpty) {
        return actual.is_empty();
    }
    if matches!(operator, O::IsNotEmpty) {
        return !actual.is_empty();
    }
    let LedgerTableFilterValue::TextList(values) = value else {
        return false;
    };
    let found = values
        .iter()
        .any(|value| value.eq_ignore_ascii_case(actual));
    match operator {
        O::Is | O::Contains => found,
        O::IsNot | O::DoesNotContain => !found,
        _ => false,
    }
}

fn number_match(
    actual: i64,
    operator: LedgerFilterOperator,
    value: &LedgerTableFilterValue,
) -> bool {
    use LedgerFilterOperator as O;
    let LedgerTableFilterValue::Text(expected) = value else {
        return false;
    };
    let Ok(expected) = expected.parse::<f64>() else {
        return false;
    };
    let actual = actual as f64;
    match operator {
        O::Is => actual == expected,
        O::IsNot => actual != expected,
        O::GreaterThan => actual > expected,
        O::LessThan => actual < expected,
        _ => false,
    }
}

fn compare_records(
    left: &LedgerTableRecord,
    right: &LedgerTableRecord,
    query: &LedgerTableQuery,
) -> Ordering {
    for sort in query.sorts() {
        let ordering = compare_sort(left, right, sort);
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    left.logical_id().cmp(right.logical_id())
}

fn compare_sort(
    left: &LedgerTableRecord,
    right: &LedgerTableRecord,
    sort: &LedgerTableSort,
) -> Ordering {
    let (ordering, direction) = match (left, right, sort) {
        (
            LedgerTableRecord::Transactions(a),
            LedgerTableRecord::Transactions(b),
            LedgerTableSort::Transactions { field, direction },
        ) => (
            (match field {
                TransactionTableSortField::Date => a.date.cmp(&b.date),
                TransactionTableSortField::Content => a.content.cmp(&b.content),
                TransactionTableSortField::Account => a.account_label.cmp(&b.account_label),
                TransactionTableSortField::Category => a.category_label.cmp(&b.category_label),
                TransactionTableSortField::Amount => a.amount_minor.cmp(&b.amount_minor),
                TransactionTableSortField::Updated => a.updated_at.cmp(&b.updated_at),
            }),
            *direction,
        ),
        (
            LedgerTableRecord::Accounts(a),
            LedgerTableRecord::Accounts(b),
            LedgerTableSort::Accounts { field, direction },
        ) => (
            (match field {
                AccountTableSortField::Name => a.name.cmp(&b.name),
                AccountTableSortField::AccountType => {
                    a.account_type_label.cmp(&b.account_type_label)
                }
                AccountTableSortField::Currency => a.currency_code.cmp(&b.currency_code),
                AccountTableSortField::CurrentBalance => {
                    a.current_balance_minor.cmp(&b.current_balance_minor)
                }
            }),
            *direction,
        ),
        (
            LedgerTableRecord::Categories(a),
            LedgerTableRecord::Categories(b),
            LedgerTableSort::Categories { field, direction },
        ) => (
            (match field {
                CategoryTableSortField::Name => a.name.cmp(&b.name),
                CategoryTableSortField::Kind => kind_label(a.kind).cmp(kind_label(b.kind)),
                CategoryTableSortField::Parent => a.parent_label.cmp(&b.parent_label),
            }),
            *direction,
        ),
        _ => (Ordering::Equal, SortDirection::Asc),
    };
    if direction == SortDirection::Desc {
        ordering.reverse()
    } else {
        ordering
    }
}

fn groups(record: &LedgerTableRecord, query: &LedgerTableQuery) -> Vec<(String, String)> {
    match (record, query.group_settings().group_by()) {
        (
            _,
            LedgerTableGroup::Transactions(TransactionTableGroup::None)
            | LedgerTableGroup::Accounts(AccountTableGroup::None)
            | LedgerTableGroup::Categories(CategoryTableGroup::None),
        ) => vec![(String::new(), String::new())],
        (LedgerTableRecord::Transactions(row), LedgerTableGroup::Transactions(group)) => {
            match group {
                TransactionTableGroup::Month => {
                    vec![(row.date[..7].to_string(), row.date[..7].to_string())]
                }
                TransactionTableGroup::Week => vec![(row.date.clone(), row.date.clone())],
                TransactionTableGroup::Day => vec![(row.date.clone(), row.date.clone())],
                TransactionTableGroup::Account => row
                    .account_ids
                    .iter()
                    .cloned()
                    .zip(row.account_labels.iter().cloned())
                    .collect(),
                TransactionTableGroup::Category => vec![(
                    row.category_id.clone().unwrap_or_default(),
                    row.category_label.clone(),
                )],
                TransactionTableGroup::EntryType => vec![(
                    kind_name(row.kind).to_string(),
                    kind_name(row.kind).to_string(),
                )],
                TransactionTableGroup::None => unreachable!(),
            }
        }
        (LedgerTableRecord::Accounts(row), LedgerTableGroup::Accounts(group)) => match group {
            AccountTableGroup::AccountType => {
                vec![(row.account_type_id.clone(), row.account_type_label.clone())]
            }
            AccountTableGroup::Currency => {
                vec![(row.currency_id.clone(), row.currency_code.clone())]
            }
            AccountTableGroup::None => unreachable!(),
        },
        (LedgerTableRecord::Categories(row), LedgerTableGroup::Categories(group)) => match group {
            CategoryTableGroup::Kind => vec![(
                kind_label(row.kind).to_lowercase(),
                kind_label(row.kind).to_string(),
            )],
            CategoryTableGroup::Parent => vec![(
                row.parent_id.clone().unwrap_or_default(),
                row.parent_label.clone(),
            )],
            CategoryTableGroup::None => unreachable!(),
        },
        _ => vec![],
    }
}

fn compare_groups(
    left: &LedgerTableRow,
    right: &LedgerTableRow,
    query: &LedgerTableQuery,
) -> Ordering {
    let group = match query.group_settings().sort() {
        GroupSort::Alphabetical => left.group_label().cmp(&right.group_label()),
        GroupSort::ReverseAlphabetical => left.group_label().cmp(&right.group_label()).reverse(),
        GroupSort::Manual => {
            let order = query.group_settings().manual_order();
            let index = |row: &LedgerTableRow| {
                order
                    .iter()
                    .position(|key| Some(key.as_str()) == row.group_key())
                    .unwrap_or(usize::MAX)
            };
            index(left)
                .cmp(&index(right))
                .then_with(|| left.group_label().cmp(&right.group_label()))
        }
    };
    group.then_with(|| compare_records(left.record(), right.record(), query))
}

const fn kind_name(kind: TransactionRowKind) -> &'static str {
    match kind {
        TransactionRowKind::Expense => "expense",
        TransactionRowKind::Income => "income",
        TransactionRowKind::Transfer => "transfer",
    }
}
const fn kind_label(kind: TransactionCategoryKind) -> &'static str {
    match kind {
        TransactionCategoryKind::Expense => "Expense",
        TransactionCategoryKind::Income => "Income",
    }
}
