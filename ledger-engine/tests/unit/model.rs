use ledger_engine::domain::{
    Account, AccountCategory, Currency, EntryType, LedgerEntry, LedgerEntryDraft, Money,
    TransactionCategory, TransactionCategoryKind, ValidationError,
};

#[test]
fn entry_type_controls_balance_direction() {
    assert_eq!(EntryType::Expense.balance_sign(), -1);
    assert_eq!(EntryType::Income.balance_sign(), 1);
    assert_eq!(EntryType::TransferOut.balance_sign(), -1);
    assert_eq!(EntryType::TransferIn.balance_sign(), 1);
    assert_eq!(EntryType::AdjustmentOut.balance_sign(), -1);
    assert_eq!(EntryType::AdjustmentIn.balance_sign(), 1);
}

#[test]
fn currency_rejects_blank_names_and_unsupported_precision() {
    assert_eq!(
        Currency::new("cur-krw", "KRW", " ", "₩", 0),
        Err(ValidationError::BlankField("currency.name"))
    );
    assert_eq!(
        Currency::new("cur-x", "XXX", "Unsupported", "X", 19),
        Err(ValidationError::UnsupportedCurrencyPrecision(19))
    );
}

#[test]
fn account_and_category_models_reject_blank_names() {
    assert_eq!(
        AccountCategory::new("cat-assets", "", None, false),
        Err(ValidationError::BlankField("account_category.name"))
    );
    assert_eq!(
        Account::new(
            "acc-cash",
            "\t",
            "cat-assets",
            "cur-krw",
            Money::from_minor_units(0),
        ),
        Err(ValidationError::BlankField("account.name"))
    );
    assert_eq!(
        TransactionCategory::new("tx-food", "\n", None, TransactionCategoryKind::Expense,),
        Err(ValidationError::BlankField("transaction_category.name"))
    );
}

#[test]
fn ledger_entry_rejects_non_positive_amounts() {
    for minor_units in [-1, 0] {
        let error = LedgerEntry::new(entry_draft(
            "2026-07-30",
            Money::from_minor_units(minor_units),
        ))
        .unwrap_err();
        assert_eq!(error, ValidationError::NonPositiveEntryAmount);
    }
}

#[test]
fn ledger_entry_rejects_malformed_dates_and_blank_content() {
    assert_eq!(
        LedgerEntry::new(entry_draft("2026-02-30", Money::from_minor_units(1_000),)),
        Err(ValidationError::MalformedDate)
    );

    let mut draft = entry_draft("2026-07-30", Money::from_minor_units(1_000));
    draft.content = " ".to_string();
    assert_eq!(
        LedgerEntry::new(draft),
        Err(ValidationError::BlankField("ledger_entry.content"))
    );
}

#[test]
fn valid_master_data_and_entry_preserve_integer_values() {
    let currency = Currency::new("cur-krw", "KRW", "Korean won", "₩", 0).unwrap();
    let category = AccountCategory::new("cat-assets", "Assets", None, false).unwrap();
    let account = Account::new(
        "acc-cash",
        "Cash",
        &category.id,
        &currency.id,
        Money::from_minor_units(-5_000),
    )
    .unwrap();
    let entry =
        LedgerEntry::new(entry_draft("2026-07-30", Money::from_minor_units(12_000))).unwrap();

    assert_eq!(currency.decimal_places, 0);
    assert_eq!(account.opening_balance.minor_units(), -5_000);
    assert_eq!(entry.amount.minor_units(), 12_000);
    assert_eq!(entry.date.to_string(), "2026-07-30");
}

fn entry_draft(date: &str, amount: Money) -> LedgerEntryDraft {
    LedgerEntryDraft {
        id: "entry-1".to_string(),
        date: date.to_string(),
        content: "Lunch".to_string(),
        transaction_category_id: Some("tx-food".to_string()),
        account_id: "acc-cash".to_string(),
        entry_type: EntryType::Expense,
        amount,
        currency_id: "cur-krw".to_string(),
        transfer_group_id: None,
        source: "manual".to_string(),
        notes: None,
    }
}
