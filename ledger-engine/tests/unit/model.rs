use ledger_engine::domain::{
    Account, AccountCategory, Currency, EntryType, LedgerEntry, LedgerEntryRehydration, Money,
    TransactionCategory, TransactionCategoryKind, ValidationError,
};
use time::{OffsetDateTime, macros::datetime};

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
fn master_rehydration_preserves_inactive_records_for_repository_mapping() {
    let currency = Currency::rehydrate("cur-krw", "KRW", "Korean won", "₩", 0, false).unwrap();
    let account_category =
        AccountCategory::rehydrate("cat-assets", "Assets", None, false, false).unwrap();
    let account = Account::rehydrate(
        "acc-cash",
        "Cash",
        account_category.id(),
        currency.id(),
        Money::from_minor_units(-5_000),
        false,
    )
    .unwrap();
    let transaction_category = TransactionCategory::rehydrate(
        "tx-food",
        "Food",
        None,
        TransactionCategoryKind::Expense,
        false,
    )
    .unwrap();

    assert_eq!(
        (
            currency.id(),
            currency.code(),
            currency.name(),
            currency.symbol()
        ),
        ("cur-krw", "KRW", "Korean won", "₩")
    );
    assert!(!currency.is_active());
    assert_eq!(account_category.name(), "Assets");
    assert_eq!(account_category.parent_id(), None);
    assert!(!account_category.is_liability());
    assert!(!account_category.is_active());
    assert_eq!(account.name(), "Cash");
    assert_eq!(account.category_id(), "cat-assets");
    assert_eq!(account.currency_id(), "cur-krw");
    assert!(!account.is_active());
    assert_eq!(transaction_category.id(), "tx-food");
    assert_eq!(transaction_category.name(), "Food");
    assert_eq!(transaction_category.parent_id(), None);
    assert_eq!(
        transaction_category.kind(),
        TransactionCategoryKind::Expense
    );
    assert!(!transaction_category.is_active());
}

#[test]
fn ledger_entry_rehydration_rejects_non_positive_amounts() {
    for minor_units in [-1, 0] {
        let error = LedgerEntry::rehydrate(entry_record(
            "2026-07-30",
            Money::from_minor_units(minor_units),
        ))
        .unwrap_err();
        assert_eq!(error, ValidationError::NonPositiveEntryAmount);
    }
}

#[test]
fn ledger_entry_rehydration_rejects_malformed_dates_and_blank_content() {
    assert_eq!(
        LedgerEntry::rehydrate(entry_record("2026-02-30", Money::from_minor_units(1_000),)),
        Err(ValidationError::MalformedDate)
    );

    let mut record = entry_record("2026-07-30", Money::from_minor_units(1_000));
    record.content = " ".to_string();
    assert_eq!(
        LedgerEntry::rehydrate(record),
        Err(ValidationError::BlankField("ledger_entry.content"))
    );
}

#[test]
fn invalid_json_payload_cannot_bypass_entry_rehydration_validation() {
    let json = serde_json::json!({
        "id": " ",
        "date": "2026-07-30",
        "written_at": "2026-07-30T01:02:03Z",
        "content": " ",
        "transaction_category_id": null,
        "account_id": " ",
        "entry_type": "expense",
        "amount": -1,
        "currency_id": " ",
        "transfer_group_id": null,
        "source": " ",
        "notes": null,
        "created_at": "2026-07-30T01:02:04Z",
        "updated_at": "2026-07-30T01:02:05Z",
        "deleted_at": null
    });
    let payload: LedgerEntryRehydration = serde_json::from_value(json).unwrap();

    assert_eq!(
        LedgerEntry::rehydrate(payload),
        Err(ValidationError::NonPositiveEntryAmount)
    );
}

#[test]
fn lifecycle_fields_are_observable_and_archive_state_uses_deleted_at() {
    let active =
        LedgerEntry::rehydrate(entry_record("2026-07-30", Money::from_minor_units(12_000)))
            .unwrap();
    assert_eq!(active.written_at(), datetime!(2026-07-30 01:02:03 UTC));
    assert_eq!(active.created_at(), datetime!(2026-07-30 01:02:04 UTC));
    assert_eq!(active.updated_at(), datetime!(2026-07-30 01:02:05 UTC));
    assert_eq!(active.deleted_at(), None);
    assert!(!active.is_archived());

    let mut archived_record = entry_record("2026-07-30", Money::from_minor_units(12_000));
    archived_record.deleted_at = Some(datetime!(2026-07-31 04:05:06 UTC));
    let archived = LedgerEntry::rehydrate(archived_record).unwrap();
    assert_eq!(
        archived.deleted_at(),
        Some(datetime!(2026-07-31 04:05:06 UTC))
    );
    assert!(archived.is_archived());
}

#[test]
fn entry_json_uses_exact_iso_date_and_utc_rfc3339_timestamps() {
    let mut record = entry_record("2026-07-30", Money::from_minor_units(12_000));
    record.written_at = OffsetDateTime::parse(
        "2026-07-30T10:02:03+09:00",
        &time::format_description::well_known::Rfc3339,
    )
    .unwrap();
    record.deleted_at = Some(datetime!(2026-07-31 04:05:06 UTC));
    let entry = LedgerEntry::rehydrate(record).unwrap();

    let json = serde_json::to_value(&entry).unwrap();
    assert_eq!(json["date"], "2026-07-30");
    assert_eq!(json["written_at"], "2026-07-30T01:02:03Z");
    assert_eq!(json["created_at"], "2026-07-30T01:02:04Z");
    assert_eq!(json["updated_at"], "2026-07-30T01:02:05Z");
    assert_eq!(json["deleted_at"], "2026-07-31T04:05:06Z");

    let payload: LedgerEntryRehydration = serde_json::from_value(json.clone()).unwrap();
    let round_tripped = LedgerEntry::rehydrate(payload).unwrap();
    assert_eq!(serde_json::to_value(round_tripped).unwrap(), json);
}

#[test]
fn nullable_deleted_at_serializes_as_json_null() {
    let entry = LedgerEntry::rehydrate(entry_record("2026-07-30", Money::from_minor_units(12_000)))
        .unwrap();

    let json = serde_json::to_value(entry).unwrap();
    assert_eq!(json["deleted_at"], serde_json::Value::Null);
}

#[test]
fn valid_master_data_and_entry_preserve_integer_values() {
    let currency = Currency::new("cur-krw", "KRW", "Korean won", "₩", 0).unwrap();
    let category = AccountCategory::new("cat-assets", "Assets", None, false).unwrap();
    let account = Account::new(
        "acc-cash",
        "Cash",
        category.id(),
        currency.id(),
        Money::from_minor_units(-5_000),
    )
    .unwrap();
    let entry = LedgerEntry::rehydrate(entry_record("2026-07-30", Money::from_minor_units(12_000)))
        .unwrap();

    assert_eq!(currency.decimal_places(), 0);
    assert_eq!(account.opening_balance().minor_units(), -5_000);
    assert_eq!(entry.amount().minor_units(), 12_000);
    assert_eq!(entry.date().to_string(), "2026-07-30");
}

fn entry_record(date: &str, amount: Money) -> LedgerEntryRehydration {
    LedgerEntryRehydration {
        id: "entry-1".to_string(),
        date: date.to_string(),
        written_at: datetime!(2026-07-30 01:02:03 UTC),
        content: "Lunch".to_string(),
        transaction_category_id: Some("tx-food".to_string()),
        account_id: "acc-cash".to_string(),
        entry_type: EntryType::Expense,
        amount,
        currency_id: "cur-krw".to_string(),
        transfer_group_id: None,
        source: "manual".to_string(),
        notes: None,
        created_at: datetime!(2026-07-30 01:02:04 UTC),
        updated_at: datetime!(2026-07-30 01:02:05 UTC),
        deleted_at: None,
    }
}
