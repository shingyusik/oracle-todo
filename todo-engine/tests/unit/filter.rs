use oracle_todo::application::ports::{ListFilter, apply_list_filter};
use oracle_todo::domain::{Actor, ItemStatus, ItemType, TodoItem};
use time::OffsetDateTime;
use time::macros::datetime;

const NOW: OffsetDateTime = datetime!(2026 - 05 - 31 12:00 UTC);

fn item(id: &str, item_type: ItemType, status: ItemStatus) -> TodoItem {
    let mut i = TodoItem::new(id, item_type, id, Actor::User, NOW);
    i.status = status;
    i
}

#[test]
fn archived_hidden_by_default_but_shown_with_status_filter() {
    let items = vec![
        item("a", ItemType::Task, ItemStatus::Active),
        item("b", ItemType::Task, ItemStatus::Archived),
    ];

    let visible = apply_list_filter(items.clone(), ListFilter::default());
    assert_eq!(
        visible.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
        ["a"]
    );

    let archived = apply_list_filter(
        items,
        ListFilter {
            status: Some(ItemStatus::Archived),
            ..ListFilter::default()
        },
    );
    assert_eq!(
        archived.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
        ["b"]
    );
}

#[test]
fn type_and_query_filters_select_expected_rows() {
    let mut p = item("p", ItemType::Project, ItemStatus::Active);
    p.title = "annual report".into();
    let items = vec![item("t", ItemType::Task, ItemStatus::Active), p];

    let projects = apply_list_filter(
        items.clone(),
        ListFilter {
            item_type: Some(ItemType::Project),
            ..ListFilter::default()
        },
    );
    assert_eq!(
        projects.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
        ["p"]
    );

    let matched = apply_list_filter(
        items,
        ListFilter {
            query: Some("report".into()),
            ..ListFilter::default()
        },
    );
    assert_eq!(
        matched.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
        ["p"]
    );
}
