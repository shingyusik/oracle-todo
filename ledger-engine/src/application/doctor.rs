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
/// Conservative ceiling for compact indexes plus one transient decoded JSON value.
pub const DOCTOR_SCAN_HEAP_MULTIPLIER: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DoctorOptions {
    pub max_records: usize,
    /// Maximum raw SQLite bytes admitted to the diagnostic scan.
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
    pub cursor: Option<i64>,
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
        options
            .max_bytes
            .checked_mul(DOCTOR_SCAN_HEAP_MULTIPLIER)
            .ok_or_else(|| {
                validation(
                    "max_bytes",
                    "doctor byte limit exceeds the supported heap ceiling",
                )
            })?;

        let health = self.repository.database_health()?;
        let mut issues = database_issues(health);
        let mut state = DoctorState::default();
        let mut complete_tables = BTreeSet::new();
        let mut scans = Vec::new();
        let mut remaining_records = options.max_records;
        let mut remaining_bytes = options.max_bytes;
        let mut total_records = 0_usize;
        let mut total_bytes = 0_usize;

        for table in DiagnosticTable::ALL {
            let mut cursor = None;
            let mut table_records = 0_usize;
            let mut table_bytes = 0_usize;
            let mut next_unscanned_rowid = None;
            let mut truncated = false;
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
                cursor = batch.next_cursor.or(cursor);
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
                state.ingest(table, &batch.rows, &mut issues);
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
                         last cursor {cursor:?}"
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
            if !truncated {
                complete_tables.insert(table);
            }
        }

        if complete_tables.len() != DiagnosticTable::ALL.len() {
            issues.push(issue(
                DoctorSeverity::Warning,
                "doctor_coverage_incomplete",
                "database",
                None,
                "cross-table and audit conclusions were skipped where scan coverage was incomplete"
                    .to_string(),
            ));
        }
        validate_state(&state, &complete_tables, &mut issues);
        issues.sort();
        issues.dedup();
        let scanned_entries = scans
            .iter()
            .find(|scan| scan.table == DiagnosticTable::LedgerEntries.name())
            .map_or(0, |scan| scan.scanned_records);
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
}

#[derive(Debug, Clone)]
struct CategoryRecord {
    durable: DurableRecord,
    parent_id: Option<String>,
    kind: Option<String>,
}

#[derive(Debug, Clone)]
struct CurrencyRecord {
    durable: DurableRecord,
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
    before: Option<String>,
    after: Option<String>,
}

#[derive(Debug, Clone)]
struct OperationRecord {
    operation_key: String,
    payload: Option<String>,
    result: Option<String>,
}

#[derive(Debug, Default)]
struct DoctorState {
    currencies: BTreeMap<String, CurrencyRecord>,
    account_categories: BTreeMap<String, CategoryRecord>,
    accounts: BTreeMap<String, AccountRecord>,
    transaction_categories: BTreeMap<String, CategoryRecord>,
    entries: BTreeMap<String, EntryRecord>,
    audits: Vec<AuditRecord>,
    operations: Vec<OperationRecord>,
}

impl DoctorState {
    fn ingest(
        &mut self,
        table: DiagnosticTable,
        rows: &[DiagnosticRow],
        issues: &mut Vec<DoctorIssue>,
    ) {
        match table {
            DiagnosticTable::Currencies => {
                self.currencies.extend(parse_currencies(rows, issues));
            }
            DiagnosticTable::AccountCategories => {
                self.account_categories
                    .extend(parse_account_categories(rows, issues));
            }
            DiagnosticTable::Accounts => {
                self.accounts.extend(parse_accounts(rows, issues));
            }
            DiagnosticTable::TransactionCategories => {
                self.transaction_categories
                    .extend(parse_transaction_categories(rows, issues));
            }
            DiagnosticTable::LedgerEntries => {
                self.entries.extend(parse_entries(rows, issues));
            }
            DiagnosticTable::AuditEvents => self.audits.extend(parse_audits(rows, issues)),
            DiagnosticTable::TransferOperations => {
                self.operations.extend(parse_operations(rows, issues));
            }
        }
    }
}

fn validate_state(
    state: &DoctorState,
    complete: &BTreeSet<DiagnosticTable>,
    issues: &mut Vec<DoctorIssue>,
) {
    if tables_complete(
        complete,
        &[
            DiagnosticTable::Currencies,
            DiagnosticTable::AccountCategories,
            DiagnosticTable::Accounts,
            DiagnosticTable::TransactionCategories,
            DiagnosticTable::LedgerEntries,
        ],
    ) {
        validate_references(
            &state.currencies,
            &state.account_categories,
            &state.accounts,
            &state.transaction_categories,
            &state.entries,
            issues,
        );
        validate_entry_category_policy(&state.entries, &state.transaction_categories, issues);
    }
    if complete.contains(&DiagnosticTable::AccountCategories) {
        hierarchy_issues(
            "account_category",
            state
                .account_categories
                .values()
                .map(|record| (record.durable.id.as_str(), record.parent_id.as_deref())),
            issues,
        );
    }
    if complete.contains(&DiagnosticTable::TransactionCategories) {
        hierarchy_issues(
            "transaction_category",
            state
                .transaction_categories
                .values()
                .map(|record| (record.durable.id.as_str(), record.parent_id.as_deref())),
            issues,
        );
        hierarchy_kind_issues(&state.transaction_categories, issues);
    }
    let transfer_groups = if complete.contains(&DiagnosticTable::LedgerEntries) {
        validate_transfer_pairs(&state.entries, issues)
    } else {
        BTreeMap::new()
    };
    if tables_complete(
        complete,
        &[
            DiagnosticTable::Currencies,
            DiagnosticTable::AccountCategories,
            DiagnosticTable::Accounts,
            DiagnosticTable::TransactionCategories,
            DiagnosticTable::LedgerEntries,
            DiagnosticTable::AuditEvents,
        ],
    ) {
        validate_audits(
            &state.currencies,
            &state.account_categories,
            &state.accounts,
            &state.transaction_categories,
            &state.entries,
            &transfer_groups,
            &state.audits,
            issues,
        );
    }
    if tables_complete(
        complete,
        &[
            DiagnosticTable::Currencies,
            DiagnosticTable::Accounts,
            DiagnosticTable::LedgerEntries,
            DiagnosticTable::AuditEvents,
            DiagnosticTable::TransferOperations,
        ],
    ) {
        validate_operations(
            &state.currencies,
            &state.accounts,
            &transfer_groups,
            &state.audits,
            &state.operations,
            issues,
        );
    }
}

fn tables_complete(complete: &BTreeSet<DiagnosticTable>, required: &[DiagnosticTable]) -> bool {
    required.iter().all(|table| complete.contains(table))
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
                kind: None,
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
                kind: Some(kind),
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
        let before = optional_json_text(row, "before_json", &id, issues);
        let after = optional_json_text(row, "after_json", &id, issues);
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
        let payload = required_json_object_text(row, "payload_json", &operation_key, issues);
        let result = required_json_object_text(row, "result_json", &operation_key, issues);
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

fn validate_entry_category_policy(
    entries: &BTreeMap<String, EntryRecord>,
    categories: &BTreeMap<String, CategoryRecord>,
    issues: &mut Vec<DoctorIssue>,
) {
    for entry in entries.values() {
        let expected_kind = match entry.entry_type.as_str() {
            "expense" | "adjustment_out" => Some("expense"),
            "income" | "adjustment_in" => Some("income"),
            "transfer_out" | "transfer_in" => None,
            _ => continue,
        };
        let category_required = matches!(entry.entry_type.as_str(), "expense" | "income");
        let transfer = matches!(entry.entry_type.as_str(), "transfer_out" | "transfer_in");
        let category_kind = entry
            .category_id
            .as_deref()
            .and_then(|id| categories.get(id))
            .and_then(|category| category.kind.as_deref());
        let category_invalid = (category_required && entry.category_id.is_none())
            || (transfer && entry.category_id.is_some())
            || entry.category_id.is_some()
                && expected_kind.is_some()
                && category_kind != expected_kind;
        let group_invalid = (transfer && entry.transfer_group_id.is_none())
            || (!transfer && entry.transfer_group_id.is_some());
        if category_invalid || group_invalid {
            issues.push(issue(
                DoctorSeverity::Error,
                "entry_category_invalid",
                "ledger_entry",
                Some(entry.durable.id.clone()),
                "entry category kind/presence or transfer group shape violates service policy"
                    .to_string(),
            ));
        }
    }
}

fn hierarchy_kind_issues(
    categories: &BTreeMap<String, CategoryRecord>,
    issues: &mut Vec<DoctorIssue>,
) {
    for category in categories.values() {
        let Some(parent_id) = category.parent_id.as_deref() else {
            continue;
        };
        let Some(parent) = categories.get(parent_id) else {
            continue;
        };
        if category.kind != parent.kind {
            issues.push(issue(
                DoctorSeverity::Error,
                "hierarchy_kind_mismatch",
                "transaction_category",
                Some(category.durable.id.clone()),
                "parent category kind differs from child category kind".to_string(),
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
    if first.action != "create" {
        audit_transition_issue(first, "audit history must begin with create", issues);
    }
    let mut previous_after: Option<Value> = None;
    for (index, audit) in history.iter().enumerate() {
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
        if audit.action == "purge" && index + 1 != history.len() {
            audit_transition_issue(audit, "purge must be the terminal audit action", issues);
        }
        let before = audit.before.as_deref().map(validated_json);
        let after = audit.after.as_deref().map(validated_json);
        validate_audit_semantics(audit, before.as_ref(), after.as_ref(), issues);
        if let (Some(previous), Some(before)) = (previous_after.as_ref(), before.as_ref()) {
            if !audit_snapshots_equal(&audit.record_type, previous, before) {
                issues.push(issue(
                    DoctorSeverity::Error,
                    "audit_history_discontinuous",
                    &audit.record_type,
                    Some(audit.record_id.clone()),
                    "audit before snapshot does not match the prior after snapshot".to_string(),
                ));
            }
        }
        previous_after = after;
    }
}

enum AuditSemanticError {
    Snapshot(String),
    Transition(String),
}

fn validate_audit_semantics(
    audit: &AuditRecord,
    before: Option<&Value>,
    after: Option<&Value>,
    issues: &mut Vec<DoctorIssue>,
) {
    let result = match audit.record_type.as_str() {
        "currency" | "account_category" | "account" | "transaction_category" => {
            validate_master_audit(audit, before, after)
        }
        "ledger_entry" => validate_entry_audit(audit, before, after),
        "transfer" => validate_transfer_audit(audit, before, after),
        _ => Err(AuditSemanticError::Transition(format!(
            "record type {} has no supported audit lifecycle",
            audit.record_type
        ))),
    };
    match result {
        Ok(()) => {}
        Err(AuditSemanticError::Snapshot(message)) => {
            issues.push(issue(
                DoctorSeverity::Error,
                "audit_snapshot_invalid",
                "audit_event",
                Some(audit.id.clone()),
                message,
            ));
        }
        Err(AuditSemanticError::Transition(message)) => {
            audit_transition_issue(audit, &message, issues);
        }
    }
}

fn validate_master_audit(
    audit: &AuditRecord,
    before: Option<&Value>,
    after: Option<&Value>,
) -> Result<(), AuditSemanticError> {
    if !matches!(audit.action.as_str(), "create" | "update" | "purge") {
        return Err(AuditSemanticError::Transition(format!(
            "master record action {} is not allowed",
            audit.action
        )));
    }
    for snapshot in before.into_iter().chain(after) {
        let object = snapshot_object(snapshot, "master audit snapshot")?;
        if object.get("id").and_then(Value::as_str) != Some(audit.record_id.as_str()) {
            return Err(AuditSemanticError::Snapshot(
                "master audit snapshot ID does not match record_id".to_string(),
            ));
        }
    }
    Ok(())
}

#[derive(Clone)]
struct EntryAuditState {
    id: String,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    deleted_at: Option<OffsetDateTime>,
}

fn validate_entry_audit(
    audit: &AuditRecord,
    before: Option<&Value>,
    after: Option<&Value>,
) -> Result<(), AuditSemanticError> {
    if !matches!(
        audit.action.as_str(),
        "create" | "update" | "archive" | "restore" | "purge"
    ) {
        return Err(AuditSemanticError::Transition(format!(
            "ledger_entry action {} is not allowed",
            audit.action
        )));
    }
    let before_state = before
        .map(|snapshot| parse_entry_audit_state(snapshot, Some(&audit.record_id)))
        .transpose()?;
    let after_state = after
        .map(|snapshot| parse_entry_audit_state(snapshot, Some(&audit.record_id)))
        .transpose()?;
    match (
        audit.action.as_str(),
        before,
        before_state.as_ref(),
        after,
        after_state.as_ref(),
    ) {
        ("create", _, _, Some(_), Some(after)) => {
            if after.deleted_at.is_some() || after.created_at != after.updated_at {
                return Err(AuditSemanticError::Transition(
                    "ledger_entry create must produce an active snapshot with equal created_at \
                     and updated_at"
                        .to_string(),
                ));
            }
        }
        ("update", Some(_), Some(before), Some(_), Some(after)) => {
            if before.deleted_at.is_some()
                || after.deleted_at.is_some()
                || before.id != after.id
                || before.created_at != after.created_at
                || before.updated_at == after.updated_at
            {
                return Err(AuditSemanticError::Transition(
                    "ledger_entry update requires active snapshots, stable id/created_at, and \
                     a changed updated_at"
                        .to_string(),
                ));
            }
        }
        ("archive", Some(before_value), Some(before), Some(after_value), Some(after)) => {
            if before.deleted_at.is_some()
                || after.deleted_at != Some(after.updated_at)
                || before.updated_at == after.updated_at
                || !entry_lifecycle_payload_equal(before_value, after_value)
            {
                return Err(AuditSemanticError::Transition(
                    "ledger_entry archive must change deleted_at from null to updated_at and \
                     update only lifecycle fields"
                        .to_string(),
                ));
            }
        }
        ("restore", Some(before_value), Some(before), Some(after_value), Some(after)) => {
            if before.deleted_at.is_none()
                || after.deleted_at.is_some()
                || before.updated_at == after.updated_at
                || !entry_lifecycle_payload_equal(before_value, after_value)
            {
                return Err(AuditSemanticError::Transition(
                    "ledger_entry restore must change deleted_at from a timestamp to null and \
                     update only lifecycle fields"
                        .to_string(),
                ));
            }
        }
        ("purge", Some(_), Some(_), _, _) => {}
        _ => {}
    }
    Ok(())
}

fn validate_transfer_audit(
    audit: &AuditRecord,
    before: Option<&Value>,
    after: Option<&Value>,
) -> Result<(), AuditSemanticError> {
    if !matches!(
        audit.action.as_str(),
        "create" | "update" | "archive" | "restore" | "purge"
    ) {
        return Err(AuditSemanticError::Transition(format!(
            "transfer action {} is not allowed",
            audit.action
        )));
    }
    let before_state = before
        .map(|snapshot| parse_transfer_audit_state(snapshot, &audit.record_id))
        .transpose()?;
    let after_state = after
        .map(|snapshot| parse_transfer_audit_state(snapshot, &audit.record_id))
        .transpose()?;
    match (
        audit.action.as_str(),
        before,
        before_state.as_ref(),
        after,
        after_state.as_ref(),
    ) {
        ("create", _, _, Some(_), Some(after)) => {
            if !after.has_consistent_pair_state()
                || after.out.deleted_at.is_some()
                || after.out.created_at != after.out.updated_at
            {
                return Err(AuditSemanticError::Transition(
                    "transfer create must produce two active entries with matching lifecycle \
                     timestamps"
                        .to_string(),
                ));
            }
        }
        ("update", Some(before_value), Some(before), Some(after_value), Some(after)) => {
            if !before.has_consistent_pair_state()
                || !after.has_consistent_pair_state()
                || before.out.deleted_at.is_some()
                || after.out.deleted_at.is_some()
                || before.out.updated_at == after.out.updated_at
                || before.operation_id != after.operation_id
                || !transfer_update_immutable_payload_equal(before_value, after_value)
            {
                return Err(AuditSemanticError::Transition(
                    "transfer update must change both active entries together and preserve immutable fields"
                        .to_string(),
                ));
            }
        }
        ("archive", Some(before_value), Some(before), Some(after_value), Some(after)) => {
            if !before.has_consistent_pair_state()
                || !after.has_consistent_pair_state()
                || before.out.deleted_at.is_some()
                || after.out.deleted_at != Some(after.out.updated_at)
                || before.out.updated_at == after.out.updated_at
                || before.operation_id != after.operation_id
                || !transfer_lifecycle_payload_equal(before_value, after_value)
            {
                return Err(AuditSemanticError::Transition(
                    "transfer archive must move both entries from active to archived together and \
                     update only lifecycle fields"
                        .to_string(),
                ));
            }
        }
        ("restore", Some(before_value), Some(before), Some(after_value), Some(after)) => {
            if !before.has_consistent_pair_state()
                || !after.has_consistent_pair_state()
                || before.out.deleted_at.is_none()
                || after.out.deleted_at.is_some()
                || before.out.updated_at == after.out.updated_at
                || before.operation_id != after.operation_id
                || !transfer_lifecycle_payload_equal(before_value, after_value)
            {
                return Err(AuditSemanticError::Transition(
                    "transfer restore must move both entries from archived to active together and \
                     update only lifecycle fields"
                        .to_string(),
                ));
            }
        }
        ("purge", Some(_), Some(before), _, _) => {
            if !before.has_consistent_pair_state() {
                return Err(AuditSemanticError::Transition(
                    "transfer purge requires a lifecycle-consistent pair snapshot".to_string(),
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

#[derive(Clone)]
struct TransferAuditState {
    operation_id: String,
    out: EntryAuditState,
    input: EntryAuditState,
}

impl TransferAuditState {
    fn has_consistent_pair_state(&self) -> bool {
        self.out.id != self.input.id
            && self.out.created_at == self.input.created_at
            && self.out.updated_at == self.input.updated_at
            && self.out.deleted_at == self.input.deleted_at
    }
}

fn parse_transfer_audit_state(
    snapshot: &Value,
    record_id: &str,
) -> Result<TransferAuditState, AuditSemanticError> {
    let object = snapshot_object(snapshot, "transfer audit snapshot")?;
    let operation_id = required_snapshot_string(object, "operation_id", "transfer audit snapshot")?;
    if object.get("transfer_group_id").and_then(Value::as_str) != Some(record_id) {
        return Err(AuditSemanticError::Snapshot(
            "transfer audit snapshot group ID does not match record_id".to_string(),
        ));
    }
    let out_value = object
        .get("out_entry")
        .ok_or_else(|| snapshot_error("transfer audit snapshot has no out_entry"))?;
    let input_value = object
        .get("in_entry")
        .ok_or_else(|| snapshot_error("transfer audit snapshot has no in_entry"))?;
    let out = parse_entry_audit_state(out_value, None)?;
    let input = parse_entry_audit_state(input_value, None)?;
    if out_value.get("entry_type").and_then(Value::as_str) != Some("transfer_out")
        || input_value.get("entry_type").and_then(Value::as_str) != Some("transfer_in")
        || out_value.get("transfer_group_id").and_then(Value::as_str) != Some(record_id)
        || input_value.get("transfer_group_id").and_then(Value::as_str) != Some(record_id)
    {
        return Err(AuditSemanticError::Snapshot(
            "transfer audit entries do not identify the expected pair".to_string(),
        ));
    }
    Ok(TransferAuditState {
        operation_id,
        out,
        input,
    })
}

fn parse_entry_audit_state(
    snapshot: &Value,
    expected_id: Option<&str>,
) -> Result<EntryAuditState, AuditSemanticError> {
    let object = snapshot_object(snapshot, "ledger entry audit snapshot")?;
    let id = required_snapshot_string(object, "id", "ledger entry audit snapshot")?;
    if expected_id.is_some_and(|expected| id != expected) {
        return Err(AuditSemanticError::Snapshot(
            "ledger entry audit snapshot ID does not match record_id".to_string(),
        ));
    }
    let created_at = required_snapshot_time(object, "created_at")?;
    let updated_at = required_snapshot_time(object, "updated_at")?;
    let deleted_at = optional_snapshot_time(object, "deleted_at")?;
    Ok(EntryAuditState {
        id,
        created_at,
        updated_at,
        deleted_at,
    })
}

fn snapshot_object<'value>(
    snapshot: &'value Value,
    context: &str,
) -> Result<&'value Map<String, Value>, AuditSemanticError> {
    snapshot
        .as_object()
        .ok_or_else(|| snapshot_error(&format!("{context} is not an object")))
}

fn required_snapshot_string(
    object: &Map<String, Value>,
    field: &str,
    context: &str,
) -> Result<String, AuditSemanticError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| snapshot_error(&format!("{context} has no valid {field}")))
}

fn required_snapshot_time(
    object: &Map<String, Value>,
    field: &str,
) -> Result<OffsetDateTime, AuditSemanticError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())
        .ok_or_else(|| snapshot_error(&format!("audit snapshot has no valid {field}")))
}

fn optional_snapshot_time(
    object: &Map<String, Value>,
    field: &str,
) -> Result<Option<OffsetDateTime>, AuditSemanticError> {
    match object.get(field) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => OffsetDateTime::parse(value, &Rfc3339)
            .map(Some)
            .map_err(|_| snapshot_error(&format!("audit snapshot has invalid {field}"))),
        _ => Err(snapshot_error(&format!(
            "audit snapshot has no valid {field}"
        ))),
    }
}

fn entry_lifecycle_payload_equal(before: &Value, after: &Value) -> bool {
    lifecycle_payload(before, false) == lifecycle_payload(after, false)
}

fn transfer_lifecycle_payload_equal(before: &Value, after: &Value) -> bool {
    lifecycle_payload(before, true) == lifecycle_payload(after, true)
}

fn transfer_update_immutable_payload_equal(before: &Value, after: &Value) -> bool {
    transfer_update_immutable_payload(before) == transfer_update_immutable_payload(after)
}

fn transfer_update_immutable_payload(snapshot: &Value) -> Value {
    let mut snapshot = snapshot.clone();
    if let Some(object) = snapshot.as_object_mut() {
        object.remove("operation_id");
        for field in ["out_entry", "in_entry"] {
            if let Some(entry) = object.get_mut(field).and_then(Value::as_object_mut) {
                for mutable in [
                    "date",
                    "content",
                    "account_id",
                    "amount",
                    "currency_id",
                    "notes",
                    "updated_at",
                ] {
                    entry.remove(mutable);
                }
            }
        }
    }
    snapshot
}

fn lifecycle_payload(snapshot: &Value, transfer: bool) -> Value {
    let mut snapshot = snapshot.clone();
    if transfer {
        if let Some(object) = snapshot.as_object_mut() {
            object.remove("operation_id");
            for field in ["out_entry", "in_entry"] {
                if let Some(entry) = object.get_mut(field).and_then(Value::as_object_mut) {
                    entry.remove("updated_at");
                    entry.remove("deleted_at");
                }
            }
        }
    } else if let Some(object) = snapshot.as_object_mut() {
        object.remove("updated_at");
        object.remove("deleted_at");
    }
    snapshot
}

fn snapshot_error(message: &str) -> AuditSemanticError {
    AuditSemanticError::Snapshot(message.to_string())
}

fn audit_snapshots_equal(record_type: &str, left: &Value, right: &Value) -> bool {
    if record_type != "transfer" {
        return left == right;
    }
    let mut left = left.clone();
    let mut right = right.clone();
    if let Some(object) = left.as_object_mut() {
        object.remove("operation_id");
    }
    if let Some(object) = right.as_object_mut() {
        object.remove("operation_id");
    }
    left == right
}

fn audit_transition_issue(audit: &AuditRecord, message: &str, issues: &mut Vec<DoctorIssue>) {
    issues.push(issue(
        DoctorSeverity::Error,
        "audit_transition_invalid",
        &audit.record_type,
        Some(audit.record_id.clone()),
        message.to_string(),
    ));
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
    } else if latest.after.as_deref().map(validated_json).as_ref() != Some(&record.snapshot) {
        issues.push(issue(
            DoctorSeverity::Error,
            "audit_snapshot_mismatch",
            record.record_type,
            Some(record.id.clone()),
            "latest audit snapshot does not match the durable record".to_string(),
        ));
    }
}

fn transfer_snapshot_matches(snapshot: Option<&String>, pair: &[&EntryRecord]) -> bool {
    let Some(snapshot) = snapshot.map(|snapshot| validated_json(snapshot)) else {
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
    _currencies: &BTreeMap<String, CurrencyRecord>,
    _accounts: &BTreeMap<String, AccountRecord>,
    transfer_groups: &BTreeMap<String, Vec<&EntryRecord>>,
    audits: &[AuditRecord],
    operations: &[OperationRecord],
    issues: &mut Vec<DoctorIssue>,
) {
    let mut create_audits = BTreeMap::<String, Vec<&AuditRecord>>::new();
    let mut transfer_histories = BTreeMap::<String, Vec<&AuditRecord>>::new();
    for audit in audits
        .iter()
        .filter(|audit| audit.record_type == "transfer")
    {
        transfer_histories
            .entry(audit.record_id.clone())
            .or_default()
            .push(audit);
        if audit.action == "create" {
            create_audits
                .entry(audit.record_id.clone())
                .or_default()
                .push(audit);
        }
    }
    for history in transfer_histories.values_mut() {
        history.sort_by(|left, right| {
            left.occurred_at
                .cmp(&right.occurred_at)
                .then_with(|| left.rowid.cmp(&right.rowid))
        });
    }
    let mut operations_by_group = BTreeMap::<String, Vec<&OperationRecord>>::new();
    for operation in operations {
        let Some(payload_raw) = operation.payload.as_ref() else {
            continue;
        };
        let Some(result_raw) = operation.result.as_ref() else {
            continue;
        };
        let payload_value = validated_json(payload_raw);
        let result_value = validated_json(result_raw);
        let payload = payload_value
            .as_object()
            .expect("validated transfer payload is an object");
        let result = result_value
            .as_object()
            .expect("validated transfer result is an object");
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
        let Some(after_value) = audit.after.as_deref().map(validated_json) else {
            operation_issue(
                issues,
                &operation.operation_key,
                "transfer create audit has no object snapshot",
            );
            continue;
        };
        let Some(after) = after_value.as_object() else {
            operation_issue(
                issues,
                &operation.operation_key,
                "transfer create audit has no object snapshot",
            );
            continue;
        };
        if after.get("operation_id").and_then(Value::as_str)
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
        let out = after.get("out_entry");
        let input = after.get("in_entry");
        let snapshot_ids_match = out
            .and_then(|entry| entry.get("id"))
            .and_then(Value::as_str)
            == json_string(result, "out_entry_id")
            && input
                .and_then(|entry| entry.get("id"))
                .and_then(Value::as_str)
                == json_string(result, "in_entry_id");
        if !exact_keys(
            after,
            &["operation_id", "transfer_group_id", "out_entry", "in_entry"],
        ) || after.get("transfer_group_id").and_then(Value::as_str) != Some(group_id)
            || !snapshot_ids_match
        {
            operation_issue(
                issues,
                &operation.operation_key,
                "transfer create audit does not exactly match the operation result",
            );
        }
        if let (Some(out), Some(input)) = (out, input) {
            validate_operation_payload(operation, payload, out, input, audit, audits, issues);
        }

        if let Some(pair) = transfer_groups.get(group_id) {
            let current_ids: BTreeSet<_> =
                pair.iter().map(|entry| entry.durable.id.as_str()).collect();
            let result_ids: BTreeSet<_> = [
                json_string(result, "out_entry_id"),
                json_string(result, "in_entry_id"),
            ]
            .into_iter()
            .flatten()
            .collect();
            if current_ids != result_ids {
                operation_issue(
                    issues,
                    &operation.operation_key,
                    "operation result does not identify its persisted pair",
                );
            }
        } else if transfer_histories
            .get(group_id)
            .and_then(|history| history.last())
            .is_none_or(|audit| audit.action != "purge")
        {
            operation_issue(
                issues,
                &operation.operation_key,
                "operation has neither a persisted pair nor terminal purge history",
            );
        }
    }

    let groups: BTreeSet<_> = transfer_groups
        .keys()
        .chain(transfer_histories.keys())
        .cloned()
        .collect();
    for group in groups {
        let count = operations_by_group.get(&group).map_or(0, Vec::len);
        if count != 1 {
            issues.push(issue(
                DoctorSeverity::Error,
                "transfer_operation_count_invalid",
                "transfer",
                Some(group.clone()),
                format!("persisted transfer pair has {count} operations"),
            ));
        }
        let audit_count = create_audits.get(&group).map_or(0, Vec::len);
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
    for (group, _group_audits) in create_audits {
        if !transfer_groups.contains_key(&group)
            && transfer_histories
                .get(&group)
                .and_then(|history| history.last())
                .is_none_or(|audit| audit.action != "purge")
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
    out: &Value,
    input: &Value,
    create_audit: &AuditRecord,
    audits: &[AuditRecord],
    issues: &mut Vec<DoctorIssue>,
) {
    let scalar_match = json_string(payload, "date") == value_string(out, "date")
        && json_string(payload, "written_at") == value_string(out, "written_at")
        && json_string(payload, "content") == value_string(out, "content")
        && payload.get("amount").and_then(Value::as_i64)
            == out.get("amount").and_then(Value::as_i64)
        && json_string(payload, "source") == value_string(out, "source")
        && payload.get("notes") == out.get("notes");
    let from_matches = reference_matches_at_create(
        json_string(payload, "from_account"),
        "account",
        value_string(out, "account_id"),
        &["name"],
        create_audit,
        audits,
    );
    let to_matches = reference_matches_at_create(
        json_string(payload, "to_account"),
        "account",
        value_string(input, "account_id"),
        &["name"],
        create_audit,
        audits,
    );
    let currency_matches = reference_matches_at_create(
        json_string(payload, "currency"),
        "currency",
        value_string(out, "currency_id"),
        &["code", "name"],
        create_audit,
        audits,
    );
    if !scalar_match || !from_matches || !to_matches || !currency_matches {
        operation_issue(
            issues,
            &operation.operation_key,
            "operation payload does not match the persisted pair",
        );
    }
}

fn value_string<'value>(value: &'value Value, field: &str) -> Option<&'value str> {
    value.get(field).and_then(Value::as_str)
}

fn validated_json(value: &str) -> Value {
    serde_json::from_str(value).expect("doctor retains only validated JSON text")
}

fn reference_matches_at_create(
    reference: Option<&str>,
    record_type: &str,
    stable_id: Option<&str>,
    label_fields: &[&str],
    create_audit: &AuditRecord,
    audits: &[AuditRecord],
) -> bool {
    let (Some(reference), Some(stable_id)) = (reference, stable_id) else {
        return false;
    };
    if reference == stable_id {
        return true;
    }
    audits
        .iter()
        .filter(|audit| audit.record_type == record_type && audit.record_id == stable_id)
        .filter(|audit| {
            audit.occurred_at < create_audit.occurred_at
                || audit.occurred_at == create_audit.occurred_at && audit.rowid < create_audit.rowid
        })
        .max_by(|left, right| {
            left.occurred_at
                .cmp(&right.occurred_at)
                .then_with(|| left.rowid.cmp(&right.rowid))
        })
        .and_then(|audit| audit.after.as_deref())
        .map(validated_json)
        .is_some_and(|snapshot| {
            label_fields
                .iter()
                .any(|field| value_string(&snapshot, field) == Some(reference))
        })
}

fn exact_keys(object: &Map<String, Value>, expected: &[&str]) -> bool {
    let actual: BTreeSet<_> = object.keys().map(String::as_str).collect();
    let expected: BTreeSet<_> = expected.iter().copied().collect();
    actual == expected
}

fn json_string<'value>(object: &'value Map<String, Value>, field: &str) -> Option<&'value str> {
    object.get(field).and_then(Value::as_str)
}

fn required_json_object_text(
    row: &DiagnosticRow,
    field: &str,
    operation_key: &str,
    issues: &mut Vec<DoctorIssue>,
) -> Option<String> {
    let text = required_text(row, field, "transfer_operation", operation_key, issues)?;
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(_)) => Some(text),
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

fn optional_json_text(
    row: &DiagnosticRow,
    field: &str,
    audit_id: &str,
    issues: &mut Vec<DoctorIssue>,
) -> Option<String> {
    match row.values.get(field) {
        Some(DiagnosticValue::Null) | None => None,
        Some(DiagnosticValue::Text {
            value: Some(value), ..
        }) => match serde_json::from_str::<Value>(value) {
            Ok(_) => Some(value.clone()),
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
