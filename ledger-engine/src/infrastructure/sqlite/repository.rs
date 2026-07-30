use rusqlite::{Connection, Transaction, TransactionBehavior, params};
use time::OffsetDateTime;

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{
    AuditEvent, CandidateMatch, EntryQuery, LedgerRepository, LedgerTransaction, Page,
};
use crate::domain::{
    Account, AccountCategory, Currency, LedgerEntry, TransactionCategory, TransactionCategoryKind,
};

use super::audit_json;
use super::mapping::{
    ACCOUNT_CATEGORY_COLUMNS, ACCOUNT_COLUMNS, AUDIT_COLUMNS, CURRENCY_COLUMNS, ENTRY_COLUMNS,
    TRANSACTION_CATEGORY_COLUMNS, format_time, row_to_account, row_to_account_category,
    row_to_audit_event, row_to_currency, row_to_entry, row_to_transaction_category,
};
use super::{SqliteLedgerRepository, storage_error};

impl LedgerRepository for SqliteLedgerRepository {
    fn begin_transaction(&mut self) -> LedgerResult<Box<dyn LedgerTransaction + '_>> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        Ok(Box::new(SqliteLedgerTransaction { transaction }))
    }

    fn get_currency(&self, id: &str, include_archived: bool) -> LedgerResult<Option<Currency>> {
        get_currency_on(&self.connection, id, include_archived)
    }

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

    fn list_entries(&self, query: &EntryQuery) -> LedgerResult<Vec<LedgerEntry>> {
        let visibility = if query.include_archived {
            ""
        } else {
            "WHERE deleted_at IS NULL"
        };
        let sql = format!(
            "SELECT {ENTRY_COLUMNS}
             FROM ledger_entries
             {visibility}
             ORDER BY date, written_at, id
             LIMIT ?1 OFFSET ?2"
        );
        collect_entries(
            &self.connection,
            &sql,
            params![i64::from(query.limit), i64::from(query.offset)],
        )
    }

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

    fn list_entries_by_transfer_group(
        &self,
        transfer_group_id: &str,
        include_archived: bool,
    ) -> LedgerResult<Vec<LedgerEntry>> {
        list_entries_by_transfer_group_on(&self.connection, transfer_group_id, include_archived)
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
             ORDER BY occurred_at, id
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
