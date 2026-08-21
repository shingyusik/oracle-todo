use ledger_engine::application::error::LedgerError;
use ledger_engine::application::queries::EntryView;
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::table::{
    AccountTableFilterField, AccountTableGroup, AccountTableRecord, AccountTableSortField,
    CategoryTableFilterField, CategoryTableGroup, CategoryTableRecord, CategoryTableSortField,
    FilterMode, GroupSort, LedgerFilterOperator, LedgerTableFilter, LedgerTableFilterValue,
    LedgerTableGroup, LedgerTableGroupSettings, LedgerTableQuery, LedgerTableRecord,
    LedgerTableRow, LedgerTableScope, LedgerTableSort, SortDirection, TABLE_PAGE_LIMIT, TablePage,
    TransactionRowKind, TransactionTableFilterField, TransactionTableGroup, TransactionTableRecord,
    TransactionTableSortField,
};
use ledger_engine::domain::{
    Account, EntryType, LedgerEntry, LedgerEntryRehydration, Money, TransactionCategory,
    TransactionCategoryKind,
};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use time::macros::datetime;

#[test]
fn table_queries_accept_each_scope_and_both_filter_modes() {
    let transactions = query(
        LedgerTableScope::Transactions,
        FilterMode::And,
        vec![LedgerTableFilter::Transactions {
            field: TransactionTableFilterField::Content,
            operator: LedgerFilterOperator::Contains,
            value: LedgerTableFilterValue::Text("lunch".to_string()),
        }],
        vec![transaction_date_sort()],
        group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::Month)),
    )
    .unwrap();
    assert_eq!(transactions.scope(), LedgerTableScope::Transactions);
    assert_eq!(transactions.filter_mode(), FilterMode::And);

    let accounts = LedgerTableQuery::new(
        LedgerTableScope::Accounts,
        4,
        1,
        FilterMode::Or,
        vec![LedgerTableFilter::Accounts {
            field: AccountTableFilterField::CurrentBalance,
            operator: LedgerFilterOperator::GreaterThan,
            value: LedgerTableFilterValue::Text("0".to_string()),
        }],
        vec![LedgerTableSort::Accounts {
            field: AccountTableSortField::Name,
            direction: SortDirection::Asc,
        }],
        group_settings(LedgerTableGroup::Accounts(AccountTableGroup::Currency)),
    )
    .unwrap();
    assert_eq!(accounts.offset(), 4);
    assert_eq!(accounts.limit(), 1);
    assert_eq!(accounts.filter_mode(), FilterMode::Or);

    let categories = query(
        LedgerTableScope::Categories,
        FilterMode::And,
        vec![LedgerTableFilter::Categories {
            field: CategoryTableFilterField::Parent,
            operator: LedgerFilterOperator::Is,
            value: LedgerTableFilterValue::TextList(vec!["food".to_string()]),
        }],
        vec![LedgerTableSort::Categories {
            field: CategoryTableSortField::Kind,
            direction: SortDirection::Asc,
        }],
        group_settings(LedgerTableGroup::Categories(CategoryTableGroup::Parent)),
    )
    .unwrap();
    assert_eq!(categories.scope(), LedgerTableScope::Categories);
}

#[test]
fn group_settings_preserve_order_policy_and_deduplicate_bounded_keys() {
    let settings = LedgerTableGroupSettings::new(
        LedgerTableGroup::Transactions(TransactionTableGroup::Account),
        GroupSort::Manual,
        true,
        vec!["bank".to_string(), "cash".to_string(), "bank".to_string()],
        vec!["closed".to_string(), "closed".to_string()],
    )
    .unwrap();

    assert_eq!(settings.sort(), GroupSort::Manual);
    assert!(settings.hide_empty());
    assert_eq!(settings.manual_order(), ["bank", "cash"]);
    assert_eq!(settings.hidden_group_keys(), ["closed"]);

    for invalid in [
        vec!["".to_string()],
        (0..101).map(|index| format!("group-{index}")).collect(),
    ] {
        assert!(matches!(
            LedgerTableGroupSettings::new(
                LedgerTableGroup::Transactions(TransactionTableGroup::Account),
                GroupSort::Alphabetical,
                false,
                invalid,
                vec![],
            ),
            Err(LedgerError::Validation {
                field: "group_settings",
                ..
            })
        ));
    }
}

#[test]
fn table_queries_reject_invalid_pages_missing_sorts_and_cross_scope_fields() {
    for limit in [0, TABLE_PAGE_LIMIT + 1] {
        assert!(matches!(
            LedgerTableQuery::new(
                LedgerTableScope::Transactions,
                0,
                limit,
                FilterMode::And,
                vec![],
                vec![transaction_date_sort()],
                group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
            ),
            Err(LedgerError::Validation { field: "page", .. })
        ));
    }

    assert!(matches!(
        query(
            LedgerTableScope::Transactions,
            FilterMode::And,
            vec![],
            vec![],
            group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
        ),
        Err(LedgerError::Validation { field: "sorts", .. })
    ));

    assert!(matches!(
        query(
            LedgerTableScope::Transactions,
            FilterMode::And,
            vec![LedgerTableFilter::Accounts {
                field: AccountTableFilterField::Name,
                operator: LedgerFilterOperator::Contains,
                value: LedgerTableFilterValue::Text("cash".to_string()),
            }],
            vec![transaction_date_sort()],
            group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
        ),
        Err(LedgerError::Validation {
            field: "filters",
            ..
        })
    ));

    assert!(matches!(
        query(
            LedgerTableScope::Transactions,
            FilterMode::And,
            vec![],
            vec![LedgerTableSort::Categories {
                field: CategoryTableSortField::Name,
                direction: SortDirection::Asc,
            }],
            group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
        ),
        Err(LedgerError::Validation { field: "sorts", .. })
    ));

    assert!(matches!(
        query(
            LedgerTableScope::Transactions,
            FilterMode::And,
            vec![],
            vec![transaction_date_sort()],
            group_settings(LedgerTableGroup::Categories(CategoryTableGroup::None)),
        ),
        Err(LedgerError::Validation {
            field: "group_settings",
            ..
        })
    ));
}

#[test]
fn table_queries_reject_operator_and_value_mismatches() {
    let invalid = [
        LedgerTableFilter::Transactions {
            field: TransactionTableFilterField::Date,
            operator: LedgerFilterOperator::Contains,
            value: LedgerTableFilterValue::Text("2026-08-21".to_string()),
        },
        LedgerTableFilter::Transactions {
            field: TransactionTableFilterField::Date,
            operator: LedgerFilterOperator::Is,
            value: LedgerTableFilterValue::Text("not-a-date".to_string()),
        },
        LedgerTableFilter::Transactions {
            field: TransactionTableFilterField::Amount,
            operator: LedgerFilterOperator::GreaterThan,
            value: LedgerTableFilterValue::Text("many".to_string()),
        },
        LedgerTableFilter::Transactions {
            field: TransactionTableFilterField::Content,
            operator: LedgerFilterOperator::Contains,
            value: LedgerTableFilterValue::Text(String::new()),
        },
        LedgerTableFilter::Transactions {
            field: TransactionTableFilterField::Account,
            operator: LedgerFilterOperator::Is,
            value: LedgerTableFilterValue::Text("account-1".to_string()),
        },
        LedgerTableFilter::Transactions {
            field: TransactionTableFilterField::EntryType,
            operator: LedgerFilterOperator::Is,
            value: LedgerTableFilterValue::TextList(vec![]),
        },
        LedgerTableFilter::Transactions {
            field: TransactionTableFilterField::Content,
            operator: LedgerFilterOperator::IsEmpty,
            value: LedgerTableFilterValue::Text("ignored".to_string()),
        },
        LedgerTableFilter::Transactions {
            field: TransactionTableFilterField::Content,
            operator: LedgerFilterOperator::Contains,
            value: LedgerTableFilterValue::Text("x".repeat(513)),
        },
    ];

    for filter in invalid {
        assert!(matches!(
            query(
                LedgerTableScope::Transactions,
                FilterMode::And,
                vec![filter],
                vec![transaction_date_sort()],
                group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
            ),
            Err(LedgerError::Validation {
                field: "filters",
                ..
            })
        ));
    }
}

#[test]
fn logical_record_contract_carries_transfer_and_display_labels() {
    let outgoing = entry_view(
        "out-1",
        EntryType::TransferOut,
        Some("transfer-1"),
        "Wallet",
    );
    let incoming = entry_view("in-1", EntryType::TransferIn, Some("transfer-1"), "Bank");
    let transaction = TransactionTableRecord {
        id: "transfer-1".to_string(),
        archive_entry_id: "out-1".to_string(),
        detail_entry: outgoing,
        transfer_entry: Some(incoming),
        kind: TransactionRowKind::Transfer,
        date: "2026-08-21".to_string(),
        content: "Move cash".to_string(),
        account_ids: vec!["wallet".to_string(), "bank".to_string()],
        account_labels: vec!["Wallet".to_string(), "Bank".to_string()],
        account_label: "Wallet -> Bank".to_string(),
        category_id: None,
        category_label: String::new(),
        amount_minor: 1_000,
        currency_id: "krw".to_string(),
        currency_code: "KRW".to_string(),
        updated_at: "2026-08-21T00:00:00Z".to_string(),
    };
    assert_eq!(transaction.id, "transfer-1");
    assert_eq!(
        transaction.transfer_entry.as_ref().unwrap().entry.id(),
        "in-1"
    );

    let account = Account::new(
        "wallet",
        "Wallet",
        "cash",
        "krw",
        Money::from_minor_units(0),
    )
    .unwrap();
    let account = AccountTableRecord {
        id: "wallet".to_string(),
        account,
        name: "Wallet".to_string(),
        account_type_id: "cash".to_string(),
        account_type_label: "Cash".to_string(),
        currency_id: "krw".to_string(),
        currency_code: "KRW".to_string(),
        decimal_places: 0,
        current_balance_minor: 10_000,
    };
    assert_eq!(account.account_type_label, "Cash");

    let category = category_record("food");
    assert_eq!(category.parent_label, "Living costs");
}

#[test]
fn row_constructor_derives_distinct_deterministic_occurrence_keys() {
    let first = LedgerTableRow::new(
        Some("expense".to_string()),
        Some("Expense".to_string()),
        LedgerTableRecord::Categories(category_record("food")),
    )
    .unwrap();
    let repeated = LedgerTableRow::new(
        Some("expense".to_string()),
        Some("Expense".to_string()),
        LedgerTableRecord::Categories(category_record("food")),
    )
    .unwrap();
    let other_group = LedgerTableRow::new(
        Some("income".to_string()),
        Some("Income".to_string()),
        LedgerTableRecord::Categories(category_record("food")),
    )
    .unwrap();
    let other_record = LedgerTableRow::new(
        Some("expense".to_string()),
        Some("Expense".to_string()),
        LedgerTableRecord::Categories(category_record("salary")),
    )
    .unwrap();

    assert_eq!(first.key(), repeated.key());
    assert_ne!(first.key(), other_group.key());
    assert_ne!(first.key(), other_record.key());

    let page =
        TablePage::from_limit_plus_one(vec![first, other_group, other_record], 7, 2).unwrap();
    assert_eq!(page.items.len(), 2);
    assert_eq!(page.next_offset, Some(9));
}

#[test]
fn table_service_reports_the_unimplemented_repository_boundary() {
    let service = LedgerService::new(SqliteLedgerRepository::open_in_memory().unwrap());
    let query = query(
        LedgerTableScope::Transactions,
        FilterMode::And,
        vec![],
        vec![transaction_date_sort()],
        group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
    )
    .unwrap();

    assert!(matches!(
        service.query_table(&query),
        Err(LedgerError::Storage(message)) if message.contains("not implemented")
    ));
}

fn query(
    scope: LedgerTableScope,
    mode: FilterMode,
    filters: Vec<LedgerTableFilter>,
    sorts: Vec<LedgerTableSort>,
    groups: LedgerTableGroupSettings,
) -> Result<LedgerTableQuery, LedgerError> {
    LedgerTableQuery::new(scope, 0, TABLE_PAGE_LIMIT, mode, filters, sorts, groups)
}

fn group_settings(group_by: LedgerTableGroup) -> LedgerTableGroupSettings {
    LedgerTableGroupSettings::new(group_by, GroupSort::Manual, true, vec![], vec![]).unwrap()
}

fn transaction_date_sort() -> LedgerTableSort {
    LedgerTableSort::Transactions {
        field: TransactionTableSortField::Date,
        direction: SortDirection::Desc,
    }
}

fn category_record(id: &str) -> CategoryTableRecord {
    let category = TransactionCategory::new(
        id,
        "Food",
        Some("living".to_string()),
        TransactionCategoryKind::Expense,
    )
    .unwrap();
    CategoryTableRecord {
        id: id.to_string(),
        category,
        name: "Food".to_string(),
        kind: TransactionCategoryKind::Expense,
        kind_label: "Expense".to_string(),
        parent_id: Some("living".to_string()),
        parent_label: "Living costs".to_string(),
    }
}

fn entry_view(
    id: &str,
    entry_type: EntryType,
    transfer_group_id: Option<&str>,
    account_name: &str,
) -> EntryView {
    EntryView {
        entry: LedgerEntry::rehydrate(LedgerEntryRehydration {
            id: id.to_string(),
            date: "2026-08-21".to_string(),
            written_at: datetime!(2026-08-21 00:00 UTC),
            content: "Move cash".to_string(),
            transaction_category_id: None,
            account_id: account_name.to_lowercase(),
            entry_type,
            amount: Money::from_minor_units(1_000),
            currency_id: "krw".to_string(),
            transfer_group_id: transfer_group_id.map(str::to_string),
            source: "test".to_string(),
            notes: None,
            created_at: datetime!(2026-08-21 00:00 UTC),
            updated_at: datetime!(2026-08-21 00:00 UTC),
            deleted_at: None,
        })
        .unwrap(),
        account_name: Some(account_name.to_string()),
        category_name: None,
        currency_code: Some("KRW".to_string()),
    }
}
