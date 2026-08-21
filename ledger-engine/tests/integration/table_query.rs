use ledger_engine::application::error::LedgerError;
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::table::{
    AccountTableFilterField, AccountTableGroup, AccountTableSortField, CategoryTableFilterField,
    CategoryTableGroup, CategoryTableSortField, FilterMode, LedgerFilterOperator,
    LedgerTableFilter, LedgerTableFilterValue, LedgerTableGroup, LedgerTableQuery,
    LedgerTableRecord, LedgerTableRow, LedgerTableScope, LedgerTableSort, SortDirection,
    TABLE_PAGE_LIMIT, TablePage, TransactionTableFilterField, TransactionTableGroup,
    TransactionTableSortField,
};
use ledger_engine::domain::{TransactionCategory, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;

#[test]
fn table_queries_accept_each_scope_and_both_filter_modes() {
    let transactions = LedgerTableQuery::new(
        LedgerTableScope::Transactions,
        0,
        TABLE_PAGE_LIMIT,
        FilterMode::And,
        vec![LedgerTableFilter::Transactions {
            field: TransactionTableFilterField::Content,
            operator: LedgerFilterOperator::Contains,
            value: LedgerTableFilterValue::Text("lunch".to_string()),
        }],
        vec![LedgerTableSort::Transactions {
            field: TransactionTableSortField::Date,
            direction: SortDirection::Desc,
        }],
        LedgerTableGroup::Transactions(TransactionTableGroup::Month),
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
        LedgerTableGroup::Accounts(AccountTableGroup::Currency),
    )
    .unwrap();
    assert_eq!(accounts.offset(), 4);
    assert_eq!(accounts.limit(), 1);
    assert_eq!(accounts.filter_mode(), FilterMode::Or);

    let categories = LedgerTableQuery::new(
        LedgerTableScope::Categories,
        0,
        TABLE_PAGE_LIMIT,
        FilterMode::And,
        vec![LedgerTableFilter::Categories {
            field: CategoryTableFilterField::Parent,
            operator: LedgerFilterOperator::Is,
            value: LedgerTableFilterValue::Text("food".to_string()),
        }],
        vec![LedgerTableSort::Categories {
            field: CategoryTableSortField::Kind,
            direction: SortDirection::Asc,
        }],
        LedgerTableGroup::Categories(CategoryTableGroup::Parent),
    )
    .unwrap();
    assert_eq!(categories.scope(), LedgerTableScope::Categories);
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
                LedgerTableGroup::Transactions(TransactionTableGroup::None),
            ),
            Err(LedgerError::Validation { field: "page", .. })
        ));
    }

    assert!(matches!(
        LedgerTableQuery::new(
            LedgerTableScope::Transactions,
            0,
            1,
            FilterMode::And,
            vec![],
            vec![],
            LedgerTableGroup::Transactions(TransactionTableGroup::None),
        ),
        Err(LedgerError::Validation { field: "sorts", .. })
    ));

    assert!(matches!(
        LedgerTableQuery::new(
            LedgerTableScope::Transactions,
            0,
            1,
            FilterMode::And,
            vec![LedgerTableFilter::Accounts {
                field: AccountTableFilterField::Name,
                operator: LedgerFilterOperator::Contains,
                value: LedgerTableFilterValue::Text("cash".to_string()),
            }],
            vec![transaction_date_sort()],
            LedgerTableGroup::Transactions(TransactionTableGroup::None),
        ),
        Err(LedgerError::Validation {
            field: "filters",
            ..
        })
    ));

    assert!(matches!(
        LedgerTableQuery::new(
            LedgerTableScope::Transactions,
            0,
            1,
            FilterMode::And,
            vec![],
            vec![LedgerTableSort::Categories {
                field: CategoryTableSortField::Name,
                direction: SortDirection::Asc,
            }],
            LedgerTableGroup::Transactions(TransactionTableGroup::None),
        ),
        Err(LedgerError::Validation { field: "sorts", .. })
    ));

    assert!(matches!(
        LedgerTableQuery::new(
            LedgerTableScope::Transactions,
            0,
            1,
            FilterMode::And,
            vec![],
            vec![transaction_date_sort()],
            LedgerTableGroup::Categories(CategoryTableGroup::None),
        ),
        Err(LedgerError::Validation {
            field: "group_by",
            ..
        })
    ));
}

#[test]
fn limit_plus_one_pages_preserve_occurrence_keys_and_advance_by_limit() {
    let category =
        TransactionCategory::new("category-1", "Food", None, TransactionCategoryKind::Expense)
            .unwrap();
    let rows = vec![
        LedgerTableRow {
            key: "2026-08:category-1".to_string(),
            group_key: Some("2026-08".to_string()),
            group_label: Some("August 2026".to_string()),
            record: LedgerTableRecord::Categories(category.clone()),
        },
        LedgerTableRow {
            key: "2026-09:category-1".to_string(),
            group_key: Some("2026-09".to_string()),
            group_label: Some("September 2026".to_string()),
            record: LedgerTableRecord::Categories(category.clone()),
        },
        LedgerTableRow {
            key: "2026-10:category-1".to_string(),
            group_key: Some("2026-10".to_string()),
            group_label: Some("October 2026".to_string()),
            record: LedgerTableRecord::Categories(category),
        },
    ];

    let page = TablePage::from_limit_plus_one(rows, 7, 2).unwrap();
    assert_eq!(page.items.len(), 2);
    assert_eq!(page.items[0].key, "2026-08:category-1");
    assert_eq!(page.items[1].key, "2026-09:category-1");
    assert_eq!(page.next_offset, Some(9));

    let final_page = TablePage::from_limit_plus_one(page.items, 7, 2).unwrap();
    assert_eq!(final_page.next_offset, None);
}

#[test]
fn table_service_reports_the_unimplemented_repository_boundary() {
    let service = LedgerService::new(SqliteLedgerRepository::open_in_memory().unwrap());
    let query = LedgerTableQuery::new(
        LedgerTableScope::Transactions,
        0,
        TABLE_PAGE_LIMIT,
        FilterMode::And,
        vec![],
        vec![transaction_date_sort()],
        LedgerTableGroup::Transactions(TransactionTableGroup::None),
    )
    .unwrap();

    assert!(matches!(
        service.query_table(&query),
        Err(LedgerError::Storage(message)) if message.contains("not implemented")
    ));
}

fn transaction_date_sort() -> LedgerTableSort {
    LedgerTableSort::Transactions {
        field: TransactionTableSortField::Date,
        direction: SortDirection::Desc,
    }
}
