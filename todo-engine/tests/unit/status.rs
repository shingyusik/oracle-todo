use todo_engine::domain::{ItemStatus, hidden_by_default_status, terminal_status};

const ALL_STATUS_STRINGS: [&str; 9] = [
    "active",
    "waiting",
    "paused",
    "completed",
    "cancelled",
    "dropped",
    "archived",
    "someday",
    "rejected",
];

#[test]
fn terminal_status_matches_terminal_set() {
    for s in [
        ItemStatus::Completed,
        ItemStatus::Cancelled,
        ItemStatus::Dropped,
        ItemStatus::Archived,
        ItemStatus::Someday,
        ItemStatus::Rejected,
    ] {
        assert!(terminal_status(s), "{} should be terminal", s.as_str());
    }
    for s in [ItemStatus::Active, ItemStatus::Waiting, ItemStatus::Paused] {
        assert!(!terminal_status(s), "{} should not be terminal", s.as_str());
    }
}

#[test]
fn hidden_by_default_matches_hidden_set() {
    for s in [
        ItemStatus::Archived,
        ItemStatus::Dropped,
        ItemStatus::Cancelled,
    ] {
        assert!(
            hidden_by_default_status(s),
            "{} should be hidden",
            s.as_str()
        );
    }
    for s in [
        ItemStatus::Active,
        ItemStatus::Waiting,
        ItemStatus::Paused,
        ItemStatus::Completed,
        ItemStatus::Someday,
        ItemStatus::Rejected,
    ] {
        assert!(
            !hidden_by_default_status(s),
            "{} should be visible",
            s.as_str()
        );
    }
}

#[test]
fn status_round_trips_every_variant() {
    for status in ALL_STATUS_STRINGS {
        assert_eq!(status.parse::<ItemStatus>().unwrap().as_str(), status);
    }
    assert!("Active".parse::<ItemStatus>().is_err()); // case-sensitive lowercase only
    assert_eq!(
        "  active  ".parse::<ItemStatus>().unwrap(),
        ItemStatus::Active
    ); // trims
    assert!("proposed".parse::<ItemStatus>().is_err());
    assert!("approved".parse::<ItemStatus>().is_err());
}
