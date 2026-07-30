use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::Serialize;
use time::format_description::well_known::Rfc3339;
use time::{Date, OffsetDateTime, macros::format_description};
use uuid::{Uuid, Version};

use crate::application::error::LedgerResult;
use crate::application::ports::{
    AuditEvent, DiagnosticEntry, DiagnosticTransferOperation, LedgerRepository,
};
use crate::application::queries::{collect_pages, load_read_model};
use crate::application::service::LedgerService;

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
pub struct DoctorReport {
    pub healthy: bool,
    pub scanned_entries: usize,
    pub issues: Vec<DoctorIssue>,
}

impl<R: LedgerRepository> LedgerService<R> {
    /// Performs bounded read-only integrity diagnostics. It never repairs data.
    pub fn doctor(&self) -> LedgerResult<DoctorReport> {
        let health = self.repository.database_health()?;
        let entries = collect_pages(|page| self.repository.list_diagnostic_entries(page))?;
        let operations =
            collect_pages(|page| self.repository.list_diagnostic_transfer_operations(page))?;
        let audits = collect_pages(|page| self.repository.list_all_audit_events(page))?;
        let model = load_read_model(&self.repository, true)?;
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

        let currency_ids: HashSet<_> = model
            .currencies
            .iter()
            .map(|currency| currency.id())
            .collect();
        let account_category_ids: HashSet<_> = model
            .account_categories
            .iter()
            .map(|category| category.id())
            .collect();
        let account_ids: HashSet<_> = model.accounts.iter().map(|account| account.id()).collect();
        let transaction_category_ids: HashSet<_> = model
            .transaction_categories
            .iter()
            .map(|category| category.id())
            .collect();

        for account in &model.accounts {
            if !account_category_ids.contains(account.category_id()) {
                issues.push(issue(
                    DoctorSeverity::Error,
                    "orphan_reference",
                    "account",
                    Some(account.id().to_string()),
                    format!("account category {} does not exist", account.category_id()),
                ));
            }
            if !currency_ids.contains(account.currency_id()) {
                issues.push(issue(
                    DoctorSeverity::Error,
                    "orphan_reference",
                    "account",
                    Some(account.id().to_string()),
                    format!("currency {} does not exist", account.currency_id()),
                ));
            }
        }
        for entry in &entries {
            validate_raw_entry(entry, &mut issues);
            if !account_ids.contains(entry.account_id.as_str()) {
                issues.push(issue(
                    DoctorSeverity::Error,
                    "orphan_reference",
                    "ledger_entry",
                    Some(entry.id.clone()),
                    format!("account {} does not exist", entry.account_id),
                ));
            }
            if !currency_ids.contains(entry.currency_id.as_str()) {
                issues.push(issue(
                    DoctorSeverity::Error,
                    "orphan_reference",
                    "ledger_entry",
                    Some(entry.id.clone()),
                    format!("currency {} does not exist", entry.currency_id),
                ));
            }
            if entry
                .transaction_category_id
                .as_deref()
                .is_some_and(|id| !transaction_category_ids.contains(id))
            {
                issues.push(issue(
                    DoctorSeverity::Error,
                    "orphan_reference",
                    "ledger_entry",
                    Some(entry.id.clone()),
                    format!(
                        "transaction category {} does not exist",
                        entry
                            .transaction_category_id
                            .as_deref()
                            .expect("checked category")
                    ),
                ));
            }
        }

        hierarchy_issues(
            "account_category",
            model
                .account_categories
                .iter()
                .map(|category| (category.id(), category.parent_id())),
            &mut issues,
        );
        hierarchy_issues(
            "transaction_category",
            model
                .transaction_categories
                .iter()
                .map(|category| (category.id(), category.parent_id())),
            &mut issues,
        );
        transfer_issues(&entries, &mut issues);
        transfer_operation_issues(&operations, &entries, &audits, &mut issues);

        issues.sort();
        issues.dedup();
        Ok(DoctorReport {
            healthy: issues.is_empty(),
            scanned_entries: entries.len(),
            issues,
        })
    }
}

fn transfer_operation_issues(
    operations: &[DiagnosticTransferOperation],
    entries: &[DiagnosticEntry],
    audits: &[AuditEvent],
    issues: &mut Vec<DoctorIssue>,
) {
    let mut entries_by_group = BTreeMap::<&str, Vec<&DiagnosticEntry>>::new();
    for entry in entries {
        if let Some(group) = entry.transfer_group_id.as_deref() {
            entries_by_group.entry(group).or_default().push(entry);
        }
    }
    let mut create_audits_by_group = BTreeMap::<&str, Vec<&AuditEvent>>::new();
    for audit in audits
        .iter()
        .filter(|audit| audit.record_type == "transfer" && audit.action == "create")
    {
        create_audits_by_group
            .entry(audit.record_id.as_str())
            .or_default()
            .push(audit);
    }
    for operation in operations {
        let invalid =
            operation_invalid_reason(operation, &entries_by_group, &create_audits_by_group);
        if let Some(message) = invalid {
            issues.push(issue(
                DoctorSeverity::Error,
                "transfer_operation_invalid",
                "transfer_operation",
                Some(operation.operation_key.clone()),
                message,
            ));
        }
    }
}

fn operation_invalid_reason(
    operation: &DiagnosticTransferOperation,
    entries_by_group: &BTreeMap<&str, Vec<&DiagnosticEntry>>,
    create_audits_by_group: &BTreeMap<&str, Vec<&AuditEvent>>,
) -> Option<String> {
    if !is_engine_uuid(&operation.operation_key) {
        return Some("operation key is not a canonical UUID v4".to_string());
    }
    let payload = match serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(
        &operation.payload_json,
    ) {
        Ok(payload) => payload,
        Err(_) => return Some("operation payload is not a JSON object".to_string()),
    };
    for field in [
        "date",
        "written_at",
        "content",
        "from_account",
        "to_account",
        "currency",
        "source",
        "actor",
    ] {
        if payload
            .get(field)
            .and_then(|value| value.as_str())
            .is_none_or(|value| value.trim().is_empty())
        {
            return Some(format!("operation payload has no valid {field}"));
        }
    }
    if payload
        .get("amount")
        .and_then(|value| value.as_i64())
        .is_none_or(|value| value <= 0)
    {
        return Some("operation payload has no positive minor-unit amount".to_string());
    }
    if payload
        .get("notes")
        .is_some_and(|value| !value.is_null() && !value.is_string())
    {
        return Some("operation payload notes are malformed".to_string());
    }
    let result = match serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(
        &operation.result_json,
    ) {
        Ok(result) => result,
        Err(_) => return Some("operation result is not a JSON object".to_string()),
    };
    let Some(group_id) = result
        .get("transfer_group_id")
        .and_then(|value| value.as_str())
    else {
        return Some("operation result has no transfer group ID".to_string());
    };
    let Some(out_id) = result.get("out_entry_id").and_then(|value| value.as_str()) else {
        return Some("operation result has no out entry ID".to_string());
    };
    let Some(in_id) = result.get("in_entry_id").and_then(|value| value.as_str()) else {
        return Some("operation result has no in entry ID".to_string());
    };
    if !is_engine_uuid(group_id) || !is_engine_uuid(out_id) || !is_engine_uuid(in_id) {
        return Some("operation result contains a non-engine identity".to_string());
    }
    let group_rows = entries_by_group
        .get(group_id)
        .map_or(&[][..], Vec::as_slice);
    if group_rows.len() != 2
        || !group_rows
            .iter()
            .any(|entry| entry.id == out_id && entry.entry_type == "transfer_out")
        || !group_rows
            .iter()
            .any(|entry| entry.id == in_id && entry.entry_type == "transfer_in")
    {
        return Some("operation result does not identify its persisted pair".to_string());
    }
    let create_audits = create_audits_by_group
        .get(group_id)
        .map_or(&[][..], Vec::as_slice);
    if create_audits.len() != 1 {
        return Some("operation does not have exactly one transfer create audit".to_string());
    }
    let after = create_audits[0].after.as_ref();
    if after
        .and_then(|value| value.get("operation_id"))
        .and_then(|value| value.as_str())
        != Some(operation.operation_key.as_str())
    {
        return Some("transfer create audit does not identify the operation".to_string());
    }
    if after
        .and_then(|value| value.get("transfer_group_id"))
        .and_then(|value| value.as_str())
        != Some(group_id)
        || after
            .and_then(|value| value.get("out_entry"))
            .and_then(|value| value.get("id"))
            .and_then(|value| value.as_str())
            != Some(out_id)
        || after
            .and_then(|value| value.get("in_entry"))
            .and_then(|value| value.get("id"))
            .and_then(|value| value.as_str())
            != Some(in_id)
    {
        return Some("transfer create audit does not match the operation result".to_string());
    }
    None
}

fn validate_raw_entry(entry: &DiagnosticEntry, issues: &mut Vec<DoctorIssue>) {
    if Date::parse(
        entry.date.trim(),
        format_description!("[year]-[month]-[day]"),
    )
    .is_err()
    {
        issues.push(issue(
            DoctorSeverity::Error,
            "entry_date_invalid",
            "ledger_entry",
            Some(entry.id.clone()),
            "entry date is not a valid ISO calendar date".to_string(),
        ));
    }
    for (field, value) in [
        ("written_at", entry.written_at.as_str()),
        ("created_at", entry.created_at.as_str()),
        ("updated_at", entry.updated_at.as_str()),
    ]
    .into_iter()
    .chain(
        entry
            .deleted_at
            .as_deref()
            .map(|value| ("deleted_at", value)),
    ) {
        if OffsetDateTime::parse(value, &Rfc3339).is_err() {
            issues.push(issue(
                DoctorSeverity::Error,
                "entry_timestamp_invalid",
                "ledger_entry",
                Some(entry.id.clone()),
                format!("{field} is not RFC 3339"),
            ));
        }
    }
    if entry.amount_minor <= 0 {
        issues.push(issue(
            DoctorSeverity::Error,
            "entry_amount_invalid",
            "ledger_entry",
            Some(entry.id.clone()),
            "entry amount must be positive minor units".to_string(),
        ));
    }
    if !matches!(
        entry.entry_type.as_str(),
        "expense" | "income" | "transfer_out" | "transfer_in" | "adjustment_out" | "adjustment_in"
    ) {
        issues.push(issue(
            DoctorSeverity::Error,
            "entry_type_invalid",
            "ledger_entry",
            Some(entry.id.clone()),
            format!("unknown entry type {}", entry.entry_type),
        ));
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

fn transfer_issues(entries: &[DiagnosticEntry], issues: &mut Vec<DoctorIssue>) {
    let mut groups = BTreeMap::<String, Vec<&DiagnosticEntry>>::new();
    for entry in entries {
        let transfer_type = matches!(entry.entry_type.as_str(), "transfer_out" | "transfer_in");
        match (transfer_type, entry.transfer_group_id.as_deref()) {
            (true, Some(group)) => groups.entry(group.to_string()).or_default().push(entry),
            (true, None) => issues.push(transfer_issue(
                Some(entry.id.clone()),
                "transfer entry has no group",
            )),
            (false, Some(group)) => issues.push(transfer_issue(
                Some(group.to_string()),
                "non-transfer entry has a transfer group",
            )),
            (false, None) => {}
        }
    }
    for (group, rows) in groups {
        if let Some(message) = invalid_transfer_group(&group, &rows) {
            issues.push(transfer_issue(Some(group), message));
        }
    }
}

fn invalid_transfer_group(group: &str, entries: &[&DiagnosticEntry]) -> Option<&'static str> {
    if !is_engine_uuid(group) {
        return Some("group identity is not a canonical UUID v4");
    }
    if entries.len() != 2 {
        return Some("group must contain exactly two entries");
    }
    if entries
        .iter()
        .any(|entry| entry.transfer_group_id.as_deref() != Some(group))
    {
        return Some("group identity does not match");
    }
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
    let first = entries[0];
    let second = entries[1];
    if !is_engine_uuid(&first.id) || !is_engine_uuid(&second.id) {
        return Some("entry identity is not a canonical UUID v4");
    }
    if first.id == second.id || first.account_id == second.account_id {
        return Some("paired entries must use distinct identities and accounts");
    }
    if first.amount_minor != second.amount_minor
        || first.currency_id != second.currency_id
        || first.date != second.date
        || first.written_at != second.written_at
        || first.content != second.content
        || first.source != second.source
        || first.notes != second.notes
        || first.transaction_category_id.is_some()
        || second.transaction_category_id.is_some()
        || first.created_at != second.created_at
        || first.updated_at != second.updated_at
        || first.deleted_at != second.deleted_at
    {
        return Some("paired entries have incompatible transfer fields");
    }
    None
}

fn is_engine_uuid(value: &str) -> bool {
    Uuid::parse_str(value)
        .is_ok_and(|uuid| uuid.get_version() == Some(Version::Random) && uuid.to_string() == value)
}

fn transfer_issue(record_id: Option<String>, message: &str) -> DoctorIssue {
    issue(
        DoctorSeverity::Error,
        "transfer_pair_invalid",
        "transfer",
        record_id,
        message.to_string(),
    )
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
