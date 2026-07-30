use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::Serialize;
use serde_json::{Map, Value, json};
use time::format_description::well_known::Rfc3339;
use time::{Date, OffsetDateTime, macros::format_description};
use uuid::{Uuid, Version};

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{
    DiagnosticRow, DiagnosticTable, DiagnosticValue, LedgerReadRepository, MAX_PAGE_LIMIT,
};
use crate::application::service::LedgerService;

pub const DEFAULT_DOCTOR_MAX_RECORDS: usize = 100_000;
pub const DEFAULT_DOCTOR_MAX_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DoctorOptions {
    pub max_records: usize,
    pub max_bytes: usize,
}

impl Default for DoctorOptions {
    fn default() -> Self {
        Self {
            max_records: DEFAULT_DOCTOR_MAX_RECORDS,
            max_bytes: DEFAULT_DOCTOR_MAX_BYTES,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DoctorSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct DoctorIssue {
    pub severity: DoctorSeverity,
    pub code: String,
    pub record_type: String,
    pub record_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DoctorScanProgress {
    pub table: String,
    pub scanned_records: usize,
    pub scanned_bytes: usize,
    /// Last fully scanned SQLite rowid.
    pub cursor: i64,
    /// First rowid not scanned because a configured budget was reached.
    pub next_unscanned_rowid: Option<i64>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DoctorReport {
    pub healthy: bool,
    pub scanned_entries: usize,
    pub scanned_records: usize,
    pub scanned_bytes: usize,
    pub scans: Vec<DoctorScanProgress>,
    pub issues: Vec<DoctorIssue>,
}

#[allow(private_bounds)]
impl<R: LedgerReadRepository> LedgerService<R> {
    /// Performs read-only diagnostics with explicit row and byte budgets.
    pub fn doctor(&self) -> LedgerResult<DoctorReport> {
        self.doctor_with_options(DoctorOptions::default())
    }

    /// A budget limit produces a stable truncation issue, never a storage error.
    pub fn doctor_with_options(&self, options: DoctorOptions) -> LedgerResult<DoctorReport> {
        if options.max_records == 0 {
            return Err(validation(
                "max_records",
                "doctor record limit must be positive",
            ));
        }
        if options.max_bytes == 0 {
            return Err(validation(
                "max_bytes",
                "doctor byte limit must be positive",
            ));
        }

        let health = self.repository.database_health()?;
        let mut issues = database_issues(health);
        let mut rows_by_table = BTreeMap::<DiagnosticTable, Vec<DiagnosticRow>>::new();
        let mut scans = Vec::new();
        let mut remaining_records = options.max_records;
        let mut remaining_bytes = options.max_bytes;
        let mut total_records = 0_usize;
        let mut total_bytes = 0_usize;

        for table in DiagnosticTable::ALL {
            let mut cursor = 0_i64;
            let mut table_records = 0_usize;
            let mut table_bytes = 0_usize;
            let mut next_unscanned_rowid = None;
            let mut truncated = false;
            let mut table_rows = Vec::new();

            loop {
                if remaining_records == 0 || remaining_bytes == 0 {
                    let probe = self.repository.scan_diagnostic_rows(table, cursor, 1, 0)?;
                    next_unscanned_rowid = probe.next_unscanned_rowid;
                    truncated = next_unscanned_rowid.is_some();
                    break;
                }
                let limit = u16::try_from(remaining_records.min(usize::from(MAX_PAGE_LIMIT)))
                    .expect("diagnostic page is bounded by the u16 maximum");
                let batch =
                    self.repository
                        .scan_diagnostic_rows(table, cursor, limit, remaining_bytes)?;
                if batch.rows.is_empty() {
                    next_unscanned_rowid = batch.next_unscanned_rowid;
                    truncated = batch.truncated;
                    break;
                }
                let batch_records = batch.rows.len();
                cursor = batch.next_cursor.unwrap_or(cursor);
                table_records += batch_records;
                table_bytes = table_bytes.checked_add(batch.byte_count).ok_or_else(|| {
                    LedgerError::Storage("doctor byte count overflow".to_string())
                })?;
                total_records += batch_records;
                total_bytes = total_bytes.checked_add(batch.byte_count).ok_or_else(|| {
                    LedgerError::Storage("doctor byte count overflow".to_string())
                })?;
                remaining_records -= batch_records;
                remaining_bytes -= batch.byte_count;
                table_rows.extend(batch.rows);
                if batch.truncated {
                    next_unscanned_rowid = batch.next_unscanned_rowid;
                    truncated = true;
                    break;
                }
                if batch_records < usize::from(limit) {
                    break;
                }
            }

            if truncated {
                issues.push(issue(
                    DoctorSeverity::Warning,
                    "doctor_scan_truncated",
                    table.name(),
                    next_unscanned_rowid.map(|rowid| rowid.to_string()),
                    format!(
                        "scan stopped after {table_records} records and {table_bytes} bytes; \
                         last cursor {cursor}"
                    ),
                ));
            }
            scans.push(DoctorScanProgress {
                table: table.name().to_string(),
                scanned_records: table_records,
                scanned_bytes: table_bytes,
                cursor,
                next_unscanned_rowid,
                truncated,
            });
            rows_by_table.insert(table, table_rows);
        }

        validate_rows(&rows_by_table, &mut issues);
        issues.sort();
        issues.dedup();
        let scanned_entries = rows_by_table
            .get(&DiagnosticTable::LedgerEntries)
            .map_or(0, Vec::len);
        Ok(DoctorReport {
            healthy: issues.is_empty(),
            scanned_entries,
            scanned_records: total_records,
            scanned_bytes: total_bytes,
            scans,
            issues,
        })
    }
}

#[derive(Debug, Clone)]
struct DurableRecord {
    record_type: &'static str,
    id: String,
    snapshot: Value,
}

#[derive(Debug, Clone)]
struct AccountRecord {
    durable: DurableRecord,
    category_id: String,
    currency_id: String,
    name: String,
}

#[derive(Debug, Clone)]
struct CategoryRecord {
    durable: DurableRecord,
    parent_id: Option<String>,
}

#[derive(Debug, Clone)]
struct CurrencyRecord {
    durable: DurableRecord,
    code: String,
    name: String,
}

#[derive(Debug, Clone)]
struct EntryRecord {
    durable: DurableRecord,
    date: String,
    written_at: String,
    content: String,
    category_id: Option<String>,
    account_id: String,
    entry_type: String,
    amount_minor: i64,
    currency_id: String,
    transfer_group_id: Option<String>,
    source: String,
    notes: Option<String>,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
}

#[derive(Debug, Clone)]
struct AuditRecord {
    rowid: i64,
    id: String,
    occurred_at: String,
    actor: String,
    action: String,
    record_type: String,
    record_id: String,
    before: Option<Value>,
    after: Option<Value>,
}

#[derive(Debug, Clone)]
struct OperationRecord {
    operation_key: String,
    payload: Option<Map<String, Value>>,
    result: Option<Map<String, Value>>,
}

fn validate_rows(
    rows_by_table: &BTreeMap<DiagnosticTable, Vec<DiagnosticRow>>,
    issues: &mut Vec<DoctorIssue>,
) {
    let currencies = parse_currencies(rows(rows_by_table, DiagnosticTable::Currencies), issues);
    let account_categories = parse_account_categories(
        rows(rows_by_table, DiagnosticTable::AccountCategories),
        issues,
    );
    let accounts = parse_accounts(rows(rows_by_table, DiagnosticTable::Accounts), issues);
    let transaction_categories = parse_transaction_categories(
        rows(rows_by_table, DiagnosticTable::TransactionCategories),
        issues,
    );
    let audits = parse_audits(rows(rows_by_table, DiagnosticTable::AuditEvents), issues);
    let operations = parse_operations(
        rows(rows_by_table, DiagnosticTable::TransferOperations),
        issues,
    );
    let entries = parse_entries(rows(rows_by_table, DiagnosticTable::LedgerEntries), issues);

    validate_references(
        &currencies,
        &account_categories,
        &accounts,
        &transaction_categories,
        &entries,
        issues,
    );
    hierarchy_issues(
        "account_category",
        account_categories
            .values()
            .map(|record| (record.durable.id.as_str(), record.parent_id.as_deref())),
        issues,
    );
    hierarchy_issues(
        "transaction_category",
        transaction_categories
            .values()
            .map(|record| (record.durable.id.as_str(), record.parent_id.as_deref())),
        issues,
    );
    let transfer_groups = validate_transfer_pairs(&entries, issues);
    validate_audits(
        &currencies,
        &account_categories,
        &accounts,
        &transaction_categories,
        &entries,
        &transfer_groups,
        &audits,
        issues,
    );
    validate_operations(
        &currencies,
        &accounts,
        &transfer_groups,
        &audits,
        &operations,
        issues,
    );
}

fn rows(
    rows_by_table: &BTreeMap<DiagnosticTable, Vec<DiagnosticRow>>,
    table: DiagnosticTable,
) -> &[DiagnosticRow] {
    rows_by_table.get(&table).map_or(&[], Vec::as_slice)
}

fn parse_currencies(
    rows: &[DiagnosticRow],
    issues: &mut Vec<DoctorIssue>,
) -> BTreeMap<String, CurrencyRecord> {
    let mut records = BTreeMap::new();
    for row in rows {
        let record_id = diagnostic_id(row, "id");
        let Some(id) = required_text(row, "id", "currency", &record_id, issues) else {
            continue;
        };
        let Some(code) = required_text(row, "code", "currency", &id, issues) else {
            continue;
        };
        let Some(name) = required_text(row, "name", "currency", &id, issues) else {
            continue;
        };
        let Some(symbol) = required_text(row, "symbol", "currency", &id, issues) else {
            continue;
        };
        let Some(decimal_places) = required_integer(row, "decimal_places", "currency", &id, issues)
        else {
            continue;
        };
        let Some(active) = required_bool(row, "active", "currency", &id, issues) else {
            continue;
        };
        timestamps(row, "currency", &id, issues);
        if !(0..=18).contains(&decimal_places) {
            invariant_issue(
                issues,
                "currency",
                &id,
                "decimal_places must be between 0 and 18",
            );
        }
        let snapshot = json!({
            "id": id,
            "code": code,
            "name": name,
            "symbol": symbol,
            "decimal_places": decimal_places,
            "active": active,
        });
        records.insert(
            id.clone(),
            CurrencyRecord {
                durable: DurableRecord {
                    record_type: "currency",
                    id,
                    snapshot,
                },
                code,
                name,
            },
        );
    }
    records
}

fn parse_account_categories(
    rows: &[DiagnosticRow],
    issues: &mut Vec<DoctorIssue>,
) -> BTreeMap<String, CategoryRecord> {
    let mut records = BTreeMap::new();
    for row in rows {
        let record_id = diagnostic_id(row, "id");
        let Some(id) = required_text(row, "id", "account_category", &record_id, issues) else {
            continue;
        };
        let Some(name) = required_text(row, "name", "account_category", &id, issues) else {
            continue;
        };
        let parent_id = optional_text(row, "parent_id", "account_category", &id, issues);
        let Some(liability) = required_bool(row, "liability", "account_category", &id, issues)
        else {
            continue;
        };
        let Some(active) = required_bool(row, "active", "account_category", &id, issues) else {
            continue;
        };
        timestamps(row, "account_category", &id, issues);
        let snapshot = json!({
            "id": id,
            "name": name,
            "parent_id": parent_id,
            "liability": liability,
            "active": active,
        });
        records.insert(
            id.clone(),
            CategoryRecord {
                durable: DurableRecord {
                    record_type: "account_category",
                    id,
                    snapshot,
                },
                parent_id,
            },
        );
    }
    records
}

fn parse_accounts(
    rows: &[DiagnosticRow],
    issues: &mut Vec<DoctorIssue>,
) -> BTreeMap<String, AccountRecord> {
    let mut records = BTreeMap::new();
    for row in rows {
        let record_id = diagnostic_id(row, "id");
        let Some(id) = required_text(row, "id", "account", &record_id, issues) else {
            continue;
        };
        let Some(name) = required_text(row, "name", "account", &id, issues) else {
            continue;
        };
        let Some(category_id) = required_text(row, "account_category_id", "account", &id, issues)
        else {
            continue;
        };
        let Some(currency_id) = required_text(row, "currency_id", "account", &id, issues) else {
            continue;
        };
        let Some(opening_balance) =
            required_integer(row, "opening_balance_minor", "account", &id, issues)
        else {
            continue;
        };
        let Some(active) = required_bool(row, "active", "account", &id, issues) else {
            continue;
        };
        timestamps(row, "account", &id, issues);
        let snapshot = json!({
            "id": id,
            "name": name,
            "category_id": category_id,
            "currency_id": currency_id,
            "opening_balance": opening_balance,
            "active": active,
        });
        records.insert(
            id.clone(),
            AccountRecord {
                durable: DurableRecord {
                    record_type: "account",
                    id,
                    snapshot,
                },
                category_id,
                currency_id,
                name,
            },
        );
    }
    records
}

fn parse_transaction_categories(
    rows: &[DiagnosticRow],
    issues: &mut Vec<DoctorIssue>,
) -> BTreeMap<String, CategoryRecord> {
    let mut records = BTreeMap::new();
    for row in rows {
        let record_id = diagnostic_id(row, "id");
        let Some(id) = required_text(row, "id", "transaction_category", &record_id, issues) else {
            continue;
        };
        let Some(name) = required_text(row, "name", "transaction_category", &id, issues) else {
            continue;
        };
        let parent_id = optional_text(row, "parent_id", "transaction_category", &id, issues);
        let Some(kind) = required_text(row, "kind", "transaction_category", &id, issues) else {
            continue;
        };
        let Some(active) = required_bool(row, "active", "transaction_category", &id, issues) else {
            continue;
        };
        timestamps(row, "transaction_category", &id, issues);
        if !matches!(kind.as_str(), "expense" | "income") {
            invariant_issue(
                issues,
                "transaction_category",
                &id,
                "kind must be expense or income",
            );
        }
        let snapshot = json!({
            "id": id,
            "name": name,
            "parent_id": parent_id,
            "kind": kind,
            "active": active,
        });
        records.insert(
            id.clone(),
            CategoryRecord {
                durable: DurableRecord {
                    record_type: "transaction_category",
                    id,
                    snapshot,
                },
                parent_id,
            },
        );
    }
    records
}

fn parse_entries(
    rows: &[DiagnosticRow],
    issues: &mut Vec<DoctorIssue>,
) -> BTreeMap<String, EntryRecord> {
    let mut records = BTreeMap::new();
    for row in rows {
        let record_id = diagnostic_id(row, "id");
        let Some(id) = required_text(row, "id", "ledger_entry", &record_id, issues) else {
            continue;
        };
        let Some(date) = required_text(row, "date", "ledger_entry", &id, issues) else {
            continue;
        };
        let Some(written_at) = required_text(row, "written_at", "ledger_entry", &id, issues) else {
            continue;
        };
        let Some(content) = required_text(row, "content", "ledger_entry", &id, issues) else {
            continue;
        };
        let category_id =
            optional_text(row, "transaction_category_id", "ledger_entry", &id, issues);
        let Some(account_id) = required_text(row, "account_id", "ledger_entry", &id, issues) else {
            continue;
        };
        let Some(entry_type) = required_text(row, "entry_type", "ledger_entry", &id, issues) else {
            continue;
        };
        let Some(amount_minor) = required_integer(row, "amount_minor", "ledger_entry", &id, issues)
        else {
            continue;
        };
        let Some(currency_id) = required_text(row, "currency_id", "ledger_entry", &id, issues)
        else {
            continue;
        };
        let transfer_group_id =
            optional_text(row, "transfer_group_id", "ledger_entry", &id, issues);
        let Some(source) = required_text(row, "source", "ledger_entry", &id, issues) else {
            continue;
        };
        let notes = optional_text(row, "notes", "ledger_entry", &id, issues);
        let Some(created_at) = required_text(row, "created_at", "ledger_entry", &id, issues) else {
            continue;
        };
        let Some(updated_at) = required_text(row, "updated_at", "ledger_entry", &id, issues) else {
            continue;
        };
        let deleted_at = optional_text(row, "deleted_at", "ledger_entry", &id, issues);

        if Date::parse(date.trim(), format_description!("[year]-[month]-[day]")).is_err() {
            issues.push(issue(
                DoctorSeverity::Error,
                "entry_date_invalid",
                "ledger_entry",
                Some(id.clone()),
                "entry date is not a valid ISO calendar date".to_string(),
            ));
        }
        for (field, value) in [
            ("written_at", written_at.as_str()),
            ("created_at", created_at.as_str()),
            ("updated_at", updated_at.as_str()),
        ]
        .into_iter()
        .chain(deleted_at.as_deref().map(|value| ("deleted_at", value)))
        {
            if OffsetDateTime::parse(value, &Rfc3339).is_err() {
                issues.push(issue(
                    DoctorSeverity::Error,
                    "entry_timestamp_invalid",
                    "ledger_entry",
                    Some(id.clone()),
                    format!("{field} is not RFC 3339"),
                ));
            }
        }
        if amount_minor <= 0 {
            issues.push(issue(
                DoctorSeverity::Error,
                "entry_amount_invalid",
                "ledger_entry",
                Some(id.clone()),
                "entry amount must be positive minor units".to_string(),
            ));
        }
        if !matches!(
            entry_type.as_str(),
            "expense"
                | "income"
                | "transfer_out"
                | "transfer_in"
                | "adjustment_out"
                | "adjustment_in"
        ) {
            issues.push(issue(
                DoctorSeverity::Error,
                "entry_type_invalid",
                "ledger_entry",
                Some(id.clone()),
                format!("unknown entry type {entry_type}"),
            ));
        }
        let snapshot = json!({
            "id": id,
            "date": date,
            "written_at": written_at,
            "content": content,
            "transaction_category_id": category_id,
            "account_id": account_id,
            "entry_type": entry_type,
            "amount": amount_minor,
            "currency_id": currency_id,
            "transfer_group_id": transfer_group_id,
            "source": source,
            "notes": notes,
            "created_at": created_at,
            "updated_at": updated_at,
            "deleted_at": deleted_at,
        });
        records.insert(
            id.clone(),
            EntryRecord {
                durable: DurableRecord {
                    record_type: "ledger_entry",
                    id,
                    snapshot,
                },
                date,
                written_at,
                content,
                category_id,
                account_id,
                entry_type,
                amount_minor,
                currency_id,
                transfer_group_id,
                source,
                notes,
                created_at,
                updated_at,
                deleted_at,
            },
        );
    }
    records
}

fn parse_audits(rows: &[DiagnosticRow], issues: &mut Vec<DoctorIssue>) -> Vec<AuditRecord> {
    let mut records = Vec::new();
    for row in rows {
        let record_id = diagnostic_id(row, "id");
        let Some(id) = required_text(row, "id", "audit_event", &record_id, issues) else {
            continue;
        };
        let Some(occurred_at) = required_text(row, "occurred_at", "audit_event", &id, issues)
        else {
            continue;
        };
        let Some(actor) = required_text(row, "actor", "audit_event", &id, issues) else {
            continue;
        };
        let Some(action) = required_text(row, "action", "audit_event", &id, issues) else {
            continue;
        };
        let Some(record_type) = required_text(row, "record_type", "audit_event", &id, issues)
        else {
            continue;
        };
        let Some(target_id) = required_text(row, "record_id", "audit_event", &id, issues) else {
            continue;
        };
        if OffsetDateTime::parse(&occurred_at, &Rfc3339).is_err() {
            issues.push(issue(
                DoctorSeverity::Error,
                "audit_timestamp_invalid",
                "audit_event",
                Some(id.clone()),
                "occurred_at is not RFC 3339".to_string(),
            ));
        }
        let before = optional_json(row, "before_json", &id, issues);
        let after = optional_json(row, "after_json", &id, issues);
        let _ = optional_text(row, "reason", "audit_event", &id, issues);
        records.push(AuditRecord {
            rowid: row.rowid,
            id,
            occurred_at,
            actor,
            action,
            record_type,
            record_id: target_id,
            before,
            after,
        });
    }
    records
}

fn parse_operations(rows: &[DiagnosticRow], issues: &mut Vec<DoctorIssue>) -> Vec<OperationRecord> {
    let mut records = Vec::new();
    for row in rows {
        let record_id = diagnostic_id(row, "operation_key");
        let Some(operation_key) = required_text(
            row,
            "operation_key",
            "transfer_operation",
            &record_id,
            issues,
        ) else {
            continue;
        };
        if !is_engine_uuid(&operation_key) {
            operation_issue(
                issues,
                &operation_key,
                "operation key is not a canonical UUID v4",
            );
        }
        let payload = required_json_object(row, "payload_json", &operation_key, issues);
        let result = required_json_object(row, "result_json", &operation_key, issues);
        if let Some(created_at) = required_text(
            row,
            "created_at",
            "transfer_operation",
            &operation_key,
            issues,
        ) {
            if OffsetDateTime::parse(&created_at, &Rfc3339).is_err() {
                operation_issue(issues, &operation_key, "created_at is not RFC 3339");
            }
        }
        records.push(OperationRecord {
            operation_key,
            payload,
            result,
        });
    }
    records
}

fn validate_references(
    currencies: &BTreeMap<String, CurrencyRecord>,
    account_categories: &BTreeMap<String, CategoryRecord>,
    accounts: &BTreeMap<String, AccountRecord>,
    transaction_categories: &BTreeMap<String, CategoryRecord>,
    entries: &BTreeMap<String, EntryRecord>,
    issues: &mut Vec<DoctorIssue>,
) {
    for account in accounts.values() {
        if !account_categories.contains_key(&account.category_id) {
            orphan_issue(
                issues,
                "account",
                &account.durable.id,
                format!("account category {} does not exist", account.category_id),
            );
        }
        if !currencies.contains_key(&account.currency_id) {
            orphan_issue(
                issues,
                "account",
                &account.durable.id,
                format!("currency {} does not exist", account.currency_id),
            );
        }
    }
    for entry in entries.values() {
        if !accounts.contains_key(&entry.account_id) {
            orphan_issue(
                issues,
                "ledger_entry",
                &entry.durable.id,
                format!("account {} does not exist", entry.account_id),
            );
        }
        if !currencies.contains_key(&entry.currency_id) {
            orphan_issue(
                issues,
                "ledger_entry",
                &entry.durable.id,
                format!("currency {} does not exist", entry.currency_id),
            );
        }
        if entry
            .category_id
            .as_ref()
            .is_some_and(|id| !transaction_categories.contains_key(id))
        {
            orphan_issue(
                issues,
                "ledger_entry",
                &entry.durable.id,
                format!(
                    "transaction category {} does not exist",
                    entry.category_id.as_deref().expect("checked category")
                ),
            );
        }
        if accounts
            .get(&entry.account_id)
            .is_some_and(|account| account.currency_id != entry.currency_id)
        {
            issues.push(issue(
                DoctorSeverity::Error,
                "entry_currency_mismatch",
                "ledger_entry",
                Some(entry.durable.id.clone()),
                "entry currency differs from its account currency".to_string(),
            ));
        }
    }
}

fn validate_transfer_pairs<'entry>(
    entries: &'entry BTreeMap<String, EntryRecord>,
    issues: &mut Vec<DoctorIssue>,
) -> BTreeMap<String, Vec<&'entry EntryRecord>> {
    let mut groups = BTreeMap::<String, Vec<&EntryRecord>>::new();
    for entry in entries.values() {
        let transfer_type = matches!(entry.entry_type.as_str(), "transfer_out" | "transfer_in");
        match (transfer_type, entry.transfer_group_id.as_deref()) {
            (true, Some(group)) => groups.entry(group.to_string()).or_default().push(entry),
            (true, None) => transfer_issue(
                issues,
                Some(entry.durable.id.clone()),
                "transfer entry has no group",
            ),
            (false, Some(group)) => transfer_issue(
                issues,
                Some(group.to_string()),
                "non-transfer entry has a transfer group",
            ),
            (false, None) => {}
        }
    }
    for (group, pair) in &groups {
        if let Some(message) = invalid_transfer_group(group, pair) {
            transfer_issue(issues, Some(group.clone()), message);
        }
    }
    groups
}

fn invalid_transfer_group(group: &str, entries: &[&EntryRecord]) -> Option<&'static str> {
    if !is_engine_uuid(group) {
        return Some("group identity is not a canonical UUID v4");
    }
    if entries.len() != 2 {
        return Some("group must contain exactly two entries");
    }
    let out = entries
        .iter()
        .find(|entry| entry.entry_type == "transfer_out")?;
    let input = entries
        .iter()
        .find(|entry| entry.entry_type == "transfer_in")?;
    if entries
        .iter()
        .filter(|entry| entry.entry_type == "transfer_out")
        .count()
        != 1
        || entries
            .iter()
            .filter(|entry| entry.entry_type == "transfer_in")
            .count()
            != 1
    {
        return Some("group must contain one transfer-out and one transfer-in");
    }
    if out.durable.id == input.durable.id || out.account_id == input.account_id {
        return Some("paired entries must use distinct identities and accounts");
    }
    if out.amount_minor != input.amount_minor
        || out.currency_id != input.currency_id
        || out.date != input.date
        || out.written_at != input.written_at
        || out.content != input.content
        || out.source != input.source
        || out.notes != input.notes
        || out.category_id.is_some()
        || input.category_id.is_some()
        || out.created_at != input.created_at
        || out.updated_at != input.updated_at
        || out.deleted_at != input.deleted_at
    {
        return Some("paired entries have incompatible transfer fields");
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn validate_audits(
    currencies: &BTreeMap<String, CurrencyRecord>,
    account_categories: &BTreeMap<String, CategoryRecord>,
    accounts: &BTreeMap<String, AccountRecord>,
    transaction_categories: &BTreeMap<String, CategoryRecord>,
    entries: &BTreeMap<String, EntryRecord>,
    transfer_groups: &BTreeMap<String, Vec<&EntryRecord>>,
    audits: &[AuditRecord],
    issues: &mut Vec<DoctorIssue>,
) {
    let mut histories = BTreeMap::<(String, String), Vec<&AuditRecord>>::new();
    for audit in audits {
        if !matches!(
            audit.record_type.as_str(),
            "currency"
                | "account_category"
                | "account"
                | "transaction_category"
                | "ledger_entry"
                | "transfer"
        ) {
            issues.push(issue(
                DoctorSeverity::Error,
                "audit_record_invalid",
                "audit_event",
                Some(audit.id.clone()),
                format!("unsupported record type {}", audit.record_type),
            ));
        }
        histories
            .entry((audit.record_type.clone(), audit.record_id.clone()))
            .or_default()
            .push(audit);
    }
    for history in histories.values_mut() {
        history.sort_by(|left, right| {
            left.occurred_at
                .cmp(&right.occurred_at)
                .then_with(|| left.rowid.cmp(&right.rowid))
        });
        validate_audit_chain(history, issues);
    }

    let durable = currencies
        .values()
        .map(|record| &record.durable)
        .chain(account_categories.values().map(|record| &record.durable))
        .chain(accounts.values().map(|record| &record.durable))
        .chain(
            transaction_categories
                .values()
                .map(|record| &record.durable),
        )
        .chain(
            entries
                .values()
                .filter(|entry| {
                    !matches!(entry.entry_type.as_str(), "transfer_out" | "transfer_in")
                })
                .map(|entry| &entry.durable),
        );
    let mut durable_keys = HashSet::new();
    for record in durable {
        let key = (record.record_type.to_string(), record.id.clone());
        durable_keys.insert(key.clone());
        let history = histories.get(&key).map_or(&[][..], Vec::as_slice);
        validate_current_history(record, history, issues);
    }

    for (group, pair) in transfer_groups {
        let key = ("transfer".to_string(), group.clone());
        durable_keys.insert(key.clone());
        let history = histories.get(&key).map_or(&[][..], Vec::as_slice);
        if history
            .iter()
            .filter(|audit| audit.action == "create")
            .count()
            != 1
        {
            issues.push(issue(
                DoctorSeverity::Error,
                "audit_create_count_invalid",
                "transfer",
                Some(group.clone()),
                "current transfer must have exactly one create audit".to_string(),
            ));
        }
        if let Some(latest) = history.last() {
            if latest.action == "purge" {
                issues.push(issue(
                    DoctorSeverity::Error,
                    "audit_orphan",
                    "transfer",
                    Some(group.clone()),
                    "current transfer has a terminal purge audit".to_string(),
                ));
            } else if !transfer_snapshot_matches(latest.after.as_ref(), pair) {
                issues.push(issue(
                    DoctorSeverity::Error,
                    "audit_snapshot_mismatch",
                    "transfer",
                    Some(group.clone()),
                    "latest transfer audit snapshot does not match current entries".to_string(),
                ));
            }
        } else {
            issues.push(issue(
                DoctorSeverity::Error,
                "audit_missing",
                "transfer",
                Some(group.clone()),
                "current transfer has no audit history".to_string(),
            ));
        }
    }

    for (key, history) in &histories {
        if durable_keys.contains(key) {
            continue;
        }
        if history.last().is_some_and(|audit| audit.action != "purge") {
            issues.push(issue(
                DoctorSeverity::Error,
                "audit_orphan",
                &key.0,
                Some(key.1.clone()),
                "audit history has no durable record and does not end in purge".to_string(),
            ));
        }
    }
}

fn validate_audit_chain(history: &[&AuditRecord], issues: &mut Vec<DoctorIssue>) {
    let Some(first) = history.first() else {
        return;
    };
    let create_count = history
        .iter()
        .filter(|audit| audit.action == "create")
        .count();
    if create_count != 1 {
        issues.push(issue(
            DoctorSeverity::Error,
            "audit_create_count_invalid",
            &first.record_type,
            Some(first.record_id.clone()),
            format!("audit history contains {create_count} create events"),
        ));
    }
    let mut previous_after: Option<&Value> = None;
    for audit in history {
        let valid_shape = match audit.action.as_str() {
            "create" => audit.before.is_none() && audit.after.is_some(),
            "update" | "archive" | "restore" => audit.before.is_some() && audit.after.is_some(),
            "purge" => audit.before.is_some() && audit.after.is_none(),
            _ => false,
        };
        if !valid_shape {
            issues.push(issue(
                DoctorSeverity::Error,
                "audit_snapshot_invalid",
                "audit_event",
                Some(audit.id.clone()),
                format!("action {} has invalid before/after snapshots", audit.action),
            ));
        }
        if let (Some(previous), Some(before)) = (previous_after, audit.before.as_ref()) {
            if previous != before {
                issues.push(issue(
                    DoctorSeverity::Error,
                    "audit_history_discontinuous",
                    &audit.record_type,
                    Some(audit.record_id.clone()),
                    "audit before snapshot does not match the prior after snapshot".to_string(),
                ));
            }
        }
        previous_after = audit.after.as_ref();
    }
}

fn validate_current_history(
    record: &DurableRecord,
    history: &[&AuditRecord],
    issues: &mut Vec<DoctorIssue>,
) {
    if history.is_empty() {
        issues.push(issue(
            DoctorSeverity::Error,
            "audit_missing",
            record.record_type,
            Some(record.id.clone()),
            "current record has no audit history".to_string(),
        ));
        return;
    }
    if history
        .iter()
        .filter(|audit| audit.action == "create")
        .count()
        != 1
    {
        issues.push(issue(
            DoctorSeverity::Error,
            "audit_create_count_invalid",
            record.record_type,
            Some(record.id.clone()),
            "current record must have exactly one create audit".to_string(),
        ));
    }
    let latest = history.last().expect("non-empty history");
    if latest.action == "purge" {
        issues.push(issue(
            DoctorSeverity::Error,
            "audit_orphan",
            record.record_type,
            Some(record.id.clone()),
            "current record has a terminal purge audit".to_string(),
        ));
    } else if latest.after.as_ref() != Some(&record.snapshot) {
        issues.push(issue(
            DoctorSeverity::Error,
            "audit_snapshot_mismatch",
            record.record_type,
            Some(record.id.clone()),
            "latest audit snapshot does not match the durable record".to_string(),
        ));
    }
}

fn transfer_snapshot_matches(snapshot: Option<&Value>, pair: &[&EntryRecord]) -> bool {
    let Some(snapshot) = snapshot else {
        return false;
    };
    let out = pair.iter().find(|entry| entry.entry_type == "transfer_out");
    let input = pair.iter().find(|entry| entry.entry_type == "transfer_in");
    match (out, input) {
        (Some(out), Some(input)) => {
            snapshot.get("transfer_group_id").and_then(Value::as_str)
                == out.transfer_group_id.as_deref()
                && snapshot.get("out_entry") == Some(&out.durable.snapshot)
                && snapshot.get("in_entry") == Some(&input.durable.snapshot)
        }
        _ => false,
    }
}

fn validate_operations(
    currencies: &BTreeMap<String, CurrencyRecord>,
    accounts: &BTreeMap<String, AccountRecord>,
    transfer_groups: &BTreeMap<String, Vec<&EntryRecord>>,
    audits: &[AuditRecord],
    operations: &[OperationRecord],
    issues: &mut Vec<DoctorIssue>,
) {
    let mut create_audits = BTreeMap::<String, Vec<&AuditRecord>>::new();
    for audit in audits
        .iter()
        .filter(|audit| audit.record_type == "transfer" && audit.action == "create")
    {
        create_audits
            .entry(audit.record_id.clone())
            .or_default()
            .push(audit);
    }
    let mut operations_by_group = BTreeMap::<String, Vec<&OperationRecord>>::new();
    for operation in operations {
        let Some(payload) = operation.payload.as_ref() else {
            continue;
        };
        let Some(result) = operation.result.as_ref() else {
            continue;
        };
        if !exact_keys(
            payload,
            &[
                "date",
                "written_at",
                "content",
                "from_account",
                "to_account",
                "amount",
                "currency",
                "source",
                "notes",
                "actor",
            ],
        ) {
            operation_issue(
                issues,
                &operation.operation_key,
                "operation payload does not have the canonical field set",
            );
        }
        if !exact_keys(
            result,
            &["transfer_group_id", "out_entry_id", "in_entry_id"],
        ) {
            operation_issue(
                issues,
                &operation.operation_key,
                "operation result does not have the canonical field set",
            );
        }
        let Some(group_id) = json_string(result, "transfer_group_id") else {
            operation_issue(
                issues,
                &operation.operation_key,
                "operation result has no transfer group ID",
            );
            continue;
        };
        operations_by_group
            .entry(group_id.to_string())
            .or_default()
            .push(operation);
        let pair = transfer_groups.get(group_id).map_or(&[][..], Vec::as_slice);
        let Some(out) = pair.iter().find(|entry| entry.entry_type == "transfer_out") else {
            operation_issue(
                issues,
                &operation.operation_key,
                "operation result has no persisted transfer-out entry",
            );
            continue;
        };
        let Some(input) = pair.iter().find(|entry| entry.entry_type == "transfer_in") else {
            operation_issue(
                issues,
                &operation.operation_key,
                "operation result has no persisted transfer-in entry",
            );
            continue;
        };
        if json_string(result, "out_entry_id") != Some(out.durable.id.as_str())
            || json_string(result, "in_entry_id") != Some(input.durable.id.as_str())
        {
            operation_issue(
                issues,
                &operation.operation_key,
                "operation result does not identify its persisted pair",
            );
        }
        let group_audits = create_audits.get(group_id).map_or(&[][..], Vec::as_slice);
        if group_audits.len() != 1 {
            operation_issue(
                issues,
                &operation.operation_key,
                "operation does not have exactly one transfer create audit",
            );
            continue;
        }
        let audit = group_audits[0];
        if audit
            .after
            .as_ref()
            .and_then(|after| after.get("operation_id"))
            .and_then(Value::as_str)
            != Some(operation.operation_key.as_str())
        {
            operation_issue(
                issues,
                &operation.operation_key,
                "transfer create audit does not identify the operation",
            );
        }
        if json_string(payload, "actor") != Some(audit.actor.as_str()) {
            operation_issue(
                issues,
                &operation.operation_key,
                "operation actor does not match the create audit",
            );
        }
        validate_operation_payload(operation, payload, out, input, currencies, accounts, issues);
        if let Some(after) = audit.after.as_ref().and_then(Value::as_object) {
            if !exact_keys(
                after,
                &["operation_id", "transfer_group_id", "out_entry", "in_entry"],
            ) || after.get("transfer_group_id").and_then(Value::as_str) != Some(group_id)
                || after
                    .get("out_entry")
                    .and_then(|entry| entry.get("id"))
                    .and_then(Value::as_str)
                    != Some(out.durable.id.as_str())
                || after
                    .get("in_entry")
                    .and_then(|entry| entry.get("id"))
                    .and_then(Value::as_str)
                    != Some(input.durable.id.as_str())
            {
                operation_issue(
                    issues,
                    &operation.operation_key,
                    "transfer create audit does not exactly match the operation result",
                );
            }
        }
    }

    for group in transfer_groups.keys() {
        let count = operations_by_group.get(group).map_or(0, Vec::len);
        if count != 1 {
            issues.push(issue(
                DoctorSeverity::Error,
                "transfer_operation_count_invalid",
                "transfer",
                Some(group.clone()),
                format!("persisted transfer pair has {count} operations"),
            ));
        }
        let audit_count = create_audits.get(group).map_or(0, Vec::len);
        if audit_count != 1 {
            issues.push(issue(
                DoctorSeverity::Error,
                "transfer_create_audit_count_invalid",
                "transfer",
                Some(group.clone()),
                format!("persisted transfer pair has {audit_count} create audits"),
            ));
        }
    }
    for (group, group_audits) in create_audits {
        if !transfer_groups.contains_key(&group)
            && group_audits.iter().all(|audit| audit.action != "purge")
        {
            issues.push(issue(
                DoctorSeverity::Error,
                "transfer_create_audit_orphan",
                "transfer",
                Some(group),
                "transfer create audit has no persisted pair".to_string(),
            ));
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_operation_payload(
    operation: &OperationRecord,
    payload: &Map<String, Value>,
    out: &EntryRecord,
    input: &EntryRecord,
    currencies: &BTreeMap<String, CurrencyRecord>,
    accounts: &BTreeMap<String, AccountRecord>,
    issues: &mut Vec<DoctorIssue>,
) {
    let scalar_match = json_string(payload, "date") == Some(out.date.as_str())
        && json_string(payload, "written_at") == Some(out.written_at.as_str())
        && json_string(payload, "content") == Some(out.content.as_str())
        && payload.get("amount").and_then(Value::as_i64) == Some(out.amount_minor)
        && json_string(payload, "source") == Some(out.source.as_str())
        && payload.get("notes")
            == Some(
                &out.notes
                    .as_ref()
                    .map_or(Value::Null, |notes| Value::String(notes.clone())),
            );
    let from_matches = json_string(payload, "from_account").is_some_and(|reference| {
        reference == out.account_id
            || accounts
                .get(&out.account_id)
                .is_some_and(|account| reference == account.name)
    });
    let to_matches = json_string(payload, "to_account").is_some_and(|reference| {
        reference == input.account_id
            || accounts
                .get(&input.account_id)
                .is_some_and(|account| reference == account.name)
    });
    let currency_matches = json_string(payload, "currency").is_some_and(|reference| {
        reference == out.currency_id
            || currencies
                .get(&out.currency_id)
                .is_some_and(|currency| reference == currency.code || reference == currency.name)
    });
    if !scalar_match || !from_matches || !to_matches || !currency_matches {
        operation_issue(
            issues,
            &operation.operation_key,
            "operation payload does not match the persisted pair",
        );
    }
}

fn exact_keys(object: &Map<String, Value>, expected: &[&str]) -> bool {
    let actual: BTreeSet<_> = object.keys().map(String::as_str).collect();
    let expected: BTreeSet<_> = expected.iter().copied().collect();
    actual == expected
}

fn json_string<'value>(object: &'value Map<String, Value>, field: &str) -> Option<&'value str> {
    object.get(field).and_then(Value::as_str)
}

fn required_json_object(
    row: &DiagnosticRow,
    field: &str,
    operation_key: &str,
    issues: &mut Vec<DoctorIssue>,
) -> Option<Map<String, Value>> {
    let text = required_text(row, field, "transfer_operation", operation_key, issues)?;
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(object)) => Some(object),
        _ => {
            operation_issue(
                issues,
                operation_key,
                &format!("{field} is not a JSON object"),
            );
            None
        }
    }
}

fn optional_json(
    row: &DiagnosticRow,
    field: &str,
    audit_id: &str,
    issues: &mut Vec<DoctorIssue>,
) -> Option<Value> {
    match row.values.get(field) {
        Some(DiagnosticValue::Null) | None => None,
        Some(DiagnosticValue::Text {
            value: Some(value), ..
        }) => match serde_json::from_str(value) {
            Ok(value) => Some(value),
            Err(_) => {
                issues.push(issue(
                    DoctorSeverity::Error,
                    "audit_json_invalid",
                    "audit_event",
                    Some(audit_id.to_string()),
                    format!("{field} is not valid JSON"),
                ));
                None
            }
        },
        Some(value) => {
            storage_class_issue(
                issues,
                "audit_event",
                audit_id,
                field,
                "text or null",
                value,
            );
            None
        }
    }
}

fn required_text(
    row: &DiagnosticRow,
    field: &str,
    record_type: &str,
    record_id: &str,
    issues: &mut Vec<DoctorIssue>,
) -> Option<String> {
    match row.values.get(field) {
        Some(DiagnosticValue::Text {
            value: Some(value), ..
        }) if !value.trim().is_empty() => Some(value.clone()),
        Some(DiagnosticValue::Text { value: None, .. }) => {
            issues.push(issue(
                DoctorSeverity::Error,
                "text_encoding_invalid",
                record_type,
                Some(record_id.to_string()),
                format!("{field} is not valid UTF-8"),
            ));
            None
        }
        Some(DiagnosticValue::Text { value: Some(_), .. }) => {
            invariant_issue(
                issues,
                record_type,
                record_id,
                &format!("{field} must not be blank"),
            );
            None
        }
        Some(value) => {
            storage_class_issue(issues, record_type, record_id, field, "text", value);
            None
        }
        None => {
            invariant_issue(
                issues,
                record_type,
                record_id,
                &format!("{field} is missing"),
            );
            None
        }
    }
}

fn optional_text(
    row: &DiagnosticRow,
    field: &str,
    record_type: &str,
    record_id: &str,
    issues: &mut Vec<DoctorIssue>,
) -> Option<String> {
    match row.values.get(field) {
        Some(DiagnosticValue::Null) | None => None,
        Some(DiagnosticValue::Text {
            value: Some(value), ..
        }) if !value.trim().is_empty() => Some(value.clone()),
        Some(DiagnosticValue::Text { value: None, .. }) => {
            issues.push(issue(
                DoctorSeverity::Error,
                "text_encoding_invalid",
                record_type,
                Some(record_id.to_string()),
                format!("{field} is not valid UTF-8"),
            ));
            None
        }
        Some(DiagnosticValue::Text { value: Some(_), .. }) => {
            invariant_issue(
                issues,
                record_type,
                record_id,
                &format!("{field} must be null or non-blank"),
            );
            None
        }
        Some(value) => {
            storage_class_issue(issues, record_type, record_id, field, "text or null", value);
            None
        }
    }
}

fn required_integer(
    row: &DiagnosticRow,
    field: &str,
    record_type: &str,
    record_id: &str,
    issues: &mut Vec<DoctorIssue>,
) -> Option<i64> {
    match row.values.get(field) {
        Some(DiagnosticValue::Integer(value)) => Some(*value),
        Some(value) => {
            storage_class_issue(issues, record_type, record_id, field, "integer", value);
            None
        }
        None => {
            invariant_issue(
                issues,
                record_type,
                record_id,
                &format!("{field} is missing"),
            );
            None
        }
    }
}

fn required_bool(
    row: &DiagnosticRow,
    field: &str,
    record_type: &str,
    record_id: &str,
    issues: &mut Vec<DoctorIssue>,
) -> Option<bool> {
    match required_integer(row, field, record_type, record_id, issues) {
        Some(0) => Some(false),
        Some(1) => Some(true),
        Some(_) => {
            invariant_issue(
                issues,
                record_type,
                record_id,
                &format!("{field} must be integer 0 or 1"),
            );
            None
        }
        None => None,
    }
}

fn timestamps(
    row: &DiagnosticRow,
    record_type: &str,
    record_id: &str,
    issues: &mut Vec<DoctorIssue>,
) {
    for field in ["created_at", "updated_at"] {
        if let Some(value) = required_text(row, field, record_type, record_id, issues) {
            if OffsetDateTime::parse(&value, &Rfc3339).is_err() {
                invariant_issue(
                    issues,
                    record_type,
                    record_id,
                    &format!("{field} is not RFC 3339"),
                );
            }
        }
    }
    if let Some(value) = optional_text(row, "deleted_at", record_type, record_id, issues) {
        if OffsetDateTime::parse(&value, &Rfc3339).is_err() {
            invariant_issue(issues, record_type, record_id, "deleted_at is not RFC 3339");
        }
    }
}

fn diagnostic_id(row: &DiagnosticRow, field: &str) -> String {
    match row.values.get(field) {
        Some(DiagnosticValue::Text {
            value: Some(value), ..
        }) if !value.is_empty() => value.clone(),
        _ => format!("rowid:{}", row.rowid),
    }
}

fn hierarchy_issues<'node>(
    record_type: &str,
    nodes: impl Iterator<Item = (&'node str, Option<&'node str>)>,
    issues: &mut Vec<DoctorIssue>,
) {
    let parents: BTreeMap<_, _> = nodes
        .map(|(id, parent)| (id.to_string(), parent.map(str::to_string)))
        .collect();
    for start in parents.keys() {
        let mut seen = BTreeSet::new();
        let mut current = Some(start.as_str());
        while let Some(id) = current {
            if !seen.insert(id.to_string()) {
                issues.push(issue(
                    DoctorSeverity::Error,
                    "hierarchy_cycle",
                    record_type,
                    Some(start.clone()),
                    format!("hierarchy cycle reaches {id}"),
                ));
                break;
            }
            current = parents.get(id).and_then(|parent| parent.as_deref());
        }
    }
}

fn database_issues(health: crate::application::ports::DatabaseHealth) -> Vec<DoctorIssue> {
    let mut issues = Vec::new();
    for message in health
        .integrity_messages
        .into_iter()
        .filter(|message| message != "ok")
    {
        issues.push(issue(
            DoctorSeverity::Error,
            "database_integrity",
            "database",
            None,
            message,
        ));
    }
    for violation in health.foreign_key_violations {
        issues.push(issue(
            DoctorSeverity::Error,
            "foreign_key_violation",
            &violation.table,
            violation.row_id.map(|row| row.to_string()),
            format!(
                "foreign key {} references missing {}",
                violation.foreign_key_index, violation.parent_table
            ),
        ));
    }
    if health.integrity_truncated || health.foreign_key_truncated {
        issues.push(issue(
            DoctorSeverity::Warning,
            "doctor_scan_truncated",
            "database",
            None,
            "database health issues exceeded the bounded diagnostic limit".to_string(),
        ));
    }
    issues
}

fn storage_class_issue(
    issues: &mut Vec<DoctorIssue>,
    record_type: &str,
    record_id: &str,
    field: &str,
    expected: &str,
    actual: &DiagnosticValue,
) {
    issues.push(issue(
        DoctorSeverity::Error,
        "storage_class_invalid",
        record_type,
        Some(record_id.to_string()),
        format!(
            "{field} must use SQLite {expected} storage, found {} ({} bytes)",
            storage_class(actual),
            actual.byte_len()
        ),
    ));
}

fn storage_class(value: &DiagnosticValue) -> &'static str {
    match value {
        DiagnosticValue::Null => "null",
        DiagnosticValue::Integer(_) => "integer",
        DiagnosticValue::Real(_) => "real",
        DiagnosticValue::Text { .. } => "text",
        DiagnosticValue::Blob { .. } => "blob",
    }
}

fn invariant_issue(
    issues: &mut Vec<DoctorIssue>,
    record_type: &str,
    record_id: &str,
    message: &str,
) {
    issues.push(issue(
        DoctorSeverity::Error,
        "record_invariant_invalid",
        record_type,
        Some(record_id.to_string()),
        message.to_string(),
    ));
}

fn orphan_issue(
    issues: &mut Vec<DoctorIssue>,
    record_type: &str,
    record_id: &str,
    message: String,
) {
    issues.push(issue(
        DoctorSeverity::Error,
        "orphan_reference",
        record_type,
        Some(record_id.to_string()),
        message,
    ));
}

fn transfer_issue(issues: &mut Vec<DoctorIssue>, record_id: Option<String>, message: &str) {
    issues.push(issue(
        DoctorSeverity::Error,
        "transfer_pair_invalid",
        "transfer",
        record_id,
        message.to_string(),
    ));
}

fn operation_issue(issues: &mut Vec<DoctorIssue>, operation_key: &str, message: &str) {
    issues.push(issue(
        DoctorSeverity::Error,
        "transfer_operation_invalid",
        "transfer_operation",
        Some(operation_key.to_string()),
        message.to_string(),
    ));
}

fn is_engine_uuid(value: &str) -> bool {
    Uuid::parse_str(value)
        .is_ok_and(|uuid| uuid.get_version() == Some(Version::Random) && uuid.to_string() == value)
}

fn validation(field: &'static str, message: &str) -> LedgerError {
    LedgerError::Validation {
        field,
        message: message.to_string(),
    }
}

fn issue(
    severity: DoctorSeverity,
    code: &str,
    record_type: &str,
    record_id: Option<String>,
    message: String,
) -> DoctorIssue {
    DoctorIssue {
        severity,
        code: code.to_string(),
        record_type: record_type.to_string(),
        record_id,
        message,
    }
}
