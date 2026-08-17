use rusqlite::{
    Connection, OptionalExtension, Transaction, TransactionBehavior, params, params_from_iter,
    types::{Value, ValueRef},
};
use time::OffsetDateTime;

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{
    AccountBalanceRecord, AuditActivity, AuditEvent, CandidateMatch, DailyReportRecord,
    DatabaseHealth, DiagnosticBatch, DiagnosticRow, DiagnosticTable, DiagnosticValue, EntryQuery,
    EntryViewRecord, ForeignKeyViolation, LedgerExportSnapshot, LedgerMutationRepository,
    LedgerReadRepository, LedgerRepository, LedgerTransaction, Page, ReportAggregateRecord,
    StoredAuditEvent, StoredRecord, StoredTransferOperation, TransferOperationRecord,
};
use crate::domain::{
    Account, AccountCategory, Currency, LedgerEntry, TransactionCategory, TransactionCategoryKind,
};

use super::audit_json;
use super::mapping::{
    ACCOUNT_CATEGORY_COLUMNS, ACCOUNT_COLUMNS, AUDIT_COLUMNS, CURRENCY_COLUMNS, ENTRY_COLUMNS,
    TRANSACTION_CATEGORY_COLUMNS, format_time, parse_date, row_to_account, row_to_account_category,
    row_to_audit_event, row_to_currency, row_to_entry, row_to_transaction_category,
};
use super::{SqliteLedgerRepository, storage_error};

impl LedgerRepository for SqliteLedgerRepository {}

impl LedgerReadRepository for SqliteLedgerRepository {
    fn get_currency(&self, id: &str, include_archived: bool) -> LedgerResult<Option<Currency>> {
        get_currency_on(&self.connection, id, include_archived)
    }

    #[cfg(test)]
    fn get_account_category(
        &self,
        id: &str,
        include_archived: bool,
    ) -> LedgerResult<Option<AccountCategory>> {
        get_account_category_on(&self.connection, id, include_archived)
    }

    fn get_account(&self, id: &str, include_archived: bool) -> LedgerResult<Option<Account>> {
        get_account_on(&self.connection, id, include_archived)
    }

    fn get_transaction_category(
        &self,
        id: &str,
        include_archived: bool,
    ) -> LedgerResult<Option<TransactionCategory>> {
        get_transaction_category_on(&self.connection, id, include_archived)
    }

    fn list_active_currencies(&self, page: Page) -> LedgerResult<Vec<Currency>> {
        list_active_currencies_on(&self.connection, page)
    }

    fn list_active_account_categories(&self, page: Page) -> LedgerResult<Vec<AccountCategory>> {
        list_active_account_categories_on(&self.connection, page)
    }

    fn list_active_accounts(&self, page: Page) -> LedgerResult<Vec<Account>> {
        list_active_accounts_on(&self.connection, page)
    }

    fn list_active_transaction_categories(
        &self,
        page: Page,
    ) -> LedgerResult<Vec<TransactionCategory>> {
        list_active_transaction_categories_on(&self.connection, page)
    }

    #[cfg(test)]
    fn list_entries(&self, query: &EntryQuery) -> LedgerResult<Vec<LedgerEntry>> {
        let (where_clause, mut values) = entry_where_clause(query);
        values.push(Value::Integer(i64::from(query.limit)));
        let limit_parameter = values.len();
        values.push(Value::Integer(i64::from(query.offset)));
        let offset_parameter = values.len();
        let sql = format!(
            "SELECT {ENTRY_COLUMNS}
             FROM ledger_entries
             {where_clause}
             ORDER BY date, written_at, id
             LIMIT ?{limit_parameter} OFFSET ?{offset_parameter}"
        );
        collect_entries(&self.connection, &sql, params_from_iter(values.iter()))
    }

    #[cfg(test)]
    fn get_entry(&self, id: &str, include_archived: bool) -> LedgerResult<Option<LedgerEntry>> {
        let visibility = if include_archived {
            ""
        } else {
            "AND deleted_at IS NULL"
        };
        let sql = format!(
            "SELECT {ENTRY_COLUMNS}
             FROM ledger_entries
             WHERE id = ?1 {visibility}"
        );
        let mut entries = collect_entries(&self.connection, &sql, [id])?;
        Ok(entries.pop())
    }

    fn list_entry_view_records(&self, query: &EntryQuery) -> LedgerResult<Vec<EntryViewRecord>> {
        let (where_clause, mut values) = entry_where_clause(query);
        values.push(Value::Integer(i64::from(query.limit)));
        let limit_parameter = values.len();
        values.push(Value::Integer(i64::from(query.offset)));
        let offset_parameter = values.len();
        let sql = format!(
            "SELECT selected.*, a.name, tc.name, c.code
             FROM (
                 SELECT {ENTRY_COLUMNS}
                 FROM ledger_entries
                 {where_clause}
                 ORDER BY date, written_at, id
                 LIMIT ?{limit_parameter} OFFSET ?{offset_parameter}
             ) AS selected
             LEFT JOIN accounts AS a ON a.id = selected.account_id
             LEFT JOIN transaction_categories AS tc
                ON tc.id = selected.transaction_category_id
             LEFT JOIN currencies AS c ON c.id = selected.currency_id
             ORDER BY selected.date, selected.written_at, selected.id"
        );
        collect_rows(
            &self.connection,
            &sql,
            params_from_iter(values.iter()),
            row_to_entry_view_record,
        )
    }

    fn get_entry_view_record(
        &self,
        id: &str,
        include_archived: bool,
    ) -> LedgerResult<Option<EntryViewRecord>> {
        let visibility = if include_archived {
            ""
        } else {
            "AND e.deleted_at IS NULL"
        };
        let sql = format!(
            "SELECT e.id, e.date, e.written_at, e.content,
                    e.transaction_category_id, e.account_id, e.entry_type,
                    e.amount_minor, e.currency_id, e.transfer_group_id,
                    e.source, e.notes, e.created_at, e.updated_at, e.deleted_at,
                    a.name, tc.name, c.code
             FROM ledger_entries AS e
             LEFT JOIN accounts AS a ON a.id = e.account_id
             LEFT JOIN transaction_categories AS tc
                ON tc.id = e.transaction_category_id
             LEFT JOIN currencies AS c ON c.id = e.currency_id
             WHERE e.id = ?1 {visibility}"
        );
        let mut statement = self.connection.prepare(&sql).map_err(storage_error)?;
        let mut rows = statement.query([id]).map_err(storage_error)?;
        let value = rows
            .next()
            .map_err(storage_error)?
            .map(row_to_entry_view_record)
            .transpose()?;
        Ok(value)
    }

    fn account_by_name(
        &self,
        name: &str,
        include_archived: bool,
    ) -> LedgerResult<CandidateMatch<Account>> {
        candidate_master_by_value(
            &self.connection,
            "accounts",
            ACCOUNT_COLUMNS,
            "name",
            name,
            include_archived,
            row_to_account,
        )
    }

    fn transaction_category_by_name(
        &self,
        name: &str,
        include_archived: bool,
    ) -> LedgerResult<CandidateMatch<TransactionCategory>> {
        candidate_master_by_value(
            &self.connection,
            "transaction_categories",
            TRANSACTION_CATEGORY_COLUMNS,
            "name",
            name,
            include_archived,
            row_to_transaction_category,
        )
    }

    fn currency_by_code_or_name(
        &self,
        value: &str,
        include_archived: bool,
    ) -> LedgerResult<CandidateMatch<Currency>> {
        let visibility = if include_archived {
            ""
        } else {
            "AND deleted_at IS NULL"
        };
        candidate_query(
            &self.connection,
            &format!(
                "SELECT {CURRENCY_COLUMNS}
                 FROM currencies
                 WHERE (code = ?1 OR name = ?1) {visibility}
                 ORDER BY id
                 LIMIT 2"
            ),
            [value],
            row_to_currency,
        )
    }

    fn list_entries_by_transfer_group(
        &self,
        transfer_group_id: &str,
        include_archived: bool,
    ) -> LedgerResult<Vec<LedgerEntry>> {
        list_entries_by_transfer_group_on(&self.connection, transfer_group_id, include_archived)
    }

    fn list_account_balance_records(&self, page: Page) -> LedgerResult<Vec<AccountBalanceRecord>> {
        let sql = "SELECT
                a.id, a.name, a.account_category_id, a.currency_id,
                a.opening_balance_minor, a.active,
                c.code, c.decimal_places,
                COALESCE(SUM(CASE e.entry_type
                    WHEN 'expense' THEN -e.amount_minor
                    WHEN 'income' THEN e.amount_minor
                    WHEN 'transfer_out' THEN -e.amount_minor
                    WHEN 'transfer_in' THEN e.amount_minor
                    WHEN 'adjustment_out' THEN -e.amount_minor
                    WHEN 'adjustment_in' THEN e.amount_minor
                    ELSE 0
                END), 0),
                COALESCE(SUM(CASE
                    WHEN e.id IS NOT NULL AND e.currency_id <> a.currency_id THEN 1
                    ELSE 0
                END), 0)
             FROM accounts AS a
             JOIN currencies AS c ON c.id = a.currency_id
             LEFT JOIN ledger_entries AS e
                ON e.account_id = a.id AND e.deleted_at IS NULL
             WHERE a.active = 1 AND a.deleted_at IS NULL
             GROUP BY
                a.id, a.name, a.account_category_id, a.currency_id,
                a.opening_balance_minor, a.active, c.code, c.decimal_places
             ORDER BY a.name, a.id
             LIMIT ?1 OFFSET ?2";
        collect_rows(
            &self.connection,
            sql,
            page_params(page),
            row_to_account_balance_record,
        )
    }

    fn summarize_entries(
        &self,
        start: time::Date,
        end: time::Date,
    ) -> LedgerResult<Vec<ReportAggregateRecord>> {
        aggregate_entries(&self.connection, AggregateKind::Summary, start, end)
    }

    fn account_breakdown(
        &self,
        start: time::Date,
        end: time::Date,
    ) -> LedgerResult<Vec<ReportAggregateRecord>> {
        aggregate_entries(&self.connection, AggregateKind::Account, start, end)
    }

    fn category_breakdown(
        &self,
        start: time::Date,
        end: time::Date,
    ) -> LedgerResult<Vec<ReportAggregateRecord>> {
        aggregate_entries(&self.connection, AggregateKind::Category, start, end)
    }

    fn daily_report(
        &self,
        start: time::Date,
        end: time::Date,
    ) -> LedgerResult<Vec<DailyReportRecord>> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT
                    e.date,
                    e.currency_id,
                    COALESCE(c.code, e.currency_id),
                    COALESCE(SUM(CASE WHEN e.entry_type = 'income'
                        THEN e.amount_minor ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN e.entry_type = 'expense'
                        THEN e.amount_minor ELSE 0 END), 0)
                 FROM ledger_entries AS e
                 LEFT JOIN currencies AS c ON c.id = e.currency_id
                 WHERE e.deleted_at IS NULL AND e.date >= ?1 AND e.date <= ?2
                 GROUP BY e.date, e.currency_id, c.code
                 ORDER BY e.date, c.code, e.currency_id",
            )
            .map_err(storage_error)?;
        let mut rows = statement
            .query(params![start.to_string(), end.to_string()])
            .map_err(storage_error)?;
        let mut records = Vec::new();
        while let Some(row) = rows.next().map_err(storage_error)? {
            records.push(DailyReportRecord {
                date: parse_date(row.get::<_, String>(0).map_err(storage_error)?.as_str())?,
                currency_id: row.get(1).map_err(storage_error)?,
                currency_code: row.get(2).map_err(storage_error)?,
                income_minor: row.get(3).map_err(storage_error)?,
                expense_minor: row.get(4).map_err(storage_error)?,
            });
        }
        Ok(records)
    }

    fn begin_export_snapshot(&self) -> LedgerResult<Box<dyn LedgerExportSnapshot + '_>> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(storage_error)?;
        Ok(Box::new(SqliteLedgerExportSnapshot { transaction }))
    }

    fn scan_diagnostic_rows(
        &self,
        table: DiagnosticTable,
        after_rowid: Option<i64>,
        max_rows: u16,
        max_bytes: usize,
    ) -> LedgerResult<DiagnosticBatch> {
        scan_diagnostic_rows(&self.connection, table, after_rowid, max_rows, max_bytes)
    }

    fn list_audit_events(
        &self,
        record_type: &str,
        record_id: &str,
        page: Page,
    ) -> LedgerResult<Vec<AuditEvent>> {
        let sql = format!(
            "SELECT {AUDIT_COLUMNS}
             FROM audit_events
             WHERE record_type = ?1 AND record_id = ?2
             ORDER BY occurred_at, rowid
             LIMIT ?3 OFFSET ?4"
        );
        let mut statement = self.connection.prepare(&sql).map_err(storage_error)?;
        let mut rows = statement
            .query(params![
                record_type,
                record_id,
                i64::from(page.limit),
                i64::from(page.offset),
            ])
            .map_err(storage_error)?;
        let mut events = Vec::new();
        while let Some(row) = rows.next().map_err(storage_error)? {
            events.push(row_to_audit_event(row)?);
        }
        Ok(events)
    }

    fn list_recent_audit_activity(&self, limit: u16) -> LedgerResult<Vec<AuditActivity>> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT occurred_at, action, record_id
                 FROM audit_events
                 ORDER BY occurred_at DESC, record_id, action, rowid
                 LIMIT ?1",
            )
            .map_err(storage_error)?;
        let mut rows = statement.query([i64::from(limit)]).map_err(storage_error)?;
        let mut activity = Vec::new();
        while let Some(row) = rows.next().map_err(storage_error)? {
            let timestamp = row.get::<_, String>(0).map_err(storage_error)?;
            let occurred_at =
                OffsetDateTime::parse(&timestamp, &time::format_description::well_known::Rfc3339)
                    .map_err(|_| LedgerError::Storage("invalid audit timestamp".to_string()))?;
            activity.push(AuditActivity {
                occurred_at,
                action: row.get(1).map_err(storage_error)?,
                record_id: row.get(2).map_err(storage_error)?,
            });
        }
        Ok(activity)
    }

    fn database_health(&self) -> LedgerResult<DatabaseHealth> {
        const MAX_HEALTH_ISSUES: usize = 500;
        let mut integrity_messages = self
            .connection
            .prepare("PRAGMA integrity_check(501)")
            .map_err(storage_error)?
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        let integrity_truncated = integrity_messages.len() > MAX_HEALTH_ISSUES;
        integrity_messages.truncate(MAX_HEALTH_ISSUES);
        let mut foreign_key_violations = self
            .connection
            .prepare(
                "SELECT \"table\", rowid, parent, fkid
                 FROM pragma_foreign_key_check
                 ORDER BY \"table\", rowid, parent, fkid
                 LIMIT 501",
            )
            .map_err(storage_error)?
            .query_map([], |row| {
                Ok(ForeignKeyViolation {
                    table: row.get(0)?,
                    row_id: row.get(1)?,
                    parent_table: row.get(2)?,
                    foreign_key_index: row.get(3)?,
                })
            })
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        let foreign_key_truncated = foreign_key_violations.len() > MAX_HEALTH_ISSUES;
        foreign_key_violations.truncate(MAX_HEALTH_ISSUES);
        Ok(DatabaseHealth {
            integrity_messages,
            integrity_truncated,
            foreign_key_violations,
            foreign_key_truncated,
        })
    }
}

struct SqliteLedgerExportSnapshot<'connection> {
    transaction: Transaction<'connection>,
}

impl LedgerExportSnapshot for SqliteLedgerExportSnapshot<'_> {
    fn stream_currencies(
        &self,
        include_archived: bool,
        visitor: &mut dyn FnMut(StoredRecord<Currency>) -> LedgerResult<()>,
    ) -> LedgerResult<()> {
        stream_master_records(
            &self.transaction,
            "currencies",
            CURRENCY_COLUMNS,
            include_archived,
            row_to_currency,
            visitor,
        )
    }

    fn stream_account_categories(
        &self,
        include_archived: bool,
        visitor: &mut dyn FnMut(StoredRecord<AccountCategory>) -> LedgerResult<()>,
    ) -> LedgerResult<()> {
        stream_master_records(
            &self.transaction,
            "account_categories",
            ACCOUNT_CATEGORY_COLUMNS,
            include_archived,
            row_to_account_category,
            visitor,
        )
    }

    fn stream_accounts(
        &self,
        include_archived: bool,
        visitor: &mut dyn FnMut(StoredRecord<Account>) -> LedgerResult<()>,
    ) -> LedgerResult<()> {
        stream_master_records(
            &self.transaction,
            "accounts",
            ACCOUNT_COLUMNS,
            include_archived,
            row_to_account,
            visitor,
        )
    }

    fn stream_transaction_categories(
        &self,
        include_archived: bool,
        visitor: &mut dyn FnMut(StoredRecord<TransactionCategory>) -> LedgerResult<()>,
    ) -> LedgerResult<()> {
        stream_master_records(
            &self.transaction,
            "transaction_categories",
            TRANSACTION_CATEGORY_COLUMNS,
            include_archived,
            row_to_transaction_category,
            visitor,
        )
    }

    fn stream_entries(
        &self,
        include_archived: bool,
        visitor: &mut dyn FnMut(EntryViewRecord) -> LedgerResult<()>,
    ) -> LedgerResult<()> {
        stream_entry_records(&self.transaction, include_archived, visitor)
    }

    fn stream_audits(
        &self,
        visitor: &mut dyn FnMut(StoredAuditEvent) -> LedgerResult<()>,
    ) -> LedgerResult<()> {
        stream_audit_records(&self.transaction, visitor)
    }

    fn stream_transfer_operations(
        &self,
        visitor: &mut dyn FnMut(StoredTransferOperation) -> LedgerResult<()>,
    ) -> LedgerResult<()> {
        stream_transfer_operation_records(&self.transaction, visitor)
    }
}

impl LedgerMutationRepository for SqliteLedgerRepository {
    fn begin_transaction(&mut self) -> LedgerResult<Box<dyn LedgerTransaction + '_>> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        Ok(Box::new(SqliteLedgerTransaction { transaction }))
    }
}

struct SqliteLedgerTransaction<'connection> {
    transaction: Transaction<'connection>,
}

impl LedgerTransaction for SqliteLedgerTransaction<'_> {
    fn get_currency(&self, id: &str, include_archived: bool) -> LedgerResult<Option<Currency>> {
        get_currency_on(&self.transaction, id, include_archived)
    }

    fn get_account_category(
        &self,
        id: &str,
        include_archived: bool,
    ) -> LedgerResult<Option<AccountCategory>> {
        get_account_category_on(&self.transaction, id, include_archived)
    }

    fn get_account(&self, id: &str, include_archived: bool) -> LedgerResult<Option<Account>> {
        get_account_on(&self.transaction, id, include_archived)
    }

    fn get_transaction_category(
        &self,
        id: &str,
        include_archived: bool,
    ) -> LedgerResult<Option<TransactionCategory>> {
        get_transaction_category_on(&self.transaction, id, include_archived)
    }

    fn get_entry(&self, id: &str, include_archived: bool) -> LedgerResult<Option<LedgerEntry>> {
        get_entry_on(&self.transaction, id, include_archived)
    }

    fn list_entries_by_transfer_group(
        &self,
        transfer_group_id: &str,
        include_archived: bool,
    ) -> LedgerResult<Vec<LedgerEntry>> {
        list_entries_by_transfer_group_on(&self.transaction, transfer_group_id, include_archived)
    }

    fn currency_by_code(&self, code: &str) -> LedgerResult<CandidateMatch<Currency>> {
        candidate_query(
            &self.transaction,
            &format!(
                "SELECT {CURRENCY_COLUMNS}
                 FROM currencies
                 WHERE active = 1 AND deleted_at IS NULL AND code = ?1
                 ORDER BY id
                 LIMIT 2"
            ),
            [code],
            row_to_currency,
        )
    }

    fn currency_by_active_name(&self, name: &str) -> LedgerResult<CandidateMatch<Currency>> {
        candidate_query(
            &self.transaction,
            &format!(
                "SELECT {CURRENCY_COLUMNS}
                 FROM currencies
                 WHERE active = 1 AND deleted_at IS NULL AND name = ?1
                 ORDER BY id
                 LIMIT 2"
            ),
            [name],
            row_to_currency,
        )
    }

    fn account_category_by_active_name(
        &self,
        name: &str,
    ) -> LedgerResult<CandidateMatch<AccountCategory>> {
        candidate_query(
            &self.transaction,
            &format!(
                "SELECT {ACCOUNT_CATEGORY_COLUMNS}
                 FROM account_categories
                 WHERE active = 1 AND deleted_at IS NULL AND name = ?1
                 ORDER BY id
                 LIMIT 2"
            ),
            [name],
            row_to_account_category,
        )
    }

    fn account_by_active_name(&self, name: &str) -> LedgerResult<CandidateMatch<Account>> {
        candidate_query(
            &self.transaction,
            &format!(
                "SELECT {ACCOUNT_COLUMNS}
                 FROM accounts
                 WHERE active = 1 AND deleted_at IS NULL AND name = ?1
                 ORDER BY id
                 LIMIT 2"
            ),
            [name],
            row_to_account,
        )
    }

    fn transaction_category_by_active_name(
        &self,
        name: &str,
    ) -> LedgerResult<CandidateMatch<TransactionCategory>> {
        candidate_query(
            &self.transaction,
            &format!(
                "SELECT {TRANSACTION_CATEGORY_COLUMNS}
                 FROM transaction_categories
                 WHERE active = 1 AND deleted_at IS NULL AND name = ?1
                 ORDER BY id
                 LIMIT 2"
            ),
            [name],
            row_to_transaction_category,
        )
    }

    fn currency_has_dependencies(&self, id: &str) -> LedgerResult<bool> {
        exists(
            &self.transaction,
            "SELECT EXISTS(
                SELECT 1 FROM accounts WHERE currency_id = ?1
                UNION ALL
                SELECT 1 FROM ledger_entries WHERE currency_id = ?1
             )",
            id,
        )
    }

    fn account_category_has_dependencies(&self, id: &str) -> LedgerResult<bool> {
        exists(
            &self.transaction,
            "SELECT EXISTS(
                SELECT 1 FROM accounts WHERE account_category_id = ?1
                UNION ALL
                SELECT 1 FROM account_categories WHERE parent_id = ?1
             )",
            id,
        )
    }

    fn account_has_entries(&self, id: &str) -> LedgerResult<bool> {
        exists(
            &self.transaction,
            "SELECT EXISTS(
                SELECT 1 FROM ledger_entries WHERE account_id = ?1
             )",
            id,
        )
    }

    fn transaction_category_has_entries(&self, id: &str) -> LedgerResult<bool> {
        exists(
            &self.transaction,
            "SELECT EXISTS(
                SELECT 1 FROM ledger_entries WHERE transaction_category_id = ?1
             )",
            id,
        )
    }

    fn transaction_category_has_children(&self, id: &str) -> LedgerResult<bool> {
        exists(
            &self.transaction,
            "SELECT EXISTS(
                SELECT 1 FROM transaction_categories WHERE parent_id = ?1
             )",
            id,
        )
    }

    fn list_active_currencies(&self, page: Page) -> LedgerResult<Vec<Currency>> {
        list_active_currencies_on(&self.transaction, page)
    }

    fn list_active_account_categories(&self, page: Page) -> LedgerResult<Vec<AccountCategory>> {
        list_active_account_categories_on(&self.transaction, page)
    }

    fn list_active_accounts(&self, page: Page) -> LedgerResult<Vec<Account>> {
        list_active_accounts_on(&self.transaction, page)
    }

    fn list_active_transaction_categories(
        &self,
        page: Page,
    ) -> LedgerResult<Vec<TransactionCategory>> {
        list_active_transaction_categories_on(&self.transaction, page)
    }

    fn upsert_currency(
        &mut self,
        currency: &Currency,
        changed_at: OffsetDateTime,
    ) -> LedgerResult<()> {
        let changed_at = format_time(changed_at)?;
        self.transaction
            .execute(
                "INSERT INTO currencies (
                    id, code, name, symbol, decimal_places, active, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                ON CONFLICT(id) DO UPDATE SET
                    code = excluded.code,
                    name = excluded.name,
                    symbol = excluded.symbol,
                    decimal_places = excluded.decimal_places,
                    active = excluded.active,
                    updated_at = excluded.updated_at",
                params![
                    currency.id(),
                    currency.code(),
                    currency.name(),
                    currency.symbol(),
                    currency.decimal_places(),
                    currency.is_active(),
                    changed_at,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    fn upsert_account_category(
        &mut self,
        category: &AccountCategory,
        changed_at: OffsetDateTime,
    ) -> LedgerResult<()> {
        let changed_at = format_time(changed_at)?;
        self.transaction
            .execute(
                "INSERT INTO account_categories (
                    id, name, parent_id, liability, active, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    parent_id = excluded.parent_id,
                    liability = excluded.liability,
                    active = excluded.active,
                    updated_at = excluded.updated_at",
                params![
                    category.id(),
                    category.name(),
                    category.parent_id(),
                    category.is_liability(),
                    category.is_active(),
                    changed_at,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    fn upsert_account(
        &mut self,
        account: &Account,
        changed_at: OffsetDateTime,
    ) -> LedgerResult<()> {
        let changed_at = format_time(changed_at)?;
        self.transaction
            .execute(
                "INSERT INTO accounts (
                    id, name, account_category_id, currency_id,
                    opening_balance_minor, active, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    account_category_id = excluded.account_category_id,
                    currency_id = excluded.currency_id,
                    opening_balance_minor = excluded.opening_balance_minor,
                    active = excluded.active,
                    updated_at = excluded.updated_at",
                params![
                    account.id(),
                    account.name(),
                    account.category_id(),
                    account.currency_id(),
                    account.opening_balance().minor_units(),
                    account.is_active(),
                    changed_at,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    fn upsert_transaction_category(
        &mut self,
        category: &TransactionCategory,
        changed_at: OffsetDateTime,
    ) -> LedgerResult<()> {
        let changed_at = format_time(changed_at)?;
        self.transaction
            .execute(
                "INSERT INTO transaction_categories (
                    id, name, parent_id, kind, active, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    parent_id = excluded.parent_id,
                    kind = excluded.kind,
                    active = excluded.active,
                    updated_at = excluded.updated_at",
                params![
                    category.id(),
                    category.name(),
                    category.parent_id(),
                    transaction_category_kind_value(category.kind()),
                    category.is_active(),
                    changed_at,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    fn delete_currency(&mut self, id: &str) -> LedgerResult<()> {
        delete_master(&self.transaction, "currencies", "currency", id)
    }

    fn delete_account_category(&mut self, id: &str) -> LedgerResult<()> {
        delete_master(
            &self.transaction,
            "account_categories",
            "account category",
            id,
        )
    }

    fn delete_account(&mut self, id: &str) -> LedgerResult<()> {
        delete_master(&self.transaction, "accounts", "account", id)
    }

    fn delete_transaction_category(&mut self, id: &str) -> LedgerResult<()> {
        delete_master(
            &self.transaction,
            "transaction_categories",
            "transaction category",
            id,
        )
    }

    fn insert_entry(&mut self, entry: &LedgerEntry) -> LedgerResult<()> {
        self.transaction
            .execute(
                "INSERT INTO ledger_entries (
                    id, date, written_at, content, transaction_category_id, account_id,
                    entry_type, amount_minor, currency_id, transfer_group_id, source,
                    notes, created_at, updated_at, deleted_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
                )",
                params![
                    entry.id(),
                    entry.date().to_string(),
                    format_time(entry.written_at())?,
                    entry.content(),
                    entry.transaction_category_id(),
                    entry.account_id(),
                    entry.entry_type().as_str(),
                    entry.amount().minor_units(),
                    entry.currency_id(),
                    entry.transfer_group_id(),
                    entry.source(),
                    entry.notes(),
                    format_time(entry.created_at())?,
                    format_time(entry.updated_at())?,
                    entry.deleted_at().map(format_time).transpose()?,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    fn update_entry(&mut self, entry: &LedgerEntry) -> LedgerResult<()> {
        let changed = self
            .transaction
            .execute(
                "UPDATE ledger_entries SET
                    date = ?2,
                    written_at = ?3,
                    content = ?4,
                    transaction_category_id = ?5,
                    account_id = ?6,
                    entry_type = ?7,
                    amount_minor = ?8,
                    currency_id = ?9,
                    transfer_group_id = ?10,
                    source = ?11,
                    notes = ?12,
                    updated_at = ?13,
                    deleted_at = ?14
                 WHERE id = ?1",
                params![
                    entry.id(),
                    entry.date().to_string(),
                    format_time(entry.written_at())?,
                    entry.content(),
                    entry.transaction_category_id(),
                    entry.account_id(),
                    entry.entry_type().as_str(),
                    entry.amount().minor_units(),
                    entry.currency_id(),
                    entry.transfer_group_id(),
                    entry.source(),
                    entry.notes(),
                    format_time(entry.updated_at())?,
                    entry.deleted_at().map(format_time).transpose()?,
                ],
            )
            .map_err(storage_error)?;
        if changed == 0 {
            return Err(LedgerError::NotFound(entry.id().to_string()));
        }
        Ok(())
    }

    fn delete_entry(&mut self, id: &str) -> LedgerResult<()> {
        let changed = self
            .transaction
            .execute("DELETE FROM ledger_entries WHERE id = ?1", [id])
            .map_err(storage_error)?;
        if changed == 0 {
            return Err(LedgerError::NotFound(format!("ledger entry {id}")));
        }
        Ok(())
    }

    fn insert_audit_event(&mut self, event: &AuditEvent) -> LedgerResult<()> {
        let before =
            audit_json::encode_optional(event.before.as_ref()).map_err(LedgerError::Storage)?;
        let after =
            audit_json::encode_optional(event.after.as_ref()).map_err(LedgerError::Storage)?;
        self.transaction
            .execute(
                "INSERT INTO audit_events (
                    id, occurred_at, actor, action, record_type, record_id,
                    before_json, after_json, reason
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    event.id,
                    format_time(event.occurred_at)?,
                    event.actor,
                    event.action,
                    event.record_type,
                    event.record_id,
                    before,
                    after,
                    event.reason,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    fn get_transfer_operation(
        &self,
        operation_key: &str,
    ) -> LedgerResult<Option<TransferOperationRecord>> {
        self.transaction
            .query_row(
                "SELECT payload_json, result_json
                 FROM transfer_operations
                 WHERE operation_key = ?1",
                [operation_key],
                |row| {
                    Ok(TransferOperationRecord {
                        payload_json: row.get(0)?,
                        result_json: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(storage_error)
    }

    fn insert_transfer_operation(
        &mut self,
        operation_key: &str,
        payload_json: &str,
        result_json: &str,
        created_at: OffsetDateTime,
    ) -> LedgerResult<()> {
        self.transaction
            .execute(
                "INSERT INTO transfer_operations (
                    operation_key, payload_json, result_json, created_at
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![
                    operation_key,
                    payload_json,
                    result_json,
                    format_time(created_at)?
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    fn commit(self: Box<Self>) -> LedgerResult<()> {
        let Self { transaction } = *self;
        transaction.commit().map_err(storage_error)
    }

    fn rollback(self: Box<Self>) -> LedgerResult<()> {
        let Self { transaction } = *self;
        transaction.rollback().map_err(storage_error)
    }
}

fn collect_entries<P>(
    connection: &Connection,
    sql: &str,
    parameters: P,
) -> LedgerResult<Vec<LedgerEntry>>
where
    P: rusqlite::Params,
{
    let mut statement = connection.prepare(sql).map_err(storage_error)?;
    let mut rows = statement.query(parameters).map_err(storage_error)?;
    let mut entries = Vec::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        entries.push(row_to_entry(row)?);
    }
    Ok(entries)
}

fn collect_rows<T, P>(
    connection: &Connection,
    sql: &str,
    parameters: P,
    map: fn(&rusqlite::Row<'_>) -> LedgerResult<T>,
) -> LedgerResult<Vec<T>>
where
    P: rusqlite::Params,
{
    let mut statement = connection.prepare(sql).map_err(storage_error)?;
    let mut rows = statement.query(parameters).map_err(storage_error)?;
    let mut values = Vec::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        values.push(map(row)?);
    }
    Ok(values)
}

fn row_to_account_balance_record(row: &rusqlite::Row<'_>) -> LedgerResult<AccountBalanceRecord> {
    let account = row_to_account(row)?;
    let decimal_places = row.get::<_, i64>(7).map_err(storage_error)?;
    let decimal_places = u8::try_from(decimal_places).map_err(|_| {
        LedgerError::Storage("invalid account balance currency precision".to_string())
    })?;
    let mismatch_count = row.get::<_, i64>(9).map_err(storage_error)?;
    Ok(AccountBalanceRecord {
        account,
        currency_code: row.get(6).map_err(storage_error)?,
        decimal_places,
        movement_minor: row.get(8).map_err(storage_error)?,
        currency_mismatch_count: u64::try_from(mismatch_count).map_err(|_| {
            LedgerError::Storage("account balance mismatch count is negative".to_string())
        })?,
    })
}

#[allow(clippy::too_many_arguments)]
fn stream_master_records<T>(
    connection: &Connection,
    table: &str,
    columns: &str,
    include_archived: bool,
    map: fn(&rusqlite::Row<'_>) -> LedgerResult<T>,
    visitor: &mut dyn FnMut(StoredRecord<T>) -> LedgerResult<()>,
) -> LedgerResult<()> {
    let visibility = if include_archived {
        ""
    } else {
        "WHERE deleted_at IS NULL"
    };
    let sql = format!(
        "SELECT {columns}, created_at, updated_at, deleted_at
         FROM {table}
         {visibility}
         ORDER BY id"
    );
    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    let mut rows = statement.query([]).map_err(storage_error)?;
    while let Some(row) = rows.next().map_err(storage_error)? {
        let timestamp_index = row.as_ref().column_count() - 3;
        visitor(StoredRecord {
            record: map(row)?,
            created_at: row.get(timestamp_index).map_err(storage_error)?,
            updated_at: row.get(timestamp_index + 1).map_err(storage_error)?,
            deleted_at: row.get(timestamp_index + 2).map_err(storage_error)?,
        })?;
    }
    Ok(())
}

fn stream_entry_records(
    connection: &Connection,
    include_archived: bool,
    visitor: &mut dyn FnMut(EntryViewRecord) -> LedgerResult<()>,
) -> LedgerResult<()> {
    let visibility = if include_archived {
        ""
    } else {
        "WHERE e.deleted_at IS NULL"
    };
    let sql = format!(
        "SELECT e.id, e.date, e.written_at, e.content,
                e.transaction_category_id, e.account_id, e.entry_type,
                e.amount_minor, e.currency_id, e.transfer_group_id,
                e.source, e.notes, e.created_at, e.updated_at, e.deleted_at,
                a.name, tc.name, c.code
         FROM ledger_entries AS e
         LEFT JOIN accounts AS a ON a.id = e.account_id
         LEFT JOIN transaction_categories AS tc
            ON tc.id = e.transaction_category_id
         LEFT JOIN currencies AS c ON c.id = e.currency_id
         {visibility}
         ORDER BY e.date, e.written_at, e.id"
    );
    stream_rows(connection, &sql, [], row_to_entry_view_record, visitor)
}

fn stream_audit_records(
    connection: &Connection,
    visitor: &mut dyn FnMut(StoredAuditEvent) -> LedgerResult<()>,
) -> LedgerResult<()> {
    let sql = format!(
        "SELECT {AUDIT_COLUMNS}, rowid
         FROM audit_events
         ORDER BY occurred_at, rowid"
    );
    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    let mut rows = statement.query([]).map_err(storage_error)?;
    while let Some(row) = rows.next().map_err(storage_error)? {
        visitor(StoredAuditEvent {
            sequence: row.get(9).map_err(storage_error)?,
            event: row_to_audit_event(row)?,
        })?;
    }
    Ok(())
}

fn stream_transfer_operation_records(
    connection: &Connection,
    visitor: &mut dyn FnMut(StoredTransferOperation) -> LedgerResult<()>,
) -> LedgerResult<()> {
    stream_rows(
        connection,
        "SELECT operation_key, payload_json, result_json, created_at
         FROM transfer_operations
         ORDER BY operation_key",
        [],
        |row| {
            Ok(StoredTransferOperation {
                operation_key: row.get(0).map_err(storage_error)?,
                payload_json: row.get(1).map_err(storage_error)?,
                result_json: row.get(2).map_err(storage_error)?,
                created_at: row.get(3).map_err(storage_error)?,
            })
        },
        visitor,
    )
}

fn stream_rows<T, P>(
    connection: &Connection,
    sql: &str,
    parameters: P,
    map: fn(&rusqlite::Row<'_>) -> LedgerResult<T>,
    visitor: &mut dyn FnMut(T) -> LedgerResult<()>,
) -> LedgerResult<()>
where
    P: rusqlite::Params,
{
    let mut statement = connection.prepare(sql).map_err(storage_error)?;
    let mut rows = statement.query(parameters).map_err(storage_error)?;
    while let Some(row) = rows.next().map_err(storage_error)? {
        visitor(map(row)?)?;
    }
    Ok(())
}

fn scan_diagnostic_rows(
    connection: &Connection,
    table: DiagnosticTable,
    after_rowid: Option<i64>,
    max_rows: u16,
    max_bytes: usize,
) -> LedgerResult<DiagnosticBatch> {
    let columns = diagnostic_columns(table);
    let byte_expression = columns
        .iter()
        .map(|column| format!("COALESCE(length(CAST({column} AS BLOB)), 0)"))
        .collect::<Vec<_>>()
        .join(" + ");
    let (metadata_sql, metadata_parameters) = if let Some(after_rowid) = after_rowid {
        (
            format!(
                "SELECT rowid, {byte_expression} + 128
                 FROM {}
                 WHERE rowid > ?1
                 ORDER BY rowid
                 LIMIT ?2",
                table.name()
            ),
            vec![
                Value::Integer(after_rowid),
                Value::Integer(i64::from(max_rows) + 1),
            ],
        )
    } else {
        (
            format!(
                "SELECT rowid, {byte_expression} + 128
                 FROM {}
                 ORDER BY rowid
                 LIMIT ?1",
                table.name()
            ),
            vec![Value::Integer(i64::from(max_rows) + 1)],
        )
    };
    let mut metadata_statement = connection.prepare(&metadata_sql).map_err(storage_error)?;
    let mut metadata_rows = metadata_statement
        .query(params_from_iter(metadata_parameters.iter()))
        .map_err(storage_error)?;
    let mut metadata = Vec::new();
    while let Some(row) = metadata_rows.next().map_err(storage_error)? {
        let byte_count = row.get::<_, i64>(1).map_err(storage_error)?;
        metadata.push((
            row.get::<_, i64>(0).map_err(storage_error)?,
            usize::try_from(byte_count).map_err(|_| {
                LedgerError::Storage("diagnostic row byte count is invalid".to_string())
            })?,
        ));
    }
    drop(metadata_rows);
    drop(metadata_statement);

    let mut selected = Vec::new();
    let mut byte_count = 0_usize;
    let mut next_unscanned_rowid = None;
    for (rowid, row_bytes) in metadata.into_iter().take(usize::from(max_rows)) {
        if byte_count.saturating_add(row_bytes) > max_bytes {
            next_unscanned_rowid = Some(rowid);
            break;
        }
        byte_count = byte_count
            .checked_add(row_bytes)
            .ok_or_else(|| LedgerError::Storage("diagnostic byte count overflow".to_string()))?;
        selected.push((rowid, row_bytes));
    }

    let mut rows = Vec::with_capacity(selected.len());
    if let Some((last_rowid, _)) = selected.last() {
        let byte_counts: std::collections::BTreeMap<_, _> = selected.iter().copied().collect();
        let (rows_sql, rows_parameters) = if let Some(after_rowid) = after_rowid {
            (
                format!(
                    "SELECT rowid, {} FROM {}
                     WHERE rowid > ?1 AND rowid <= ?2
                     ORDER BY rowid",
                    columns.join(", "),
                    table.name()
                ),
                vec![Value::Integer(after_rowid), Value::Integer(*last_rowid)],
            )
        } else {
            (
                format!(
                    "SELECT rowid, {} FROM {}
                     WHERE rowid <= ?1
                     ORDER BY rowid",
                    columns.join(", "),
                    table.name()
                ),
                vec![Value::Integer(*last_rowid)],
            )
        };
        let mut statement = connection.prepare(&rows_sql).map_err(storage_error)?;
        let mut selected_rows = statement
            .query(params_from_iter(rows_parameters.iter()))
            .map_err(storage_error)?;
        while let Some(row) = selected_rows.next().map_err(storage_error)? {
            let rowid = row.get::<_, i64>(0).map_err(storage_error)?;
            let mut values = std::collections::BTreeMap::new();
            for (index, column) in columns.iter().enumerate() {
                values.insert(
                    (*column).to_string(),
                    diagnostic_value(row.get_ref(index + 1).map_err(storage_error)?),
                );
            }
            rows.push(DiagnosticRow {
                rowid,
                values,
                byte_count: *byte_counts.get(&rowid).ok_or_else(|| {
                    LedgerError::Storage("diagnostic row changed during bounded scan".to_string())
                })?,
            });
        }
        if rows.len() != selected.len() {
            return Err(LedgerError::Storage(
                "diagnostic rows changed during bounded scan".to_string(),
            ));
        }
    }
    let next_cursor = rows.last().map(|row| row.rowid);
    Ok(DiagnosticBatch {
        rows,
        next_cursor,
        next_unscanned_rowid,
        byte_count,
        truncated: next_unscanned_rowid.is_some(),
    })
}

fn diagnostic_value(value: ValueRef<'_>) -> DiagnosticValue {
    match value {
        ValueRef::Null => DiagnosticValue::Null,
        ValueRef::Integer(value) => DiagnosticValue::Integer(value),
        ValueRef::Real(value) => DiagnosticValue::Real(value),
        ValueRef::Text(bytes) => DiagnosticValue::Text {
            value: std::str::from_utf8(bytes).ok().map(str::to_string),
            byte_len: bytes.len(),
        },
        ValueRef::Blob(bytes) => DiagnosticValue::Blob {
            byte_len: bytes.len(),
        },
    }
}

fn diagnostic_columns(table: DiagnosticTable) -> &'static [&'static str] {
    match table {
        DiagnosticTable::Currencies => &[
            "id",
            "code",
            "name",
            "symbol",
            "decimal_places",
            "active",
            "created_at",
            "updated_at",
            "deleted_at",
        ],
        DiagnosticTable::AccountCategories => &[
            "id",
            "name",
            "parent_id",
            "liability",
            "active",
            "created_at",
            "updated_at",
            "deleted_at",
        ],
        DiagnosticTable::Accounts => &[
            "id",
            "name",
            "account_category_id",
            "currency_id",
            "opening_balance_minor",
            "active",
            "created_at",
            "updated_at",
            "deleted_at",
        ],
        DiagnosticTable::TransactionCategories => &[
            "id",
            "name",
            "parent_id",
            "kind",
            "active",
            "created_at",
            "updated_at",
            "deleted_at",
        ],
        DiagnosticTable::LedgerEntries => &[
            "id",
            "date",
            "written_at",
            "content",
            "transaction_category_id",
            "account_id",
            "entry_type",
            "amount_minor",
            "currency_id",
            "transfer_group_id",
            "source",
            "notes",
            "created_at",
            "updated_at",
            "deleted_at",
        ],
        DiagnosticTable::AuditEvents => &[
            "id",
            "occurred_at",
            "actor",
            "action",
            "record_type",
            "record_id",
            "before_json",
            "after_json",
            "reason",
        ],
        DiagnosticTable::TransferOperations => {
            &["operation_key", "payload_json", "result_json", "created_at"]
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum AggregateKind {
    Summary,
    Account,
    Category,
}

fn aggregate_entries(
    connection: &Connection,
    kind: AggregateKind,
    start: time::Date,
    end: time::Date,
) -> LedgerResult<Vec<ReportAggregateRecord>> {
    let (reference_id, name, join, group_by) = match kind {
        AggregateKind::Summary => (
            "NULL",
            "NULL",
            "",
            "e.currency_id, currency_code, currency_decimal_places",
        ),
        AggregateKind::Account => (
            "e.account_id",
            "COALESCE(a.name, e.account_id)",
            "LEFT JOIN accounts AS a ON a.id = e.account_id",
            "e.account_id, reference_name, e.currency_id, currency_code, currency_decimal_places",
        ),
        AggregateKind::Category => (
            "e.transaction_category_id",
            "COALESCE(tc.name, 'Uncategorized')",
            "LEFT JOIN transaction_categories AS tc ON tc.id = e.transaction_category_id",
            "e.transaction_category_id, reference_name, e.currency_id, currency_code, currency_decimal_places",
        ),
    };
    let sql = format!(
        "SELECT
            {reference_id} AS reference_id,
            {name} AS reference_name,
            e.currency_id,
            COALESCE(c.code, e.currency_id) AS currency_code,
            c.decimal_places AS currency_decimal_places,
            COALESCE(SUM(CASE WHEN e.entry_type = 'income'
                THEN e.amount_minor ELSE 0 END), 0) AS income_minor,
            COALESCE(SUM(CASE WHEN e.entry_type = 'expense'
                THEN e.amount_minor ELSE 0 END), 0) AS expense_minor,
            COALESCE(SUM(CASE e.entry_type
                WHEN 'expense' THEN -e.amount_minor
                WHEN 'income' THEN e.amount_minor
                WHEN 'transfer_out' THEN -e.amount_minor
                WHEN 'transfer_in' THEN e.amount_minor
                WHEN 'adjustment_out' THEN -e.amount_minor
                WHEN 'adjustment_in' THEN e.amount_minor
                ELSE 0
            END), 0) AS net_change_minor,
            COUNT(*) AS entry_count
         FROM ledger_entries AS e
         LEFT JOIN currencies AS c ON c.id = e.currency_id
         {join}
         WHERE e.deleted_at IS NULL AND e.date >= ?1 AND e.date <= ?2
         GROUP BY {group_by}
         ORDER BY currency_code, e.currency_id, reference_name, reference_id"
    );
    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    let mut rows = statement
        .query(params![start.to_string(), end.to_string()])
        .map_err(storage_error)?;
    let mut records = Vec::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        let decimal_places = row.get::<_, i64>(4).map_err(storage_error)?;
        let decimal_places = u8::try_from(decimal_places)
            .ok()
            .filter(|value| *value <= 18)
            .ok_or_else(|| {
                LedgerError::Storage("invalid ledger report currency precision".to_string())
            })?;
        let count = row.get::<_, i64>(8).map_err(storage_error)?;
        records.push(ReportAggregateRecord {
            reference_id: row.get(0).map_err(storage_error)?,
            name: row.get(1).map_err(storage_error)?,
            currency_id: row.get(2).map_err(storage_error)?,
            currency_code: row.get(3).map_err(storage_error)?,
            decimal_places,
            income_minor: row.get(5).map_err(storage_error)?,
            expense_minor: row.get(6).map_err(storage_error)?,
            net_change_minor: row.get(7).map_err(storage_error)?,
            entry_count: u64::try_from(count).map_err(|_| {
                LedgerError::Storage("ledger report entry count is negative".to_string())
            })?,
        });
    }
    Ok(records)
}

fn row_to_entry_view_record(row: &rusqlite::Row<'_>) -> LedgerResult<EntryViewRecord> {
    Ok(EntryViewRecord {
        entry: row_to_entry(row)?,
        account_name: row.get(15).map_err(storage_error)?,
        category_name: row.get(16).map_err(storage_error)?,
        currency_code: row.get(17).map_err(storage_error)?,
    })
}

fn entry_where_clause(query: &EntryQuery) -> (String, Vec<Value>) {
    let mut clauses = Vec::new();
    let mut values = Vec::<Value>::new();
    if !query.include_archived {
        clauses.push("deleted_at IS NULL".to_string());
    }
    push_entry_filter(
        &mut clauses,
        &mut values,
        "date >= ",
        query.date_from.map(|date| date.to_string()),
    );
    push_entry_filter(
        &mut clauses,
        &mut values,
        "date <= ",
        query.date_to.map(|date| date.to_string()),
    );
    push_entry_filter(
        &mut clauses,
        &mut values,
        "entry_type = ",
        query.entry_type.map(|kind| kind.as_str().to_string()),
    );
    push_entry_filter(
        &mut clauses,
        &mut values,
        "account_id = ",
        query.account.clone(),
    );
    push_entry_filter(
        &mut clauses,
        &mut values,
        "transaction_category_id = ",
        query.category.clone(),
    );
    push_entry_filter(
        &mut clauses,
        &mut values,
        "currency_id = ",
        query.currency.clone(),
    );
    if let Some(content) = query.content.as_deref() {
        values.push(Value::Text(content.to_string()));
        clauses.push(format!(
            "ledger_content_contains(content, ?{}) = 1",
            values.len()
        ));
    }
    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    (where_clause, values)
}

#[allow(clippy::too_many_arguments)]
fn candidate_master_by_value<T>(
    connection: &Connection,
    table: &str,
    columns: &str,
    column: &str,
    value: &str,
    include_archived: bool,
    map: fn(&rusqlite::Row<'_>) -> LedgerResult<T>,
) -> LedgerResult<CandidateMatch<T>> {
    let visibility = if include_archived {
        ""
    } else {
        "AND deleted_at IS NULL"
    };
    candidate_query(
        connection,
        &format!(
            "SELECT {columns}
             FROM {table}
             WHERE {column} = ?1 {visibility}
             ORDER BY id
             LIMIT 2"
        ),
        [value],
        map,
    )
}

fn push_entry_filter(
    clauses: &mut Vec<String>,
    values: &mut Vec<Value>,
    expression: &str,
    value: Option<String>,
) {
    if let Some(value) = value {
        values.push(Value::Text(value));
        clauses.push(format!("{expression}?{}", values.len()));
    }
}

fn candidate_query<T, P>(
    connection: &Connection,
    sql: &str,
    parameters: P,
    map: fn(&rusqlite::Row<'_>) -> LedgerResult<T>,
) -> LedgerResult<CandidateMatch<T>>
where
    P: rusqlite::Params,
{
    let mut values = collect_rows(connection, sql, parameters, map)?;
    Ok(match values.len() {
        0 => CandidateMatch::None,
        1 => CandidateMatch::One(values.remove(0)),
        _ => CandidateMatch::Ambiguous,
    })
}

fn exists(connection: &Connection, sql: &str, id: &str) -> LedgerResult<bool> {
    connection
        .query_row(sql, [id], |row| row.get(0))
        .map_err(storage_error)
}

fn delete_master(
    transaction: &Transaction<'_>,
    table: &str,
    kind: &str,
    id: &str,
) -> LedgerResult<()> {
    let changed = transaction
        .execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])
        .map_err(storage_error)?;
    if changed == 0 {
        return Err(LedgerError::NotFound(format!("{kind} {id}")));
    }
    Ok(())
}

fn list_active_currencies_on(connection: &Connection, page: Page) -> LedgerResult<Vec<Currency>> {
    collect_rows(
        connection,
        &format!(
            "SELECT {CURRENCY_COLUMNS}
             FROM currencies
             WHERE active = 1 AND deleted_at IS NULL
             ORDER BY name, id
             LIMIT ?1 OFFSET ?2"
        ),
        page_params(page),
        row_to_currency,
    )
}

fn list_active_account_categories_on(
    connection: &Connection,
    page: Page,
) -> LedgerResult<Vec<AccountCategory>> {
    collect_rows(
        connection,
        &format!(
            "SELECT {ACCOUNT_CATEGORY_COLUMNS}
             FROM account_categories
             WHERE active = 1 AND deleted_at IS NULL
             ORDER BY name, id
             LIMIT ?1 OFFSET ?2"
        ),
        page_params(page),
        row_to_account_category,
    )
}

fn list_active_accounts_on(connection: &Connection, page: Page) -> LedgerResult<Vec<Account>> {
    collect_rows(
        connection,
        &format!(
            "SELECT {ACCOUNT_COLUMNS}
             FROM accounts
             WHERE active = 1 AND deleted_at IS NULL
             ORDER BY name, id
             LIMIT ?1 OFFSET ?2"
        ),
        page_params(page),
        row_to_account,
    )
}

fn list_active_transaction_categories_on(
    connection: &Connection,
    page: Page,
) -> LedgerResult<Vec<TransactionCategory>> {
    collect_rows(
        connection,
        &format!(
            "SELECT {TRANSACTION_CATEGORY_COLUMNS}
             FROM transaction_categories
             WHERE active = 1 AND deleted_at IS NULL
             ORDER BY name, id
             LIMIT ?1 OFFSET ?2"
        ),
        page_params(page),
        row_to_transaction_category,
    )
}

fn page_params(page: Page) -> [i64; 2] {
    [i64::from(page.limit), i64::from(page.offset)]
}

fn get_currency_on(
    connection: &Connection,
    id: &str,
    include_archived: bool,
) -> LedgerResult<Option<Currency>> {
    let sql = select_by_id("currencies", CURRENCY_COLUMNS, include_archived);
    query_optional(connection, &sql, id, row_to_currency)
}

fn get_account_category_on(
    connection: &Connection,
    id: &str,
    include_archived: bool,
) -> LedgerResult<Option<AccountCategory>> {
    let sql = select_by_id(
        "account_categories",
        ACCOUNT_CATEGORY_COLUMNS,
        include_archived,
    );
    query_optional(connection, &sql, id, row_to_account_category)
}

fn get_account_on(
    connection: &Connection,
    id: &str,
    include_archived: bool,
) -> LedgerResult<Option<Account>> {
    let sql = select_by_id("accounts", ACCOUNT_COLUMNS, include_archived);
    query_optional(connection, &sql, id, row_to_account)
}

fn get_transaction_category_on(
    connection: &Connection,
    id: &str,
    include_archived: bool,
) -> LedgerResult<Option<TransactionCategory>> {
    let sql = select_by_id(
        "transaction_categories",
        TRANSACTION_CATEGORY_COLUMNS,
        include_archived,
    );
    query_optional(connection, &sql, id, row_to_transaction_category)
}

fn get_entry_on(
    connection: &Connection,
    id: &str,
    include_archived: bool,
) -> LedgerResult<Option<LedgerEntry>> {
    let sql = select_by_id("ledger_entries", ENTRY_COLUMNS, include_archived);
    query_optional(connection, &sql, id, row_to_entry)
}

fn list_entries_by_transfer_group_on(
    connection: &Connection,
    transfer_group_id: &str,
    include_archived: bool,
) -> LedgerResult<Vec<LedgerEntry>> {
    let visibility = if include_archived {
        ""
    } else {
        "AND deleted_at IS NULL"
    };
    collect_entries(
        connection,
        &format!(
            "SELECT {ENTRY_COLUMNS}
             FROM ledger_entries
             WHERE transfer_group_id = ?1 {visibility}
             ORDER BY entry_type, id"
        ),
        [transfer_group_id],
    )
}

fn select_by_id(table: &str, columns: &str, include_archived: bool) -> String {
    let visibility = if include_archived {
        ""
    } else {
        "AND deleted_at IS NULL"
    };
    format!("SELECT {columns} FROM {table} WHERE id = ?1 {visibility}")
}

fn query_optional<T>(
    connection: &Connection,
    sql: &str,
    id: &str,
    map: fn(&rusqlite::Row<'_>) -> LedgerResult<T>,
) -> LedgerResult<Option<T>> {
    let mut statement = connection.prepare(sql).map_err(storage_error)?;
    let mut rows = statement.query([id]).map_err(storage_error)?;
    let result = rows.next().map_err(storage_error)?.map(map).transpose()?;
    if rows.next().map_err(storage_error)?.is_some() {
        return Err(LedgerError::Storage(
            "primary-key lookup returned multiple ledger records".to_string(),
        ));
    }
    Ok(result)
}

fn transaction_category_kind_value(kind: TransactionCategoryKind) -> &'static str {
    match kind {
        TransactionCategoryKind::Expense => "expense",
        TransactionCategoryKind::Income => "income",
    }
}
