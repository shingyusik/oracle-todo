use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, UpdateAccount,
};
use ledger_engine::application::error::LedgerError;
use ledger_engine::application::export::ExportOptions;
use ledger_engine::application::ports::Page;
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::table::{
    AccountTableFilterField, AccountTableGroup, AccountTableSortField, FilterMode, GroupSort,
    LedgerFilterOperator, LedgerTableFilter, LedgerTableFilterValue, LedgerTableGroup,
    LedgerTableGroupSettings, LedgerTableQuery, LedgerTableRecord, LedgerTableScope,
    LedgerTableSort, SortDirection, TABLE_PAGE_LIMIT,
};
use ledger_engine::domain::{Account, Money};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use rusqlite::Connection;
use serde_json::Value;
use std::path::Path;

type Service = LedgerService<SqliteLedgerRepository>;

#[test]
fn create_account_trims_purpose_and_records_it_in_audit() {
    let mut service = seeded_service(SqliteLedgerRepository::open_in_memory().unwrap());

    let account = create(&mut service, "Wallet", Some("  Daily spending  "));

    assert_eq!(account.purpose(), Some("Daily spending"));
    assert_eq!(
        fetch(&service, account.id()).purpose(),
        Some("Daily spending")
    );
    let audit = service
        .audit_page("account", account.id(), Page::default())
        .unwrap();
    assert_eq!(
        audit.items[0].after.as_ref().unwrap()["purpose"],
        "Daily spending"
    );
}

#[test]
fn create_account_without_or_with_blank_purpose_stores_null() {
    let mut service = seeded_service(SqliteLedgerRepository::open_in_memory().unwrap());

    let omitted = create(&mut service, "Wallet", None);
    let blank = create(&mut service, "Bank", Some("   "));

    assert_eq!(omitted.purpose(), None);
    assert_eq!(blank.purpose(), None);
    assert_eq!(fetch(&service, blank.id()).purpose(), None);
}

#[test]
fn update_account_sets_preserves_and_clears_purpose() {
    let mut service = seeded_service(SqliteLedgerRepository::open_in_memory().unwrap());
    let account = create(&mut service, "Wallet", None);

    let set = service
        .update_account(account.id(), purpose_update(Some(Some(" Rent and bills "))))
        .unwrap();
    assert_eq!(set.purpose(), Some("Rent and bills"));

    let renamed = service
        .update_account(
            account.id(),
            UpdateAccount {
                name: Some("Checking".to_string()),
                actor: "test".to_string(),
                ..UpdateAccount::default()
            },
        )
        .unwrap();
    assert_eq!(renamed.purpose(), Some("Rent and bills"));

    let cleared_by_null = service
        .update_account(account.id(), purpose_update(Some(None)))
        .unwrap();
    assert_eq!(cleared_by_null.purpose(), None);

    service
        .update_account(account.id(), purpose_update(Some(Some("Savings"))))
        .unwrap();
    let cleared_by_blank = service
        .update_account(account.id(), purpose_update(Some(Some("  "))))
        .unwrap();
    assert_eq!(cleared_by_blank.purpose(), None);
    assert_eq!(fetch(&service, account.id()).purpose(), None);

    let audit = service
        .audit_page("account", account.id(), Page::default())
        .unwrap();
    let last = audit.items.last().unwrap();
    assert_eq!(last.before.as_ref().unwrap()["purpose"], "Savings");
    assert_eq!(last.after.as_ref().unwrap()["purpose"], Value::Null);
    assert!(service.doctor().unwrap().healthy);
}

#[test]
fn purpose_longer_than_500_characters_is_rejected_without_mutation() {
    let mut service = seeded_service(SqliteLedgerRepository::open_in_memory().unwrap());
    let too_long = "x".repeat(Account::MAX_PURPOSE_CHARS + 1);

    let create_error = service
        .create_account(CreateAccount {
            name: "Wallet".to_string(),
            category: "Cash".to_string(),
            currency: "KRW".to_string(),
            opening_balance: Money::from_minor_units(0),
            purpose: Some(too_long.clone()),
            actor: "test".to_string(),
        })
        .unwrap_err();
    assert!(
        matches!(&create_error, LedgerError::Validation { field: "purpose", message } if message.contains("500")),
        "{create_error:?}"
    );
    assert!(
        service
            .accounts_page(Page::default())
            .unwrap()
            .items
            .is_empty()
    );

    let account = create(&mut service, "Wallet", Some("Kept"));
    let update_error = service
        .update_account(account.id(), purpose_update(Some(Some(&too_long))))
        .unwrap_err();
    assert!(
        matches!(
            &update_error,
            LedgerError::Validation {
                field: "purpose",
                ..
            }
        ),
        "{update_error:?}"
    );
    assert_eq!(fetch(&service, account.id()).purpose(), Some("Kept"));

    let exactly_max = "가".repeat(Account::MAX_PURPOSE_CHARS);
    let updated = service
        .update_account(account.id(), purpose_update(Some(Some(&exactly_max))))
        .unwrap();
    assert_eq!(updated.purpose(), Some(exactly_max.as_str()));
}

#[test]
fn export_includes_account_purpose() {
    let mut service = seeded_service(SqliteLedgerRepository::open_in_memory().unwrap());
    create(&mut service, "Wallet", Some("Groceries"));
    create(&mut service, "Bank", None);

    let export = serde_json::to_value(service.export(ExportOptions::default()).unwrap()).unwrap();
    let accounts = export["accounts"].as_array().unwrap();

    let purpose_of = |name: &str| {
        accounts
            .iter()
            .find(|account| account["name"] == name)
            .unwrap()["purpose"]
            .clone()
    };
    assert_eq!(purpose_of("Wallet"), "Groceries");
    assert_eq!(purpose_of("Bank"), Value::Null);
    assert!(
        accounts
            .iter()
            .all(|account| account.as_object().unwrap().contains_key("purpose"))
    );
}

#[test]
fn account_table_exposes_filters_and_sorts_purpose() {
    let mut service = seeded_service(SqliteLedgerRepository::open_in_memory().unwrap());
    create(&mut service, "Wallet", Some("Groceries and lunch"));
    create(&mut service, "Bank", Some("Bills"));
    create(&mut service, "Spare", None);

    let names = |service: &Service, filters: Vec<LedgerTableFilter>, direction| {
        service
            .query_table(
                &LedgerTableQuery::new(
                    LedgerTableScope::Accounts,
                    0,
                    TABLE_PAGE_LIMIT,
                    FilterMode::And,
                    filters,
                    vec![LedgerTableSort::Accounts {
                        field: AccountTableSortField::Purpose,
                        direction,
                    }],
                    LedgerTableGroupSettings::new(
                        LedgerTableGroup::Accounts(AccountTableGroup::None),
                        GroupSort::Manual,
                        true,
                        vec![],
                        vec![],
                    )
                    .unwrap(),
                    None,
                )
                .unwrap(),
            )
            .unwrap()
            .items
            .iter()
            .map(|row| match row.record() {
                LedgerTableRecord::Accounts(record) => (
                    record.name.clone(),
                    record.account.purpose().map(str::to_string),
                ),
                _ => unreachable!(),
            })
            .collect::<Vec<_>>()
    };

    let contains = names(
        &service,
        vec![LedgerTableFilter::Accounts {
            field: AccountTableFilterField::Purpose,
            operator: LedgerFilterOperator::Contains,
            value: LedgerTableFilterValue::Text("LUNCH".to_string()),
        }],
        SortDirection::Asc,
    );
    assert_eq!(
        contains,
        vec![(
            "Wallet".to_string(),
            Some("Groceries and lunch".to_string())
        )]
    );

    let empty = names(
        &service,
        vec![LedgerTableFilter::Accounts {
            field: AccountTableFilterField::Purpose,
            operator: LedgerFilterOperator::IsEmpty,
            value: LedgerTableFilterValue::Empty,
        }],
        SortDirection::Asc,
    );
    assert_eq!(empty, vec![("Spare".to_string(), None)]);

    let sorted = names(&service, vec![], SortDirection::Desc)
        .into_iter()
        .map(|(name, _)| name)
        .collect::<Vec<_>>();
    assert_eq!(sorted, ["Wallet", "Bank", "Spare"]);
}

#[test]
fn version_two_database_migrates_existing_accounts_with_null_purpose() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    {
        let mut service = seeded_service(SqliteLedgerRepository::open(&database).unwrap());
        create(&mut service, "Wallet", None);
    }
    downgrade_to_version_two(&database);
    assert!(!column_names(&database, "accounts").contains(&"purpose".to_string()));

    let repository = SqliteLedgerRepository::open(&database).unwrap();
    assert_eq!(repository.schema_version().unwrap(), 3);
    let mut service = LedgerService::new(repository);

    let account = service.accounts_page(Page::default()).unwrap().items[0].clone();
    assert_eq!(account.name(), "Wallet");
    assert_eq!(account.purpose(), None);
    assert!(column_names(&database, "accounts").contains(&"purpose".to_string()));
    let report = service.doctor().unwrap();
    assert!(report.healthy, "{:?}", report.issues);

    let updated = service
        .update_account(account.id(), purpose_update(Some(Some("Migrated use"))))
        .unwrap();
    assert_eq!(updated.purpose(), Some("Migrated use"));
    let report = service.doctor().unwrap();
    assert!(report.healthy, "{:?}", report.issues);
}

#[test]
fn health_rejects_blank_or_oversized_persisted_purpose() {
    for invalid in ["'   '", "printf('%.501c', 'x')"] {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("ledger.sqlite");
        {
            let mut service = seeded_service(SqliteLedgerRepository::open(&database).unwrap());
            create(&mut service, "Wallet", None);
        }
        Connection::open(&database)
            .unwrap()
            .execute_batch(&format!("UPDATE accounts SET purpose = {invalid};"))
            .unwrap();

        match SqliteLedgerRepository::open(&database) {
            Err(LedgerError::Migration(message)) => {
                assert!(message.contains("persisted scalar"), "{message}")
            }
            Err(error) => panic!("unexpected error for {invalid}: {error:?}"),
            Ok(_) => panic!("health accepted invalid purpose {invalid}"),
        }
    }
}

fn downgrade_to_version_two(database: &Path) {
    Connection::open(database)
        .unwrap()
        .execute_batch(
            "ALTER TABLE accounts DROP COLUMN purpose;
             UPDATE audit_events
                SET after_json = json_remove(after_json, '$.purpose')
              WHERE record_type = 'account' AND after_json IS NOT NULL;
             UPDATE audit_events
                SET before_json = json_remove(before_json, '$.purpose')
              WHERE record_type = 'account' AND before_json IS NOT NULL;
             PRAGMA user_version = 2;",
        )
        .unwrap();
}

fn column_names(database: &Path, table: &str) -> Vec<String> {
    let connection = Connection::open(database).unwrap();
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .unwrap();
    statement
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn seeded_service(repository: SqliteLedgerRepository) -> Service {
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
}

fn create(service: &mut Service, name: &str, purpose: Option<&str>) -> Account {
    service
        .create_account(CreateAccount {
            name: name.to_string(),
            category: "Cash".to_string(),
            currency: "KRW".to_string(),
            opening_balance: Money::from_minor_units(0),
            purpose: purpose.map(str::to_string),
            actor: "test".to_string(),
        })
        .unwrap()
}

fn purpose_update(purpose: Option<Option<&str>>) -> UpdateAccount {
    UpdateAccount {
        purpose: purpose.map(|value| value.map(str::to_string)),
        actor: "test".to_string(),
        ..UpdateAccount::default()
    }
}

fn fetch(service: &Service, id: &str) -> Account {
    service
        .accounts_including_inactive_page(Page::default())
        .unwrap()
        .items
        .into_iter()
        .find(|account| account.id() == id)
        .unwrap()
}
