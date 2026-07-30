use ledger_engine::domain::{Money, MoneyError};

#[test]
fn parses_krw_and_decimal_currency_without_floats() {
    assert_eq!(Money::parse("12000", 0).unwrap().minor_units(), 12_000);
    assert_eq!(Money::parse("12.34", 2).unwrap().minor_units(), 1_234);
    assert_eq!(Money::parse("-12.34", 2).unwrap().minor_units(), -1_234);
}

#[test]
fn rejects_fractional_digits_beyond_currency_precision() {
    assert_eq!(
        Money::parse("12.345", 2),
        Err(MoneyError::ExcessFractionalDigits {
            supported: 2,
            actual: 3,
        })
    );
}

#[test]
fn rejects_malformed_and_blank_decimal_input() {
    for value in ["", " ", ".50", "12.", "1,000", "1e3", "--1"] {
        assert_eq!(
            Money::parse(value, 2),
            Err(MoneyError::InvalidDecimal),
            "{value:?} must be rejected"
        );
    }
}

#[test]
fn rejects_unsupported_precision_and_minor_unit_overflow() {
    assert_eq!(
        Money::parse("1", 19),
        Err(MoneyError::UnsupportedPrecision(19))
    );
    assert_eq!(
        Money::parse("9223372036854775808", 0),
        Err(MoneyError::Overflow)
    );
    assert_eq!(
        Money::parse("92233720368547758.08", 2),
        Err(MoneyError::Overflow)
    );
}
