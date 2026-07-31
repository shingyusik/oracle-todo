use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
    UpdateAccount, UpdateAccountCategory, UpdateCurrency, UpdateTransactionCategory,
};
use ledger_engine::application::error::LedgerError;
use ledger_engine::application::ports::Page;
use ledger_engine::application::service::LedgerService;
use ledger_engine::domain::{EntryType, Money, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use rusqlite::Connection;
use time::macros::datetime;

#[test]
fn referenced_transaction_category_kind_is_immutable() {
    let mut fixture = master_fixture();
    let entry = fixture
        .service
        .create_entry(expense(&fixture.leaf_category_id))
        .unwrap();
    let audit_before = fixture
        .service
        .audit_page(
            "transaction_category",
            &fixture.leaf_category_id,
            Page::default(),
        )
        .unwrap();

    let error = fixture
        .service
        .update_category(
            &fixture.leaf_category_id,
            UpdateTransactionCategory {
                kind: Some(TransactionCategoryKind::Income),
                actor: "test".to_string(),
                ..UpdateTransactionCategory::default()
            },
        )
        .unwrap_err();

    assert!(matches!(error, LedgerError::Conflict(message) if message.contains("referenced")));
    assert_eq!(fixture.service.get_entry(entry.id()).unwrap(), entry);
    assert_eq!(
        fixture
            .service
            .audit_page(
                "transaction_category",
                &fixture.leaf_category_id,
                Page::default(),
            )
            .unwrap(),
        audit_before
    );
}

#[test]
fn parent_transaction_category_kind_is_immutable_while_children_exist() {
    let mut fixture = master_fixture();
    let child = fixture
        .service
        .create_category(CreateTransactionCategory {
            name: "Groceries".to_string(),
            parent: Some(fixture.parent_category_id.clone()),
            kind: TransactionCategoryKind::Expense,
            actor: "test".to_string(),
        })
        .unwrap();

    let error = fixture
        .service
        .update_category(
            &fixture.parent_category_id,
            UpdateTransactionCategory {
                kind: Some(TransactionCategoryKind::Income),
                actor: "test".to_string(),
                ..UpdateTransactionCategory::default()
            },
        )
        .unwrap_err();
    assert!(matches!(error, LedgerError::Conflict(message) if message.contains("children")));
    assert_eq!(
        fixture
            .service
            .audit_page("transaction_category", child.id(), Page::default())
            .unwrap()
            .items
            .len(),
        1
    );
}

#[test]
fn unreferenced_leaf_transaction_category_kind_can_change() {
    let mut fixture = master_fixture();
    let category = fixture
        .service
        .create_category(CreateTransactionCategory {
            name: "Unclassified".to_string(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "test".to_string(),
        })
        .unwrap();

    let updated = fixture
        .service
        .update_category(
            category.id(),
            UpdateTransactionCategory {
                kind: Some(TransactionCategoryKind::Income),
                actor: "test".to_string(),
                reason: Some("correct kind".to_string()),
                ..UpdateTransactionCategory::default()
            },
        )
        .unwrap();
    assert_eq!(updated.kind(), TransactionCategoryKind::Income);
}

#[test]
fn referenced_currency_precision_and_account_currency_are_immutable() {
    let mut fixture = master_fixture();
    let entry = fixture
        .service
        .create_entry(expense(&fixture.leaf_category_id))
        .unwrap();

    assert!(matches!(
        fixture.service.update_currency(
            &fixture.krw_id,
            UpdateCurrency {
                decimal_places: Some(2),
                actor: "test".to_string(),
                ..UpdateCurrency::default()
            }
        ),
        Err(LedgerError::Conflict(message)) if message.contains("decimal")
    ));
    assert!(matches!(
        fixture.service.update_account(
            &fixture.wallet_id,
            UpdateAccount {
                currency: Some(fixture.usd_id.clone()),
                actor: "test".to_string(),
                ..UpdateAccount::default()
            }
        ),
        Err(LedgerError::Conflict(message)) if message.contains("currency")
    ));
    assert_eq!(fixture.service.get_entry(entry.id()).unwrap(), entry);
}

#[test]
fn unreferenced_currency_precision_and_account_currency_can_change() {
    let mut fixture = master_fixture();
    let spare_currency = fixture
        .service
        .create_currency(CreateCurrency {
            code: "JPY".to_string(),
            name: "Japanese yen".to_string(),
            symbol: "¥".to_string(),
            decimal_places: 0,
            actor: "test".to_string(),
        })
        .unwrap();
    let spare_account = fixture
        .service
        .create_account(CreateAccount {
            name: "Spare".to_string(),
            category: fixture.account_category_id.clone(),
            currency: fixture.krw_id.clone(),
            opening_balance: Money::from_minor_units(0),
            actor: "test".to_string(),
        })
        .unwrap();

    let currency = fixture
        .service
        .update_currency(
            spare_currency.id(),
            UpdateCurrency {
                decimal_places: Some(2),
                actor: "test".to_string(),
                ..UpdateCurrency::default()
            },
        )
        .unwrap();
    let account = fixture
        .service
        .update_account(
            spare_account.id(),
            UpdateAccount {
                currency: Some(fixture.usd_id.clone()),
                actor: "test".to_string(),
                ..UpdateAccount::default()
            },
        )
        .unwrap();
    assert_eq!(currency.decimal_places(), 2);
    assert_eq!(account.currency_id(), fixture.usd_id);
}

#[test]
fn omitted_inactive_transaction_parent_is_preserved_and_kind_checked() {
    let mut fixture = master_fixture();
    let child = fixture
        .service
        .create_category(CreateTransactionCategory {
            name: "Child".to_string(),
            parent: Some(fixture.parent_category_id.clone()),
            kind: TransactionCategoryKind::Expense,
            actor: "test".to_string(),
        })
        .unwrap();
    fixture
        .service
        .update_category(
            &fixture.parent_category_id,
            UpdateTransactionCategory {
                active: Some(false),
                actor: "test".to_string(),
                ..UpdateTransactionCategory::default()
            },
        )
        .unwrap();

    let unrelated = fixture
        .service
        .update_category(
            child.id(),
            UpdateTransactionCategory {
                name: Some("Renamed child".to_string()),
                actor: "test".to_string(),
                ..UpdateTransactionCategory::default()
            },
        )
        .unwrap();
    let same_kind = fixture
        .service
        .update_category(
            child.id(),
            UpdateTransactionCategory {
                kind: Some(TransactionCategoryKind::Expense),
                actor: "test".to_string(),
                ..UpdateTransactionCategory::default()
            },
        )
        .unwrap();
    assert_eq!(
        unrelated.parent_id(),
        Some(fixture.parent_category_id.as_str())
    );
    assert_eq!(
        same_kind.parent_id(),
        Some(fixture.parent_category_id.as_str())
    );
    assert!(matches!(
        fixture.service.update_category(
            child.id(),
            UpdateTransactionCategory {
                kind: Some(TransactionCategoryKind::Income),
                actor: "test".to_string(),
                ..UpdateTransactionCategory::default()
            }
        ),
        Err(LedgerError::Validation {
            field: "parent",
            ..
        })
    ));
}

#[test]
fn omitted_deleted_transaction_parent_is_preserved_and_kind_checked() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut fixture = master_fixture_at(&database);
    let child = fixture
        .service
        .create_category(CreateTransactionCategory {
            name: "Child".to_string(),
            parent: Some(fixture.parent_category_id.clone()),
            kind: TransactionCategoryKind::Expense,
            actor: "test".to_string(),
        })
        .unwrap();
    let child_id = child.id().to_string();
    let parent_id = fixture.parent_category_id.clone();
    drop(fixture);

    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "UPDATE transaction_categories
             SET deleted_at = '2026-07-30T02:00:00Z'
             WHERE id = ?1",
            [&parent_id],
        )
        .unwrap();
    drop(connection);
    let mut service = LedgerService::new(SqliteLedgerRepository::open(&database).unwrap());

    let unrelated = service
        .update_category(
            &child_id,
            UpdateTransactionCategory {
                name: Some("Renamed child".to_string()),
                actor: "test".to_string(),
                ..UpdateTransactionCategory::default()
            },
        )
        .unwrap();
    let same_kind = service
        .update_category(
            &child_id,
            UpdateTransactionCategory {
                kind: Some(TransactionCategoryKind::Expense),
                actor: "test".to_string(),
                ..UpdateTransactionCategory::default()
            },
        )
        .unwrap();
    assert_eq!(unrelated.parent_id(), Some(parent_id.as_str()));
    assert_eq!(same_kind.parent_id(), Some(parent_id.as_str()));
    assert!(matches!(
        service.update_category(
            &child_id,
            UpdateTransactionCategory {
                kind: Some(TransactionCategoryKind::Income),
                actor: "test".to_string(),
                ..UpdateTransactionCategory::default()
            }
        ),
        Err(LedgerError::Validation {
            field: "parent",
            ..
        })
    ));
}

#[test]
fn account_category_hierarchy_rejects_self_two_node_and_multi_node_cycles() {
    let mut fixture = master_fixture();
    let root = fixture.account_category_id.clone();
    let child = fixture
        .service
        .create_account_category(CreateAccountCategory {
            name: "Child account category".to_string(),
            parent: Some(root.clone()),
            liability: false,
            actor: "test".to_string(),
        })
        .unwrap();
    let grandchild = fixture
        .service
        .create_account_category(CreateAccountCategory {
            name: "Grandchild account category".to_string(),
            parent: Some(child.id().to_string()),
            liability: false,
            actor: "test".to_string(),
        })
        .unwrap();

    assert_account_category_cycle(&mut fixture.service, &root, &root);
    assert_account_category_cycle(&mut fixture.service, &root, child.id());
    assert_account_category_cycle(&mut fixture.service, &root, grandchild.id());

    let reparented = fixture
        .service
        .update_account_category(
            grandchild.id(),
            UpdateAccountCategory {
                parent: Some(Some(root.clone())),
                actor: "test".to_string(),
                ..UpdateAccountCategory::default()
            },
        )
        .unwrap();
    assert_eq!(reparented.parent_id(), Some(root.as_str()));
}

#[test]
fn transaction_category_hierarchy_rejects_self_two_node_and_multi_node_cycles() {
    let mut fixture = master_fixture();
    let root = fixture.parent_category_id.clone();
    let child = fixture
        .service
        .create_category(CreateTransactionCategory {
            name: "Child transaction category".to_string(),
            parent: Some(root.clone()),
            kind: TransactionCategoryKind::Expense,
            actor: "test".to_string(),
        })
        .unwrap();
    let grandchild = fixture
        .service
        .create_category(CreateTransactionCategory {
            name: "Grandchild transaction category".to_string(),
            parent: Some(child.id().to_string()),
            kind: TransactionCategoryKind::Expense,
            actor: "test".to_string(),
        })
        .unwrap();

    assert_transaction_category_cycle(&mut fixture.service, &root, &root);
    assert_transaction_category_cycle(&mut fixture.service, &root, child.id());
    assert_transaction_category_cycle(&mut fixture.service, &root, grandchild.id());

    let reparented = fixture
        .service
        .update_category(
            grandchild.id(),
            UpdateTransactionCategory {
                parent: Some(Some(root.clone())),
                actor: "test".to_string(),
                ..UpdateTransactionCategory::default()
            },
        )
        .unwrap();
    assert_eq!(reparented.parent_id(), Some(root.as_str()));
}

#[test]
fn hierarchy_reparenting_fails_closed_when_the_proposed_ancestry_is_already_cyclic() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut fixture = master_fixture_at(&database);
    let account_a = fixture
        .service
        .create_account_category(CreateAccountCategory {
            name: "Corrupt account A".to_string(),
            parent: None,
            liability: false,
            actor: "test".to_string(),
        })
        .unwrap();
    let account_b = fixture
        .service
        .create_account_category(CreateAccountCategory {
            name: "Corrupt account B".to_string(),
            parent: None,
            liability: false,
            actor: "test".to_string(),
        })
        .unwrap();
    let transaction_a = fixture
        .service
        .create_category(CreateTransactionCategory {
            name: "Corrupt transaction A".to_string(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "test".to_string(),
        })
        .unwrap();
    let transaction_b = fixture
        .service
        .create_category(CreateTransactionCategory {
            name: "Corrupt transaction B".to_string(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "test".to_string(),
        })
        .unwrap();
    let account_target = fixture.account_category_id.clone();
    let transaction_target = fixture.parent_category_id.clone();
    let account_a_id = account_a.id().to_string();
    let account_b_id = account_b.id().to_string();
    let transaction_a_id = transaction_a.id().to_string();
    let transaction_b_id = transaction_b.id().to_string();
    drop(fixture);

    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "UPDATE account_categories SET parent_id = ?1 WHERE id = ?2",
            [&account_b_id, &account_a_id],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE account_categories SET parent_id = ?1 WHERE id = ?2",
            [&account_a_id, &account_b_id],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE transaction_categories SET parent_id = ?1 WHERE id = ?2",
            [&transaction_b_id, &transaction_a_id],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE transaction_categories SET parent_id = ?1 WHERE id = ?2",
            [&transaction_a_id, &transaction_b_id],
        )
        .unwrap();
    drop(connection);

    let mut service = LedgerService::new(SqliteLedgerRepository::open(&database).unwrap());
    assert_account_category_cycle(&mut service, &account_target, &account_a_id);
    assert_transaction_category_cycle(&mut service, &transaction_target, &transaction_a_id);
}

fn assert_account_category_cycle(
    service: &mut LedgerService<SqliteLedgerRepository>,
    id: &str,
    parent: &str,
) {
    assert!(matches!(
        service.update_account_category(
            id,
            UpdateAccountCategory {
                parent: Some(Some(parent.to_string())),
                actor: "test".to_string(),
                ..UpdateAccountCategory::default()
            }
        ),
        Err(LedgerError::Conflict(message)) if message.contains("cycle")
    ));
}

fn assert_transaction_category_cycle(
    service: &mut LedgerService<SqliteLedgerRepository>,
    id: &str,
    parent: &str,
) {
    assert!(matches!(
        service.update_category(
            id,
            UpdateTransactionCategory {
                parent: Some(Some(parent.to_string())),
                actor: "test".to_string(),
                ..UpdateTransactionCategory::default()
            }
        ),
        Err(LedgerError::Conflict(message)) if message.contains("cycle")
    ));
}

struct MasterFixture {
    service: LedgerService<SqliteLedgerRepository>,
    krw_id: String,
    usd_id: String,
    account_category_id: String,
    wallet_id: String,
    parent_category_id: String,
    leaf_category_id: String,
}

fn master_fixture() -> MasterFixture {
    master_fixture_with(SqliteLedgerRepository::open_in_memory().unwrap())
}

fn master_fixture_at(path: &std::path::Path) -> MasterFixture {
    master_fixture_with(SqliteLedgerRepository::open(path).unwrap())
}

fn master_fixture_with(repository: SqliteLedgerRepository) -> MasterFixture {
    let mut service = LedgerService::new(repository);
    let krw = service
        .create_currency(CreateCurrency {
            code: "KRW".to_string(),
            name: "Korean won".to_string(),
            symbol: "₩".to_string(),
            decimal_places: 0,
            actor: "test".to_string(),
        })
        .unwrap();
    let usd = service
        .create_currency(CreateCurrency {
            code: "USD".to_string(),
            name: "US dollar".to_string(),
            symbol: "$".to_string(),
            decimal_places: 2,
            actor: "test".to_string(),
        })
        .unwrap();
    let account_category = service
        .create_account_category(CreateAccountCategory {
            name: "Cash".to_string(),
            parent: None,
            liability: false,
            actor: "test".to_string(),
        })
        .unwrap();
    let wallet = service
        .create_account(CreateAccount {
            name: "Wallet".to_string(),
            category: account_category.id().to_string(),
            currency: krw.id().to_string(),
            opening_balance: Money::from_minor_units(0),
            actor: "test".to_string(),
        })
        .unwrap();
    let parent = service
        .create_category(CreateTransactionCategory {
            name: "Expenses".to_string(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "test".to_string(),
        })
        .unwrap();
    let leaf = service
        .create_category(CreateTransactionCategory {
            name: "Food".to_string(),
            parent: Some(parent.id().to_string()),
            kind: TransactionCategoryKind::Expense,
            actor: "test".to_string(),
        })
        .unwrap();
    MasterFixture {
        service,
        krw_id: krw.id().to_string(),
        usd_id: usd.id().to_string(),
        account_category_id: account_category.id().to_string(),
        wallet_id: wallet.id().to_string(),
        parent_category_id: parent.id().to_string(),
        leaf_category_id: leaf.id().to_string(),
    }
}

fn expense(category: &str) -> CreateEntry {
    CreateEntry {
        date: "2026-07-30".to_string(),
        written_at: datetime!(2026-07-30 01:02:03 UTC),
        content: "Lunch".to_string(),
        category: Some(category.to_string()),
        account: "Wallet".to_string(),
        entry_type: EntryType::Expense,
        amount: Money::from_minor_units(100),
        currency: "KRW".to_string(),
        transfer_group: None,
        source: "test".to_string(),
        notes: None,
        actor: "test".to_string(),
    }
}
