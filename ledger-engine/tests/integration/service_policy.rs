use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
    UpdateAccount, UpdateCurrency, UpdateEntry,
};
use ledger_engine::application::error::LedgerError;
use ledger_engine::application::ports::Page;
use ledger_engine::application::service::LedgerService;
use ledger_engine::domain::{EntryType, Money, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use rusqlite::Connection;
use time::macros::datetime;
use uuid::Uuid;

type TestService = LedgerService<SqliteLedgerRepository>;

#[test]
fn expense_requires_an_active_compatible_category() {
    let mut service = seeded_service();

    let missing = service.create_entry(create_entry(EntryType::Expense, None, "Wallet", "KRW"));
    assert!(matches!(
        missing,
        Err(LedgerError::Validation {
            field: "category",
            ..
        })
    ));

    let incompatible = service.create_entry(create_entry(
        EntryType::Expense,
        Some("Salary"),
        "Wallet",
        "KRW",
    ));
    assert!(matches!(
        incompatible,
        Err(LedgerError::Validation {
            field: "category",
            ..
        })
    ));

    let entry = service
        .create_entry(create_entry(
            EntryType::Expense,
            Some("Food"),
            "Wallet",
            "KRW",
        ))
        .unwrap();
    assert_eq!(
        entry.transaction_category_id(),
        Some(category_id(&service, "Food").as_str())
    );
}

#[test]
fn normal_entry_creation_forbids_transfer_types_and_transfer_group_input() {
    for entry_type in [EntryType::TransferOut, EntryType::TransferIn] {
        let error = seeded_service()
            .create_entry(create_entry(entry_type, None, "Wallet", "KRW"))
            .unwrap_err();
        assert!(matches!(
            error,
            LedgerError::Validation {
                field: "entry_type",
                ..
            }
        ));
    }

    let mut service = seeded_service();
    let mut command = create_entry(EntryType::Expense, Some("Food"), "Wallet", "KRW");
    command.transfer_group = Some("caller-controlled".to_string());
    assert!(matches!(
        service.create_entry(command),
        Err(LedgerError::Validation {
            field: "transfer_group",
            ..
        })
    ));
}

#[test]
fn adjustments_allow_no_category_but_reject_an_incompatible_one() {
    let mut service = seeded_service();
    assert!(
        service
            .create_entry(create_entry(
                EntryType::AdjustmentOut,
                None,
                "Wallet",
                "KRW",
            ))
            .is_ok()
    );
    assert!(
        service
            .create_entry(create_entry(
                EntryType::AdjustmentIn,
                Some("Salary"),
                "Wallet",
                "KRW",
            ))
            .is_ok()
    );
    assert!(matches!(
        service.create_entry(create_entry(
            EntryType::AdjustmentIn,
            Some("Food"),
            "Wallet",
            "KRW",
        )),
        Err(LedgerError::Validation {
            field: "category",
            ..
        })
    ));
}

#[test]
fn references_resolve_by_id_code_or_unique_active_name() {
    let mut service = seeded_service();
    let wallet_id = account_id(&service, "Wallet");
    let food_id = category_id(&service, "Food");
    let krw_id = currency_id(&service, "KRW");

    let by_names = service
        .create_entry(create_entry(
            EntryType::Expense,
            Some("Food"),
            "Wallet",
            "Korean won",
        ))
        .unwrap();
    assert_eq!(by_names.account_id(), wallet_id);
    assert_eq!(by_names.transaction_category_id(), Some(food_id.as_str()));
    assert_eq!(by_names.currency_id(), krw_id);

    let by_ids = service
        .create_entry(create_entry(
            EntryType::Expense,
            Some(&food_id),
            &wallet_id,
            "KRW",
        ))
        .unwrap();
    assert_eq!(by_ids.account_id(), wallet_id);
    assert_eq!(by_ids.transaction_category_id(), Some(food_id.as_str()));
    assert_eq!(by_ids.currency_id(), krw_id);
}

#[test]
fn missing_ambiguous_inactive_and_deleted_references_are_distinct() {
    let mut service = seeded_service();
    let missing = service
        .create_entry(create_entry(
            EntryType::Expense,
            Some("Food"),
            "Missing",
            "KRW",
        ))
        .unwrap_err();
    assert!(matches!(missing, LedgerError::NotFound(message) if message.contains("account")));

    service
        .create_account(CreateAccount {
            name: "Wallet".to_string(),
            category: "Cash".to_string(),
            currency: "KRW".to_string(),
            opening_balance: Money::from_minor_units(0),
            actor: "test".to_string(),
        })
        .unwrap();
    let ambiguous = service
        .create_entry(create_entry(
            EntryType::Expense,
            Some("Food"),
            "Wallet",
            "KRW",
        ))
        .unwrap_err();
    assert!(matches!(ambiguous, LedgerError::Conflict(message) if message.contains("ambiguous")));

    let food = category_id(&service, "Food");
    let krw_id = currency_id(&service, "KRW");
    service
        .update_currency(
            &krw_id,
            UpdateCurrency {
                active: Some(false),
                actor: "test".to_string(),
                reason: Some("retired".to_string()),
                ..UpdateCurrency::default()
            },
        )
        .unwrap();
    let inactive = service
        .create_entry(create_entry(
            EntryType::Expense,
            Some(&food),
            "Bank",
            &krw_id,
        ))
        .unwrap_err();
    assert!(matches!(inactive, LedgerError::Conflict(message) if message.contains("inactive")));
}

#[test]
fn active_currency_precision_projection_preserves_reference_policy() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut service = seed_repository(SqliteLedgerRepository::open(&database).unwrap());
    let primary = service
        .create_currency(CreateCurrency {
            code: "PRC".to_string(),
            name: "Primary precision".to_string(),
            symbol: "P".to_string(),
            decimal_places: 3,
            actor: "test".to_string(),
        })
        .unwrap();
    service
        .create_currency(CreateCurrency {
            code: "ALT".to_string(),
            name: "PRC".to_string(),
            symbol: "A".to_string(),
            decimal_places: 2,
            actor: "test".to_string(),
        })
        .unwrap();
    for code in ["AM1", "AM2"] {
        service
            .create_currency(CreateCurrency {
                code: code.to_string(),
                name: "Ambiguous precision".to_string(),
                symbol: code.to_string(),
                decimal_places: 4,
                actor: "test".to_string(),
            })
            .unwrap();
    }
    let inactive = service
        .create_currency(CreateCurrency {
            code: "INA".to_string(),
            name: "Inactive precision".to_string(),
            symbol: "I".to_string(),
            decimal_places: 5,
            actor: "test".to_string(),
        })
        .unwrap();
    service
        .update_currency(
            inactive.id(),
            UpdateCurrency {
                active: Some(false),
                actor: "test".to_string(),
                ..UpdateCurrency::default()
            },
        )
        .unwrap();
    let deleted = service
        .create_currency(CreateCurrency {
            code: "DEL".to_string(),
            name: "Deleted precision".to_string(),
            symbol: "D".to_string(),
            decimal_places: 6,
            actor: "test".to_string(),
        })
        .unwrap();
    let deleted_id = deleted.id().to_string();
    drop(service);

    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "UPDATE currencies
             SET active = 0,
                 updated_at = '2099-07-30T00:00:00Z',
                 deleted_at = '2099-07-30T00:00:00Z'
             WHERE id = ?1",
            [&deleted_id],
        )
        .unwrap();
    drop(connection);

    let mut service = LedgerService::new(SqliteLedgerRepository::open(&database).unwrap());
    assert_eq!(
        service
            .resolve_active_currency_precision(primary.id())
            .unwrap(),
        3
    );
    assert_eq!(
        service.resolve_active_currency_precision("PRC").unwrap(),
        3,
        "code resolution must precede active-name resolution"
    );
    assert_eq!(
        service
            .resolve_active_currency_precision("Primary precision")
            .unwrap(),
        3
    );
    assert!(matches!(
        service.resolve_active_currency_precision(inactive.id()),
        Err(LedgerError::Conflict(message)) if message.contains("inactive")
    ));
    assert!(matches!(
        service.resolve_active_currency_precision(&deleted_id),
        Err(LedgerError::NotFound(message)) if message.contains("deleted")
    ));
    assert!(matches!(
        service.resolve_active_currency_precision("missing"),
        Err(LedgerError::NotFound(_))
    ));
    assert!(matches!(
        service.resolve_active_currency_precision("Ambiguous precision"),
        Err(LedgerError::Conflict(message)) if message.contains("ambiguous")
    ));
}

#[test]
fn deleted_reference_is_not_resolved_by_id_or_name() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut service = seed_repository(SqliteLedgerRepository::open(&database).unwrap());
    service
        .create_category(CreateTransactionCategory {
            name: "deleted-category-id".to_string(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "test".to_string(),
        })
        .unwrap();
    drop(service);
    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "INSERT INTO transaction_categories (
                id, name, parent_id, kind, active, created_at, updated_at, deleted_at
             ) VALUES (
                'deleted-category-id', 'Deleted food', NULL, 'expense', 1,
                '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z', '2026-07-30T01:00:00Z'
             )",
            [],
        )
        .unwrap();
    drop(connection);

    let mut service = LedgerService::new(SqliteLedgerRepository::open(&database).unwrap());
    let deleted = service
        .create_entry(create_entry(
            EntryType::Expense,
            Some("deleted-category-id"),
            "Wallet",
            "KRW",
        ))
        .unwrap_err();
    assert!(matches!(deleted, LedgerError::NotFound(message) if message.contains("category")));
}

#[test]
fn create_commands_expose_no_caller_id_and_generate_uuid_ids() {
    let mut service = seeded_service();
    let entry = service
        .create_entry(create_entry(
            EntryType::Expense,
            Some("Food"),
            "Wallet",
            "KRW",
        ))
        .unwrap();

    assert!(Uuid::parse_str(entry.id()).is_ok());
    assert!(Uuid::parse_str(account_id(&service, "Wallet").as_str()).is_ok());
    assert!(Uuid::parse_str(category_id(&service, "Food").as_str()).is_ok());
    assert!(Uuid::parse_str(currency_id(&service, "KRW").as_str()).is_ok());
}

#[test]
fn partial_update_preserves_historical_references_but_rejects_new_invalid_refs() {
    let mut service = seeded_service();
    let entry = service
        .create_entry(create_entry(
            EntryType::Expense,
            Some("Food"),
            "Wallet",
            "KRW",
        ))
        .unwrap();
    let original_account = entry.account_id().to_string();
    let original_category = entry.transaction_category_id().unwrap().to_string();
    let original_currency = entry.currency_id().to_string();

    service
        .update_account(
            &original_account,
            UpdateAccount {
                active: Some(false),
                actor: "test".to_string(),
                reason: Some("closed".to_string()),
                ..UpdateAccount::default()
            },
        )
        .unwrap();
    service
        .update_currency(
            &original_currency,
            UpdateCurrency {
                active: Some(false),
                actor: "test".to_string(),
                reason: Some("retired".to_string()),
                ..UpdateCurrency::default()
            },
        )
        .unwrap();

    let updated = service
        .update_entry(
            entry.id(),
            UpdateEntry {
                content: Some("Dinner".to_string()),
                notes: Some(Some("team meal".to_string())),
                actor: "test".to_string(),
                reason: Some("correct description".to_string()),
                ..UpdateEntry::default()
            },
        )
        .unwrap();
    assert_eq!(updated.content(), "Dinner");
    assert_eq!(updated.notes(), Some("team meal"));
    assert_eq!(updated.account_id(), original_account);
    assert_eq!(
        updated.transaction_category_id(),
        Some(original_category.as_str())
    );
    assert_eq!(updated.currency_id(), original_currency);
    assert_eq!(updated.created_at(), entry.created_at());
    assert!(updated.updated_at() >= entry.updated_at());

    let explicit_inactive = service
        .update_entry(
            entry.id(),
            UpdateEntry {
                account: Some(original_account),
                actor: "test".to_string(),
                ..UpdateEntry::default()
            },
        )
        .unwrap_err();
    assert!(
        matches!(explicit_inactive, LedgerError::Conflict(message) if message.contains("inactive"))
    );
}

#[test]
fn update_rejects_missing_entries_and_explicit_transfer_fields() {
    let mut service = seeded_service();
    assert!(matches!(
        service.update_entry(
            "missing",
            UpdateEntry {
                actor: "test".to_string(),
                ..UpdateEntry::default()
            },
        ),
        Err(LedgerError::NotFound(message)) if message.contains("entry")
    ));

    let entry = service
        .create_entry(create_entry(
            EntryType::Expense,
            Some("Food"),
            "Wallet",
            "KRW",
        ))
        .unwrap();
    assert!(matches!(
        service.update_entry(
            entry.id(),
            UpdateEntry {
                entry_type: Some(EntryType::TransferOut),
                actor: "test".to_string(),
                ..UpdateEntry::default()
            },
        ),
        Err(LedgerError::Validation {
            field: "entry_type",
            ..
        })
    ));
    assert!(matches!(
        service.update_entry(
            entry.id(),
            UpdateEntry {
                transfer_group: Some(Some("caller-controlled".to_string())),
                actor: "test".to_string(),
                ..UpdateEntry::default()
            },
        ),
        Err(LedgerError::Validation {
            field: "transfer_group",
            ..
        })
    ));
}

#[test]
fn changing_entry_direction_revalidates_the_preserved_category_kind() {
    let mut service = seeded_service();
    let entry = service
        .create_entry(create_entry(
            EntryType::Expense,
            Some("Food"),
            "Wallet",
            "KRW",
        ))
        .unwrap();

    let error = service
        .update_entry(
            entry.id(),
            UpdateEntry {
                entry_type: Some(EntryType::Income),
                actor: "test".to_string(),
                ..UpdateEntry::default()
            },
        )
        .unwrap_err();
    assert!(matches!(
        error,
        LedgerError::Validation {
            field: "category",
            ..
        }
    ));
}

fn seeded_service() -> TestService {
    seed_repository(SqliteLedgerRepository::open_in_memory().unwrap())
}

fn seed_repository(repository: SqliteLedgerRepository) -> TestService {
    let mut service = LedgerService::new(repository);
    service
        .create_currency(CreateCurrency {
            code: "KRW".to_string(),
            name: "Korean won".to_string(),
            symbol: "₩".to_string(),
            decimal_places: 0,
            actor: "test".to_string(),
        })
        .unwrap();
    service
        .create_account_category(CreateAccountCategory {
            name: "Cash".to_string(),
            parent: None,
            liability: false,
            actor: "test".to_string(),
        })
        .unwrap();
    service
        .create_account(CreateAccount {
            name: "Wallet".to_string(),
            category: "Cash".to_string(),
            currency: "KRW".to_string(),
            opening_balance: Money::from_minor_units(0),
            actor: "test".to_string(),
        })
        .unwrap();
    service
        .create_account(CreateAccount {
            name: "Bank".to_string(),
            category: "Cash".to_string(),
            currency: "KRW".to_string(),
            opening_balance: Money::from_minor_units(0),
            actor: "test".to_string(),
        })
        .unwrap();
    for (name, kind) in [
        ("Food", TransactionCategoryKind::Expense),
        ("Salary", TransactionCategoryKind::Income),
    ] {
        service
            .create_category(CreateTransactionCategory {
                name: name.to_string(),
                parent: None,
                kind,
                actor: "test".to_string(),
            })
            .unwrap();
    }
    service
}

fn create_entry(
    entry_type: EntryType,
    category: Option<&str>,
    account: &str,
    currency: &str,
) -> CreateEntry {
    CreateEntry {
        date: "2026-07-30".to_string(),
        written_at: datetime!(2026-07-30 01:02:03 UTC),
        content: "Lunch".to_string(),
        category: category.map(str::to_string),
        account: account.to_string(),
        entry_type,
        amount: Money::from_minor_units(12_500),
        currency: currency.to_string(),
        transfer_group: None,
        source: "test".to_string(),
        notes: None,
        actor: "test".to_string(),
    }
}

fn account_id(service: &TestService, name: &str) -> String {
    service
        .accounts_page(Page::default())
        .unwrap()
        .items
        .into_iter()
        .find(|account| account.name() == name)
        .unwrap()
        .id()
        .to_string()
}

fn category_id(service: &TestService, name: &str) -> String {
    service
        .transaction_categories_page(Page::default())
        .unwrap()
        .items
        .into_iter()
        .find(|category| category.name() == name)
        .unwrap()
        .id()
        .to_string()
}

fn currency_id(service: &TestService, code: &str) -> String {
    service
        .currencies_page(Page::default())
        .unwrap()
        .items
        .into_iter()
        .find(|currency| currency.code() == code)
        .unwrap()
        .id()
        .to_string()
}
