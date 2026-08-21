use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
};
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
use ledger_engine::application::transfers::{TransferCommand, TransferOperationKey};
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
fn relative_date_filter_rejects_an_oversized_leading_zero_amount() {
    let result = query(
        LedgerTableScope::Transactions,
        FilterMode::And,
        vec![LedgerTableFilter::Transactions {
            field: TransactionTableFilterField::Date,
            operator: LedgerFilterOperator::IsRelativeToToday,
            value: LedgerTableFilterValue::Relative {
                amount: "0".repeat(513),
                unit: ledger_engine::application::table::RelativeDateUnit::Day,
            },
        }],
        vec![transaction_date_sort()],
        group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
    );

    assert!(matches!(
        result,
        Err(LedgerError::Validation {
            field: "filters",
            ..
        })
    ));
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
fn sqlite_table_query_pages_the_full_filtered_and_sorted_transaction_set() {
    let mut service = table_service();
    for index in 0..51 {
        service
            .create_entry(CreateEntry {
                date: if index == 50 {
                    "2026-07-01"
                } else {
                    "2026-08-21"
                }
                .to_string(),
                written_at: datetime!(2026-08-21 00:00 UTC),
                content: format!(
                    "{} {index:02}",
                    if index % 2 == 0 { "keep" } else { "other" }
                ),
                category: Some(if index % 2 == 0 { "Food" } else { "Salary" }.to_string()),
                account: if index % 3 == 0 { "Bank" } else { "Wallet" }.to_string(),
                entry_type: if index % 2 == 0 {
                    EntryType::Expense
                } else {
                    EntryType::Income
                },
                amount: Money::from_minor_units(i64::from(index + 1)),
                currency: "KRW".to_string(),
                transfer_group: None,
                source: "test".to_string(),
                notes: None,
                actor: "test".to_string(),
            })
            .unwrap();
    }
    let query = query(
        LedgerTableScope::Transactions,
        FilterMode::And,
        vec![
            LedgerTableFilter::Transactions {
                field: TransactionTableFilterField::Content,
                operator: LedgerFilterOperator::Contains,
                value: LedgerTableFilterValue::Text("keep".to_string()),
            },
            LedgerTableFilter::Transactions {
                field: TransactionTableFilterField::Amount,
                operator: LedgerFilterOperator::GreaterThan,
                value: LedgerTableFilterValue::Text("20".to_string()),
            },
        ],
        vec![
            LedgerTableSort::Transactions {
                field: TransactionTableSortField::Amount,
                direction: SortDirection::Desc,
            },
            LedgerTableSort::Transactions {
                field: TransactionTableSortField::Content,
                direction: SortDirection::Asc,
            },
        ],
        group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::Month)),
    )
    .unwrap();

    let page = service.query_table(&query).unwrap();
    assert_eq!(page.items.len(), 16);
    assert_eq!(page.next_offset, None);
    assert_eq!(page.items[0].group_key(), Some("2026-07"));
    let amounts = page
        .items
        .iter()
        .map(|row| match row.record() {
            LedgerTableRecord::Transactions(record) => record.amount_minor,
            _ => unreachable!(),
        })
        .collect::<Vec<_>>();
    assert!(amounts.windows(2).all(|pair| pair[0] >= pair[1]));
}

#[test]
fn sqlite_table_query_uses_displayed_major_units_for_money_filters_and_sorts() {
    let mut service = table_service();
    service
        .create_currency(CreateCurrency {
            code: "USD".into(),
            name: "Dollar".into(),
            symbol: "$".into(),
            decimal_places: 2,
            actor: "test".into(),
        })
        .unwrap();
    service
        .create_account(CreateAccount {
            name: "Dollar".into(),
            category: "Cash".into(),
            currency: "USD".into(),
            opening_balance: Money::from_minor_units(0),
            actor: "test".into(),
        })
        .unwrap();
    for (content, account, currency, amount) in [
        ("usd-25", "Dollar", "USD", 2_500),
        ("krw-100", "Wallet", "KRW", 100),
        ("krw-max", "Bank", "KRW", i64::MAX),
    ] {
        service
            .create_entry(CreateEntry {
                date: "2026-08-21".into(),
                written_at: datetime!(2026-08-21 00:00 UTC),
                content: content.into(),
                category: Some("Food".into()),
                account: account.into(),
                entry_type: EntryType::Expense,
                amount: Money::from_minor_units(amount),
                currency: currency.into(),
                transfer_group: None,
                source: "test".into(),
                notes: None,
                actor: "test".into(),
            })
            .unwrap();
    }
    let sorted = service
        .query_table(
            &query(
                LedgerTableScope::Transactions,
                FilterMode::And,
                vec![],
                vec![LedgerTableSort::Transactions {
                    field: TransactionTableSortField::Amount,
                    direction: SortDirection::Asc,
                }],
                group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
            )
            .unwrap(),
        )
        .unwrap();
    let contents = sorted
        .items
        .iter()
        .map(|row| match row.record() {
            LedgerTableRecord::Transactions(record) => record.content.as_str(),
            _ => unreachable!(),
        })
        .collect::<Vec<_>>();
    assert_eq!(contents, ["usd-25", "krw-100", "krw-max"]);

    let equal = service
        .query_table(
            &query(
                LedgerTableScope::Transactions,
                FilterMode::And,
                vec![LedgerTableFilter::Transactions {
                    field: TransactionTableFilterField::Amount,
                    operator: LedgerFilterOperator::Is,
                    value: LedgerTableFilterValue::Text("25".into()),
                }],
                vec![transaction_date_sort()],
                group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(equal.items.len(), 1);
    assert!(
        matches!(equal.items[0].record(), LedgerTableRecord::Transactions(record) if record.content == "usd-25")
    );

    let over_twenty = service
        .query_table(
            &query(
                LedgerTableScope::Transactions,
                FilterMode::And,
                vec![LedgerTableFilter::Transactions {
                    field: TransactionTableFilterField::Amount,
                    operator: LedgerFilterOperator::GreaterThan,
                    value: LedgerTableFilterValue::Text("20".into()),
                }],
                vec![transaction_date_sort()],
                group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(over_twenty.items.len(), 3);

    let accounts = service
        .query_table(
            &query(
                LedgerTableScope::Accounts,
                FilterMode::And,
                vec![],
                vec![LedgerTableSort::Accounts {
                    field: AccountTableSortField::CurrentBalance,
                    direction: SortDirection::Asc,
                }],
                group_settings(LedgerTableGroup::Accounts(AccountTableGroup::None)),
            )
            .unwrap(),
        )
        .unwrap();
    let account_names = accounts
        .items
        .iter()
        .map(|row| match row.record() {
            LedgerTableRecord::Accounts(record) => record.name.as_str(),
            _ => unreachable!(),
        })
        .collect::<Vec<_>>();
    assert_eq!(account_names, ["Bank", "Wallet", "Dollar"]);
}

#[test]
fn sqlite_table_query_probes_exact_pages_and_uses_id_as_the_final_tie_breaker() {
    let mut service = table_service();
    for index in 0..51 {
        service
            .create_entry(CreateEntry {
                date: "2026-08-21".to_string(),
                written_at: datetime!(2026-08-21 00:00 UTC),
                content: "same".to_string(),
                category: Some("Food".to_string()),
                account: "Wallet".to_string(),
                entry_type: EntryType::Expense,
                amount: Money::from_minor_units(100),
                currency: "KRW".to_string(),
                transfer_group: None,
                source: "test".to_string(),
                notes: None,
                actor: format!("test-{index}"),
            })
            .unwrap();
    }
    let first = service
        .query_table(
            &query(
                LedgerTableScope::Transactions,
                FilterMode::Or,
                vec![LedgerTableFilter::Transactions {
                    field: TransactionTableFilterField::Content,
                    operator: LedgerFilterOperator::Is,
                    value: LedgerTableFilterValue::Text("same".to_string()),
                }],
                vec![LedgerTableSort::Transactions {
                    field: TransactionTableSortField::Content,
                    direction: SortDirection::Asc,
                }],
                group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(first.items.len(), 50);
    assert_eq!(first.next_offset, Some(50));
    let mut second_query = query(
        LedgerTableScope::Transactions,
        FilterMode::Or,
        vec![LedgerTableFilter::Transactions {
            field: TransactionTableFilterField::Content,
            operator: LedgerFilterOperator::Is,
            value: LedgerTableFilterValue::Text("same".to_string()),
        }],
        vec![LedgerTableSort::Transactions {
            field: TransactionTableSortField::Content,
            direction: SortDirection::Asc,
        }],
        group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
    )
    .unwrap();
    second_query = LedgerTableQuery::new(
        second_query.scope(),
        50,
        second_query.limit(),
        second_query.filter_mode(),
        second_query.filters().to_vec(),
        second_query.sorts().to_vec(),
        second_query.group_settings().clone(),
    )
    .unwrap();
    let second = service.query_table(&second_query).unwrap();
    assert_eq!(second.items.len(), 1);
    assert_eq!(second.next_offset, None);
    let ids = first
        .items
        .iter()
        .chain(&second.items)
        .map(|row| row.record().logical_id())
        .collect::<Vec<_>>();
    assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));
}

#[test]
fn sqlite_table_query_projects_account_balances_and_parent_category_groups() {
    let mut service = table_service();
    service
        .create_entry(CreateEntry {
            date: "2026-08-21".into(),
            written_at: datetime!(2026-08-21 00:00 UTC),
            content: "expense".into(),
            category: Some("Food".into()),
            account: "Wallet".into(),
            entry_type: EntryType::Expense,
            amount: Money::from_minor_units(300),
            currency: "KRW".into(),
            transfer_group: None,
            source: "test".into(),
            notes: None,
            actor: "test".into(),
        })
        .unwrap();
    let accounts = service
        .query_table(
            &query(
                LedgerTableScope::Accounts,
                FilterMode::And,
                vec![],
                vec![LedgerTableSort::Accounts {
                    field: AccountTableSortField::CurrentBalance,
                    direction: SortDirection::Asc,
                }],
                group_settings(LedgerTableGroup::Accounts(AccountTableGroup::AccountType)),
            )
            .unwrap(),
        )
        .unwrap();
    let balances = accounts
        .items
        .iter()
        .map(|row| match row.record() {
            LedgerTableRecord::Accounts(record) => record.current_balance_minor,
            _ => unreachable!(),
        })
        .collect::<Vec<_>>();
    assert_eq!(balances, [-300, 0]);
    assert!(
        accounts
            .items
            .iter()
            .all(|row| row.group_label() == Some("Cash"))
    );

    let categories = service
        .query_table(
            &query(
                LedgerTableScope::Categories,
                FilterMode::And,
                vec![],
                vec![LedgerTableSort::Categories {
                    field: CategoryTableSortField::Name,
                    direction: SortDirection::Asc,
                }],
                group_settings(LedgerTableGroup::Categories(CategoryTableGroup::Parent)),
            )
            .unwrap(),
        )
        .unwrap();
    let food = categories.items.iter().find(|row| matches!(row.record(), LedgerTableRecord::Categories(record) if record.name == "Food")).unwrap();
    assert_eq!(food.group_label(), Some("Living"));
    assert_ne!(food.group_key(), None);
    assert!(categories.items.iter().all(|row| row.group_key().is_some()));
    let categories_with_roots = service
        .query_table(
            &query(
                LedgerTableScope::Categories,
                FilterMode::And,
                vec![],
                vec![LedgerTableSort::Categories {
                    field: CategoryTableSortField::Name,
                    direction: SortDirection::Asc,
                }],
                LedgerTableGroupSettings::new(
                    LedgerTableGroup::Categories(CategoryTableGroup::Parent),
                    GroupSort::Alphabetical,
                    false,
                    vec![],
                    vec![],
                )
                .unwrap(),
            )
            .unwrap(),
        )
        .unwrap();
    assert!(
        categories_with_roots.items.iter().any(|row| {
            row.group_key() == Some("none") && row.group_label() == Some("No parent")
        })
    );
}

#[test]
fn sqlite_table_query_keeps_a_transfer_logical_and_emits_account_occurrences() {
    let mut service = table_service();
    let result = service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::generate(),
            date: "2026-08-21".into(),
            written_at: datetime!(2026-08-21 00:00 UTC),
            content: "move".into(),
            from_account: "Wallet".into(),
            to_account: "Bank".into(),
            amount: Money::from_minor_units(500),
            currency: "KRW".into(),
            source: "test".into(),
            notes: None,
            actor: "test".into(),
        })
        .unwrap();
    let page = service
        .query_table(
            &query(
                LedgerTableScope::Transactions,
                FilterMode::And,
                vec![],
                vec![transaction_date_sort()],
                LedgerTableGroupSettings::new(
                    LedgerTableGroup::Transactions(TransactionTableGroup::Account),
                    GroupSort::Alphabetical,
                    false,
                    vec![],
                    vec![],
                )
                .unwrap(),
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(page.items.len(), 2);
    assert_ne!(page.items[0].key(), page.items[1].key());
    assert!(page.items.iter().all(|row| match row.record() {
        LedgerTableRecord::Transactions(record) =>
            record.id == result.transfer_group_id && record.transfer_entry.is_some(),
        _ => false,
    }));
    let account_ids = service
        .accounts_page(ledger_engine::application::ports::Page {
            offset: 0,
            limit: 10,
        })
        .unwrap()
        .items
        .into_iter()
        .map(|account| (account.name().to_string(), account.id().to_string()))
        .collect::<std::collections::HashMap<_, _>>();
    for account in ["Wallet", "Bank"] {
        let filtered = service
            .query_table(
                &query(
                    LedgerTableScope::Transactions,
                    FilterMode::And,
                    vec![LedgerTableFilter::Transactions {
                        field: TransactionTableFilterField::Account,
                        operator: LedgerFilterOperator::Is,
                        value: LedgerTableFilterValue::TextList(vec![account_ids[account].clone()]),
                    }],
                    vec![transaction_date_sort()],
                    LedgerTableGroupSettings::new(
                        LedgerTableGroup::Transactions(TransactionTableGroup::Account),
                        GroupSort::Alphabetical,
                        false,
                        vec![],
                        vec![],
                    )
                    .unwrap(),
                )
                .unwrap(),
            )
            .unwrap();
        assert_eq!(filtered.items.len(), 2);
        assert!(filtered.items.iter().all(|row| match row.record() {
            LedgerTableRecord::Transactions(record) => record.id == result.transfer_group_id,
            _ => false,
        }));
    }
}

#[test]
fn sqlite_table_query_keeps_multi_expression_filters_inside_their_and_rule() {
    let mut service = table_service();
    service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::generate(),
            date: "2026-08-21".into(),
            written_at: datetime!(2026-08-21 00:00 UTC),
            content: "small transfer".into(),
            from_account: "Wallet".into(),
            to_account: "Bank".into(),
            amount: Money::from_minor_units(50),
            currency: "KRW".into(),
            source: "test".into(),
            notes: None,
            actor: "test".into(),
        })
        .unwrap();
    let bank_id = service
        .accounts_page(ledger_engine::application::ports::Page {
            offset: 0,
            limit: 10,
        })
        .unwrap()
        .items
        .into_iter()
        .find(|account| account.name() == "Bank")
        .unwrap()
        .id()
        .to_string();

    let page = service
        .query_table(
            &query(
                LedgerTableScope::Transactions,
                FilterMode::And,
                vec![
                    LedgerTableFilter::Transactions {
                        field: TransactionTableFilterField::Account,
                        operator: LedgerFilterOperator::Is,
                        value: LedgerTableFilterValue::TextList(vec![bank_id]),
                    },
                    LedgerTableFilter::Transactions {
                        field: TransactionTableFilterField::Amount,
                        operator: LedgerFilterOperator::GreaterThan,
                        value: LedgerTableFilterValue::Text("100".into()),
                    },
                ],
                vec![transaction_date_sort()],
                group_settings(LedgerTableGroup::Transactions(TransactionTableGroup::None)),
            )
            .unwrap(),
        )
        .unwrap();
    assert!(page.items.is_empty());
}

#[test]
fn sqlite_table_query_uses_monday_week_buckets_and_applies_group_controls_before_page() {
    let mut service = table_service();
    for (date, content, account) in [
        ("2026-08-17", "monday", "Wallet"),
        ("2026-08-23", "sunday", "Wallet"),
        ("2026-08-24", "next monday", "Bank"),
    ] {
        service
            .create_entry(CreateEntry {
                date: date.into(),
                written_at: datetime!(2026-08-21 00:00 UTC),
                content: content.into(),
                category: Some("Food".into()),
                account: account.into(),
                entry_type: EntryType::Expense,
                amount: Money::from_minor_units(100),
                currency: "KRW".into(),
                transfer_group: None,
                source: "test".into(),
                notes: None,
                actor: "test".into(),
            })
            .unwrap();
    }
    service
        .create_entry(CreateEntry {
            date: "2026-08-25".into(),
            written_at: datetime!(2026-08-21 00:00 UTC),
            content: "uncategorized".into(),
            category: None,
            account: "Bank".into(),
            entry_type: EntryType::AdjustmentOut,
            amount: Money::from_minor_units(100),
            currency: "KRW".into(),
            transfer_group: None,
            source: "test".into(),
            notes: None,
            actor: "test".into(),
        })
        .unwrap();
    let week_page = service
        .query_table(
            &query(
                LedgerTableScope::Transactions,
                FilterMode::Or,
                vec![
                    LedgerTableFilter::Transactions {
                        field: TransactionTableFilterField::Content,
                        operator: LedgerFilterOperator::StartsWith,
                        value: LedgerTableFilterValue::Text("mon".into()),
                    },
                    LedgerTableFilter::Transactions {
                        field: TransactionTableFilterField::Content,
                        operator: LedgerFilterOperator::Contains,
                        value: LedgerTableFilterValue::Text("sunday".into()),
                    },
                ],
                vec![transaction_date_sort()],
                LedgerTableGroupSettings::new(
                    LedgerTableGroup::Transactions(TransactionTableGroup::Week),
                    GroupSort::ReverseAlphabetical,
                    true,
                    vec![],
                    vec!["2026-08-24".into()],
                )
                .unwrap(),
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(week_page.items.len(), 2);
    assert!(
        week_page
            .items
            .iter()
            .all(|row| row.group_key() == Some("2026-08-17"))
    );
    assert!(
        week_page
            .items
            .iter()
            .all(|row| row.group_label() == Some("Week of 2026-08-17"))
    );

    let reverse = service
        .query_table(
            &query(
                LedgerTableScope::Transactions,
                FilterMode::And,
                vec![],
                vec![transaction_date_sort()],
                LedgerTableGroupSettings::new(
                    LedgerTableGroup::Transactions(TransactionTableGroup::Week),
                    GroupSort::ReverseAlphabetical,
                    false,
                    vec![],
                    vec![],
                )
                .unwrap(),
            )
            .unwrap(),
        )
        .unwrap();
    let mut reverse_groups = reverse
        .items
        .iter()
        .filter_map(|row| row.group_key().map(str::to_string))
        .collect::<Vec<_>>();
    reverse_groups.dedup();
    assert_eq!(reverse_groups, ["2026-08-24", "2026-08-17"]);

    let categories_with_empty = service
        .query_table(
            &query(
                LedgerTableScope::Transactions,
                FilterMode::And,
                vec![],
                vec![transaction_date_sort()],
                LedgerTableGroupSettings::new(
                    LedgerTableGroup::Transactions(TransactionTableGroup::Category),
                    GroupSort::Alphabetical,
                    false,
                    vec![],
                    vec![],
                )
                .unwrap(),
            )
            .unwrap(),
        )
        .unwrap();
    assert!(
        categories_with_empty
            .items
            .iter()
            .any(|row| row.group_key() == Some("uncategorized")
                && row.group_label() == Some("Uncategorized"))
    );
    let categories_without_empty = service
        .query_table(
            &query(
                LedgerTableScope::Transactions,
                FilterMode::And,
                vec![],
                vec![transaction_date_sort()],
                LedgerTableGroupSettings::new(
                    LedgerTableGroup::Transactions(TransactionTableGroup::Category),
                    GroupSort::Alphabetical,
                    true,
                    vec![],
                    vec![],
                )
                .unwrap(),
            )
            .unwrap(),
        )
        .unwrap();
    assert!(
        categories_without_empty
            .items
            .iter()
            .all(|row| row.group_key() != Some("uncategorized"))
    );

    let accounts = service
        .accounts_page(ledger_engine::application::ports::Page {
            offset: 0,
            limit: 10,
        })
        .unwrap()
        .items;
    let wallet = accounts
        .iter()
        .find(|account| account.name() == "Wallet")
        .unwrap()
        .id()
        .to_string();
    let bank = accounts
        .iter()
        .find(|account| account.name() == "Bank")
        .unwrap()
        .id()
        .to_string();
    let ordered = service
        .query_table(
            &query(
                LedgerTableScope::Transactions,
                FilterMode::And,
                vec![],
                vec![transaction_date_sort()],
                LedgerTableGroupSettings::new(
                    LedgerTableGroup::Transactions(TransactionTableGroup::Account),
                    GroupSort::Manual,
                    false,
                    vec![bank.clone(), wallet.clone()],
                    vec![],
                )
                .unwrap(),
            )
            .unwrap(),
        )
        .unwrap();
    let mut group_order = ordered
        .items
        .iter()
        .filter_map(|row| row.group_key().map(str::to_string))
        .collect::<Vec<_>>();
    group_order.dedup();
    assert_eq!(group_order, [bank.clone(), wallet.clone()]);

    let manual = service
        .query_table(
            &query(
                LedgerTableScope::Transactions,
                FilterMode::And,
                vec![],
                vec![transaction_date_sort()],
                LedgerTableGroupSettings::new(
                    LedgerTableGroup::Transactions(TransactionTableGroup::Account),
                    GroupSort::Manual,
                    false,
                    vec![bank.clone(), wallet.clone()],
                    vec![wallet],
                )
                .unwrap(),
            )
            .unwrap(),
        )
        .unwrap();
    assert!(!manual.items.is_empty());
    assert!(
        manual
            .items
            .iter()
            .all(|row| row.group_key() == Some(bank.as_str()))
    );
}

fn table_service() -> LedgerService<SqliteLedgerRepository> {
    let mut service = LedgerService::new(SqliteLedgerRepository::open_in_memory().unwrap());
    service
        .create_currency(CreateCurrency {
            code: "KRW".into(),
            name: "Won".into(),
            symbol: "W".into(),
            decimal_places: 0,
            actor: "test".into(),
        })
        .unwrap();
    service
        .create_account_category(CreateAccountCategory {
            name: "Cash".into(),
            parent: None,
            liability: false,
            actor: "test".into(),
        })
        .unwrap();
    for name in ["Wallet", "Bank"] {
        service
            .create_account(CreateAccount {
                name: name.into(),
                category: "Cash".into(),
                currency: "KRW".into(),
                opening_balance: Money::from_minor_units(0),
                actor: "test".into(),
            })
            .unwrap();
    }
    service
        .create_category(CreateTransactionCategory {
            name: "Living".into(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "test".into(),
        })
        .unwrap();
    service
        .create_category(CreateTransactionCategory {
            name: "Food".into(),
            parent: Some("Living".into()),
            kind: TransactionCategoryKind::Expense,
            actor: "test".into(),
        })
        .unwrap();
    service
        .create_category(CreateTransactionCategory {
            name: "Salary".into(),
            parent: None,
            kind: TransactionCategoryKind::Income,
            actor: "test".into(),
        })
        .unwrap();
    service
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
