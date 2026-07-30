use health_engine::application::commands::{CreateDietEntry, CreateHealthEvent};
use health_engine::application::error::HealthError;
use health_engine::application::service::HealthService;
use health_engine::domain::{
    BowelAttributes, HealthEventDetails, MealType, MedicationAttributes, MedicationUnit,
    SymptomAttributes, WeightAttributes,
};
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use time::{Duration, macros::datetime};

#[test]
fn trends_are_bounded_deterministic_and_exclude_archived_records() {
    let directory = tempfile::tempdir().unwrap();
    let mut service = HealthService::new(
        SqliteHealthRepository::open(directory.path().join("health.sqlite")).unwrap(),
        LocalMediaStore::new(directory.path().join("media")).unwrap(),
    );
    let start = datetime!(2026-07-01 00:00:00 UTC);
    let empty = service.trends_at(1, start - Duration::days(1)).unwrap();
    assert!(empty.top_diet_tags.is_empty());
    assert!(empty.numeric_series.is_empty());
    create_diet(&mut service, start, vec!["coffee", "grain"]);
    create_diet(
        &mut service,
        start + Duration::days(1),
        vec!["coffee", "tea"],
    );
    create_event(
        &mut service,
        start + Duration::hours(1),
        HealthEventDetails::Bowel(BowelAttributes::new(4, false).unwrap()),
    );
    create_event(
        &mut service,
        start + Duration::hours(2),
        HealthEventDetails::Bowel(BowelAttributes::new(6, false).unwrap()),
    );
    create_event(
        &mut service,
        start + Duration::hours(3),
        HealthEventDetails::Medication(
            MedicationAttributes::new("Vitamin D", 1.0, MedicationUnit::Tablet).unwrap(),
        ),
    );
    create_event(
        &mut service,
        start + Duration::hours(4),
        HealthEventDetails::Weight(WeightAttributes::body_weight("Weight", 68.0, "kg").unwrap()),
    );
    let archived = create_event(
        &mut service,
        start + Duration::hours(5),
        HealthEventDetails::Symptom(
            SymptomAttributes::new("archived", "Archived", 4, None).unwrap(),
        ),
    );
    service.archive_event(archived.id().as_str()).unwrap();

    assert!(matches!(
        service.trends_at(0, start),
        Err(HealthError::Validation {
            field: "trends.days",
            ..
        })
    ));
    let trends = service.trends_at(30, start + Duration::days(2)).unwrap();
    assert_eq!(trends.top_diet_tags[0].name, "coffee");
    assert_eq!(trends.top_diet_tags[0].count, 2);
    assert_eq!(trends.top_diet_tags[1].name, "grain");
    assert_eq!(trends.top_diet_tags[2].name, "tea");
    assert_eq!(trends.bowel_average_by_day[0].average, 5.0);
    assert_eq!(trends.bowel_average_by_day[0].count, 2);
    assert_eq!(trends.medication_frequencies[0].name, "Vitamin D");
    assert!(trends.symptom_frequencies.is_empty());
    assert_eq!(trends.numeric_series.len(), 1);
    assert!(
        trends
            .reaction_disclaimer
            .contains("does not establish causation")
    );
}

#[test]
fn possible_reactions_use_open_start_and_closed_24_hour_boundary() {
    let directory = tempfile::tempdir().unwrap();
    let mut service = HealthService::new(
        SqliteHealthRepository::open(directory.path().join("health.sqlite")).unwrap(),
        LocalMediaStore::new(directory.path().join("media")).unwrap(),
    );
    let diet_at = datetime!(2026-07-10 12:00:00 UTC);
    create_diet(&mut service, diet_at, vec!["coffee"]);
    for occurred_at in [
        diet_at,
        diet_at + Duration::hours(24) - Duration::nanoseconds(1),
        diet_at + Duration::hours(24),
        diet_at + Duration::hours(24) + Duration::nanoseconds(1),
    ] {
        create_event(
            &mut service,
            occurred_at,
            HealthEventDetails::Symptom(
                SymptomAttributes::new("headache", "Headache", 3, None).unwrap(),
            ),
        );
    }
    let trends = service.trends_at(30, diet_at + Duration::days(2)).unwrap();
    assert_eq!(trends.possible_tag_reactions.len(), 1);
    assert_eq!(trends.possible_tag_reactions[0].tag, "coffee");
    assert_eq!(
        trends.possible_tag_reactions[0].symptom_events_within_24h,
        2
    );
}

fn create_diet(
    service: &mut HealthService<SqliteHealthRepository, LocalMediaStore>,
    occurred_at: time::OffsetDateTime,
    tags: Vec<&str>,
) {
    service
        .create_diet(CreateDietEntry {
            occurred_at,
            meal_type: MealType::Lunch,
            food_name: "Meal".to_string(),
            note: None,
            tags: tags.into_iter().map(str::to_string).collect(),
            media: None,
            actor: "test".to_string(),
        })
        .unwrap();
}

fn create_event(
    service: &mut HealthService<SqliteHealthRepository, LocalMediaStore>,
    occurred_at: time::OffsetDateTime,
    details: HealthEventDetails,
) -> health_engine::domain::HealthEvent {
    service
        .create_event(CreateHealthEvent {
            occurred_at,
            details,
            note: None,
            actor: "test".to_string(),
        })
        .unwrap()
}
