use oracle_todo::infrastructure::system::local_date_string_at;
use time::macros::{datetime, offset};

#[test]
fn local_date_rolls_forward_with_positive_offset() {
    let got = local_date_string_at(datetime!(2026 - 05 - 31 15:30 UTC), offset!(+9));
    assert_eq!(got, "2026-06-01");
}

#[test]
fn local_date_equals_utc_date_at_utc_offset() {
    let got = local_date_string_at(datetime!(2026 - 05 - 31 15:30 UTC), offset!(UTC));
    assert_eq!(got, "2026-05-31");
}
