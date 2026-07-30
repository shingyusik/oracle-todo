use rusqlite::Connection;

use crate::application::error::{LedgerError, LedgerResult};

pub(super) fn init_schema(connection: &Connection) -> LedgerResult<()> {
    if let Err(error) = init_schema_inner(connection) {
        let _ = connection.execute_batch("ROLLBACK;");
        return Err(error);
    }
    Ok(())
}

fn init_schema_inner(connection: &Connection) -> LedgerResult<()> {
    connection
        .execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            BEGIN IMMEDIATE;

            CREATE TABLE IF NOT EXISTS currencies (
                id TEXT NOT NULL PRIMARY KEY,
                code TEXT NOT NULL,
                name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                decimal_places INTEGER NOT NULL CHECK (
                    decimal_places >= 0 AND decimal_places <= 18
                ),
                active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE IF NOT EXISTS account_categories (
                id TEXT NOT NULL PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT REFERENCES account_categories(id),
                liability INTEGER NOT NULL DEFAULT 0 CHECK (liability IN (0, 1)),
                active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT NOT NULL PRIMARY KEY,
                name TEXT NOT NULL,
                account_category_id TEXT NOT NULL REFERENCES account_categories(id),
                currency_id TEXT NOT NULL REFERENCES currencies(id),
                opening_balance_minor INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE IF NOT EXISTS transaction_categories (
                id TEXT NOT NULL PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT REFERENCES transaction_categories(id),
                kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
                active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE IF NOT EXISTS ledger_entries (
                id TEXT NOT NULL PRIMARY KEY,
                date TEXT NOT NULL,
                written_at TEXT NOT NULL,
                content TEXT NOT NULL,
                transaction_category_id TEXT REFERENCES transaction_categories(id),
                account_id TEXT NOT NULL REFERENCES accounts(id),
                entry_type TEXT NOT NULL CHECK (
                    entry_type IN (
                        'expense',
                        'income',
                        'transfer_out',
                        'transfer_in',
                        'adjustment_out',
                        'adjustment_in'
                    )
                ),
                amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
                currency_id TEXT NOT NULL REFERENCES currencies(id),
                transfer_group_id TEXT,
                source TEXT NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE IF NOT EXISTS audit_events (
                id TEXT NOT NULL PRIMARY KEY,
                occurred_at TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                record_type TEXT NOT NULL,
                record_id TEXT NOT NULL,
                before_json TEXT,
                after_json TEXT,
                reason TEXT
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_currencies_code
                ON currencies(code);
            CREATE INDEX IF NOT EXISTS idx_account_categories_parent
                ON account_categories(parent_id);
            CREATE INDEX IF NOT EXISTS idx_accounts_category
                ON accounts(account_category_id);
            CREATE INDEX IF NOT EXISTS idx_accounts_currency
                ON accounts(currency_id);
            CREATE INDEX IF NOT EXISTS idx_transaction_categories_parent
                ON transaction_categories(parent_id);
            CREATE INDEX IF NOT EXISTS idx_ledger_entries_date
                ON ledger_entries(date);
            CREATE INDEX IF NOT EXISTS idx_ledger_entries_account
                ON ledger_entries(account_id);
            CREATE INDEX IF NOT EXISTS idx_ledger_entries_category
                ON ledger_entries(transaction_category_id);
            CREATE INDEX IF NOT EXISTS idx_ledger_entries_transfer_group
                ON ledger_entries(transfer_group_id);
            CREATE INDEX IF NOT EXISTS idx_ledger_entries_deleted_at
                ON ledger_entries(deleted_at);
            CREATE INDEX IF NOT EXISTS idx_audit_events_record
                ON audit_events(record_type, record_id);
            CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at
                ON audit_events(occurred_at);

            COMMIT;
            "#,
        )
        .map_err(|error| LedgerError::Migration(error.to_string()))
}
