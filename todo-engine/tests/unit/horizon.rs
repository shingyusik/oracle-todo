use time::macros::date;
use todo_engine::domain::{Horizon, is_period_start, normalize_to_period_start};

#[test]
fn year_normalizes_to_january_first() {
    assert_eq!(
        normalize_to_period_start(date!(2027 - 03 - 15), Horizon::Year),
        date!(2027 - 01 - 01)
    );
}

#[test]
fn year_boundary_dec_31_and_jan_1() {
    assert_eq!(
        normalize_to_period_start(date!(2026 - 12 - 31), Horizon::Year),
        date!(2026 - 01 - 01)
    );
    assert_eq!(
        normalize_to_period_start(date!(2027 - 01 - 01), Horizon::Year),
        date!(2027 - 01 - 01)
    );
}

#[test]
fn month_normalizes_to_first() {
    assert_eq!(
        normalize_to_period_start(date!(2027 - 03 - 15), Horizon::Month),
        date!(2027 - 03 - 01)
    );
}

#[test]
fn month_boundary_last_day_and_first_day() {
    assert_eq!(
        normalize_to_period_start(date!(2026 - 01 - 31), Horizon::Month),
        date!(2026 - 01 - 01)
    );
    assert_eq!(
        normalize_to_period_start(date!(2026 - 12 - 01), Horizon::Month),
        date!(2026 - 12 - 01)
    );
}

#[test]
fn week_snaps_to_iso_monday() {
    // 2026-06-24 is a Wednesday; its ISO Monday is 2026-06-22.
    assert_eq!(
        normalize_to_period_start(date!(2026 - 06 - 24), Horizon::Week),
        date!(2026 - 06 - 22)
    );
}

#[test]
fn week_iso_monday_may_land_in_prior_year() {
    // 2026-01-01 is a Thursday; its ISO Monday is 2025-12-29 (prior year).
    // The engine does NOT clamp to Jan 1 (D-06).
    assert_eq!(
        normalize_to_period_start(date!(2026 - 01 - 01), Horizon::Week),
        date!(2025 - 12 - 29)
    );
}

#[test]
fn week_w53_region_snaps_to_monday() {
    // 2026-12-31 is a Thursday; its ISO Monday is 2026-12-28.
    assert_eq!(
        normalize_to_period_start(date!(2026 - 12 - 31), Horizon::Week),
        date!(2026 - 12 - 28)
    );
}

#[test]
fn week_jan_1_that_is_a_monday_stays_put() {
    // 2024-01-01 is itself a Monday.
    assert_eq!(
        normalize_to_period_start(date!(2024 - 01 - 01), Horizon::Week),
        date!(2024 - 01 - 01)
    );
}

#[test]
fn normalize_is_idempotent() {
    for horizon in [Horizon::Year, Horizon::Month, Horizon::Week] {
        let once = normalize_to_period_start(date!(2026 - 06 - 24), horizon);
        let twice = normalize_to_period_start(once, horizon);
        assert_eq!(once, twice, "horizon {horizon:?} not idempotent");
    }
}

#[test]
fn is_period_start_strict_reject() {
    // The 15th is not the 1st -> not canonical for Month (D-04 strict).
    assert!(!is_period_start(date!(2026 - 03 - 15), Horizon::Month));
    // 2025-12-29 is an ISO Monday -> canonical for Week.
    assert!(is_period_start(date!(2025 - 12 - 29), Horizon::Week));
}

#[test]
fn is_period_start_year_and_month_canonical() {
    assert!(is_period_start(date!(2027 - 01 - 01), Horizon::Year));
    assert!(is_period_start(date!(2026 - 12 - 01), Horizon::Month));
    assert!(!is_period_start(date!(2027 - 03 - 15), Horizon::Year));
}

#[test]
fn is_coarser_than_strict_ordering() {
    // All three strict-true pairs.
    assert!(Horizon::Year.is_coarser_than(Horizon::Month));
    assert!(Horizon::Month.is_coarser_than(Horizon::Week));
    assert!(Horizon::Year.is_coarser_than(Horizon::Week));

    // Reversed pairs are false.
    assert!(!Horizon::Week.is_coarser_than(Horizon::Year));
    assert!(!Horizon::Week.is_coarser_than(Horizon::Month));
    assert!(!Horizon::Month.is_coarser_than(Horizon::Year));

    // Reflexive pairs are false (strict, no equality — D-02).
    assert!(!Horizon::Year.is_coarser_than(Horizon::Year));
    assert!(!Horizon::Month.is_coarser_than(Horizon::Month));
    assert!(!Horizon::Week.is_coarser_than(Horizon::Week));
}

#[test]
fn from_str_round_trips_and_rejects_unknown() {
    assert_eq!("year".parse::<Horizon>().unwrap(), Horizon::Year);
    assert_eq!("month".parse::<Horizon>().unwrap(), Horizon::Month);
    assert_eq!("week".parse::<Horizon>().unwrap(), Horizon::Week);
    assert!("folder".parse::<Horizon>().is_err());

    for horizon in [Horizon::Year, Horizon::Month, Horizon::Week] {
        assert_eq!(horizon.as_str().parse::<Horizon>().unwrap(), horizon);
    }
}
