use time::Weekday;
use time::macros::date;
use todo_engine::domain::{RecurrenceError, occurrences};

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
fn rrule_daily_interval_expands_from_window_start() {
    let got = occurrences(
        "RRULE:FREQ=DAILY;INTERVAL=2",
        date!(2026 - 01 - 01),
        date!(2026 - 01 - 07),
    )
    .unwrap();
    assert_eq!(
        got,
        vec![
            date!(2026 - 01 - 01),
            date!(2026 - 01 - 03),
            date!(2026 - 01 - 05),
            date!(2026 - 01 - 07),
        ]
    );
}

#[test]
fn rrule_weekly_byday_matches_requested_weekdays() {
    let got = occurrences(
        "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
        date!(2026 - 06 - 01),
        date!(2026 - 06 - 07),
    )
    .unwrap();
    assert_eq!(
        got,
        vec![
            date!(2026 - 06 - 01),
            date!(2026 - 06 - 03),
            date!(2026 - 06 - 05),
        ]
    );
}

#[test]
fn prefixless_rrule_like_rule_is_rejected() {
    assert!(
        occurrences(
            "FREQ=WEEKLY;BYDAY=MO",
            date!(2026 - 06 - 01),
            date!(2026 - 06 - 30),
        )
        .is_err()
    );
}

#[test]
fn rrule_monthly_positive_monthday_skips_invalid_months() {
    let got = occurrences(
        "RRULE:FREQ=MONTHLY;BYMONTHDAY=31",
        date!(2026 - 01 - 01),
        date!(2026 - 03 - 31),
    )
    .unwrap();
    assert_eq!(got, vec![date!(2026 - 01 - 31), date!(2026 - 03 - 31)]);
}

#[test]
fn rrule_yearly_positive_monthday_skips_invalid_dates() {
    let got = occurrences(
        "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31",
        date!(2026 - 06 - 01),
        date!(2028 - 12 - 31),
    )
    .unwrap();
    assert!(got.is_empty());
}

#[test]
fn rrule_monthly_last_day_uses_month_end() {
    let got = occurrences(
        "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1",
        date!(2026 - 01 - 01),
        date!(2026 - 02 - 28),
    )
    .unwrap();
    assert_eq!(got, vec![date!(2026 - 01 - 31), date!(2026 - 02 - 28)]);
}

#[test]
fn rrule_yearly_interval_uses_month_and_monthday() {
    let got = occurrences(
        "RRULE:FREQ=YEARLY;INTERVAL=2;BYMONTH=3;BYMONTHDAY=15",
        date!(2026 - 01 - 01),
        date!(2030 - 12 - 31),
    )
    .unwrap();
    assert_eq!(
        got,
        vec![
            date!(2026 - 03 - 15),
            date!(2028 - 03 - 15),
            date!(2030 - 03 - 15),
        ]
    );
}

#[test]
fn unsupported_rrule_field_is_rejected() {
    assert!(
        occurrences(
            "RRULE:FREQ=WEEKLY;COUNT=3",
            date!(2026 - 01 - 01),
            date!(2026 - 01 - 31),
        )
        .is_err()
    );
}

#[test]
fn unanchored_monthly_honors_interval() {
    // An unanchored `every N months` rule emits the 1st of every Nth month in the
    // window, anchored to the start month. (Anchored monthly and yearly rules also
    // honor the interval.)
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
            date!(2026 - 03 - 01),
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
