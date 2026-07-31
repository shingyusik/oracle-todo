use std::collections::BTreeSet;

use health_engine::application::commands::{CreateDietEntry, CreateHealthEvent};
use health_engine::application::ports::Page;
use health_engine::application::queries::{HealthQuery, TimelineItem};
use health_engine::application::service::HealthService;
use health_engine::domain::{
    BowelAttributes, HealthCategory, HealthEventDetails, MealType, SymptomAttributes,
};
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use time::macros::datetime;

#[test]
fn timeline_has_stable_equal_time_pages_filters_and_archived_visibility() {
    let directory = tempfile::tempdir().unwrap();
    let mut service = HealthService::new(
        SqliteHealthRepository::open(directory.path().join("health.sqlite")).unwrap(),
        LocalMediaStore::new(directory.path().join("media")).unwrap(),
    );
    let at = datetime!(2026-07-30 12:00:00 UTC);
    let diet = service
        .create_diet(CreateDietEntry {
            occurred_at: at,
            meal_type: MealType::Lunch,
            food_name: "Rice".to_string(),
            note: None,
            tags: vec![],
            media: None,
            actor: "test".to_string(),
        })
        .unwrap();
    let bowel = service
        .create_event(CreateHealthEvent {
            occurred_at: at,
            details: HealthEventDetails::Bowel(BowelAttributes::new(4, false).unwrap()),
            note: None,
            actor: "test".to_string(),
        })
        .unwrap();
    let symptom = service
        .create_event(CreateHealthEvent {
            occurred_at: at,
            details: HealthEventDetails::Symptom(
                SymptomAttributes::new("headache", "Headache", 3, None).unwrap(),
            ),
            note: None,
            actor: "test".to_string(),
        })
        .unwrap();

    let first = service
        .timeline(HealthQuery::new(Page::new(0, 2).unwrap()))
        .unwrap();
    let second = service
        .timeline(HealthQuery::new(Page::new(2, 2).unwrap()))
        .unwrap();
    let ids = first
        .iter()
        .chain(&second)
        .map(TimelineItem::id)
        .collect::<Vec<_>>();
    assert_eq!(ids.len(), 3);
    assert_eq!(ids.iter().copied().collect::<BTreeSet<_>>().len(), 3);
    assert_eq!(ids[0], diet.id().as_str());
    let mut event_ids = [bowel.id().as_str(), symptom.id().as_str()];
    event_ids.sort();
    assert_eq!(&ids[1..], event_ids);

    service.archive_event(bowel.id().as_str()).unwrap();
    let active = service.timeline(HealthQuery::default()).unwrap();
    assert!(!active.iter().any(|item| item.id() == bowel.id().as_str()));
    let all = service
        .timeline(HealthQuery::default().include_archived(true))
        .unwrap();
    assert!(all.iter().any(|item| item.id() == bowel.id().as_str()));
    let symptoms = service
        .timeline(HealthQuery::default().with_category(HealthCategory::Symptom))
        .unwrap();
    assert_eq!(symptoms.len(), 1);
    assert_eq!(symptoms[0].id(), symptom.id().as_str());
}
