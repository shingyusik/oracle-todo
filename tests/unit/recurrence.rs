use oracle_todo::domain::{RecurrenceError, occurrences};
use time::Weekday;
use time::macros::date;

#[test]
fn daily_aliases_expand_each_day() {
    let want = vec![
        date!(2026 - 01 - 01),
        date!(2026 - 01 - 02),
        date!(2026 - 01 - 03),
    ];
    for rule in ["daily", "매일", "every day"] {
        let got = occurrences(rule, date!(2026 - 01 - 01), date!(2026 - 01 - 03)).unwrap();
        assert_eq!(got, want, "rule {rule}");
    }
}

#[test]
fn weekdays_rule_excludes_weekend() {
    for rule in ["weekdays", "평일", "월-금"] {
        let got = occurrences(rule, date!(2026 - 06 - 01), date!(2026 - 06 - 30)).unwrap();
        assert!(!got.is_empty(), "rule {rule}");
        assert!(
            got.iter()
                .all(|d| !matches!(d.weekday(), Weekday::Saturday | Weekday::Sunday)),
            "rule {rule} leaked a weekend"
        );
    }
}

#[test]
fn weekend_rule_is_only_weekend() {
    for rule in ["weekend", "주말", "토-일"] {
        let got = occurrences(rule, date!(2026 - 06 - 01), date!(2026 - 06 - 30)).unwrap();
        assert!(!got.is_empty(), "rule {rule}");
        assert!(
            got.iter()
                .all(|d| matches!(d.weekday(), Weekday::Saturday | Weekday::Sunday)),
            "rule {rule} leaked a weekday"
        );
    }
}

#[test]
fn explicit_weekday_set_matches_listed_days() {
    for rule in ["월수금", "mon,wed,fri", "mon wed fri"] {
        let got = occurrences(rule, date!(2026 - 06 - 01), date!(2026 - 06 - 30)).unwrap();
        assert!(!got.is_empty(), "rule {rule}");
        assert!(
            got.iter().all(|d| matches!(
                d.weekday(),
                Weekday::Monday | Weekday::Wednesday | Weekday::Friday
            )),
            "rule {rule} produced an unexpected weekday"
        );
    }
}

#[test]
fn monthly_on_the_nth_is_exact() {
    let got = occurrences(
        "every month on the 15th",
        date!(2026 - 01 - 01),
        date!(2026 - 03 - 31),
    )
    .unwrap();
    assert_eq!(
        got,
        vec![
            date!(2026 - 01 - 15),
            date!(2026 - 02 - 15),
            date!(2026 - 03 - 15)
        ]
    );
}

#[test]
fn monthly_on_the_last_clamps_to_month_length() {
    let got = occurrences(
        "every month on the last",
        date!(2026 - 01 - 01),
        date!(2026 - 02 - 28),
    )
    .unwrap();
    assert_eq!(got, vec![date!(2026 - 01 - 31), date!(2026 - 02 - 28)]);
}

#[test]
fn yearly_interval_skips_off_years() {
    let got = occurrences(
        "every 2 years",
        date!(2026 - 01 - 01),
        date!(2030 - 12 - 31),
    )
    .unwrap();
    assert_eq!(
        got,
        vec![
            date!(2026 - 01 - 01),
            date!(2028 - 01 - 01),
            date!(2030 - 01 - 01)
        ]
    );
}

#[test]
fn unanchored_monthly_emits_first_of_every_month() {
    // Current behavior: an unanchored `every N months` rule emits the 1st of EVERY
    // month in the window — the interval N is not honored on this path (also locked by
    // tests/integration/materialization.rs). Anchored monthly and yearly rules DO
    // honor the interval.
    let got = occurrences(
        "every 2 months",
        date!(2026 - 01 - 01),
        date!(2026 - 05 - 31),
    )
    .unwrap();
    assert_eq!(
        got,
        vec![
            date!(2026 - 01 - 01),
            date!(2026 - 02 - 01),
            date!(2026 - 03 - 01),
            date!(2026 - 04 - 01),
            date!(2026 - 05 - 01)
        ]
    );
}

#[test]
fn empty_window_returns_no_dates() {
    let got = occurrences("daily", date!(2026 - 01 - 03), date!(2026 - 01 - 01)).unwrap();
    assert!(got.is_empty());
}

#[test]
fn unsupported_rule_carries_original_string() {
    let err = occurrences("bogus rule", date!(2026 - 01 - 01), date!(2026 - 01 - 31)).unwrap_err();
    assert_eq!(err, RecurrenceError::unsupported("bogus rule"));
    assert_eq!(err.rule(), "bogus rule");
}

#[test]
fn interval_below_one_is_unsupported() {
    assert!(occurrences("every 0 days", date!(2026 - 01 - 01), date!(2026 - 01 - 31)).is_err());
}

#[test]
fn anchored_day_unit_is_unsupported() {
    assert!(
        occurrences(
            "every 2 days on mon",
            date!(2026 - 01 - 01),
            date!(2026 - 01 - 31)
        )
        .is_err()
    );
}
