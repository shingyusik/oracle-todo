use health_engine::application::commands::{CreateHealthEvent, UpdateHealthEvent};
use health_engine::application::error::HealthError;
use health_engine::application::ports::{EventQuery, Page};
use health_engine::application::service::HealthService;
use health_engine::domain::{
    BowelAttributes, HealthCategory, HealthEventDetails, LabAttributes, MedicationAttributes,
    MedicationUnit, SleepAttributes, SleepValue, SymptomAttributes, WeightAttributes,
};
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use time::macros::datetime;

#[test]
fn creates_reads_and_filters_every_supported_category() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let details = [
        HealthEventDetails::Bowel(BowelAttributes::new(4, false).unwrap()),
        HealthEventDetails::Medication(
            MedicationAttributes::new("Vitamin D", 1.0, MedicationUnit::Tablet).unwrap(),
        ),
        HealthEventDetails::Weight(WeightAttributes::body_weight("Weight", 68.2, "kg").unwrap()),
        HealthEventDetails::Sleep(
            SleepAttributes::sleep_duration("Sleep", SleepValue::hours(7.5).unwrap()).unwrap(),
        ),
        HealthEventDetails::Lab(LabAttributes::new("crp", "CRP", 0.3, Some("mg/L")).unwrap()),
        HealthEventDetails::Symptom(
            SymptomAttributes::new("headache", "Headache", 3, None).unwrap(),
        ),
    ];

    let mut created = Vec::new();
    for (index, details) in details.into_iter().enumerate() {
        created.push(
            service
                .create_event(CreateHealthEvent {
                    occurred_at: datetime!(2026-07-30 01:00:00 UTC)
                        + time::Duration::hours(index as i64),
                    details,
                    note: None,
                    actor: "integration-test".to_string(),
                })
                .unwrap(),
        );
    }

    assert_eq!(
        service.get_event(created[0].id().as_str()).unwrap(),
        created[0]
    );
    let medication = service
        .list_events(EventQuery::new(Page::default()).with_category(HealthCategory::Medication))
        .unwrap();
    assert_eq!(medication, vec![created[1].clone()]);
    let crp = service
        .list_events(
            EventQuery::new(Page::default())
                .with_metric_key("CRP")
                .unwrap(),
        )
        .unwrap();
    assert_eq!(crp, vec![created[4].clone()]);

    for event in created {
        let audit = service
            .audit_for("health_event", event.id().as_str(), Page::default())
            .unwrap();
        assert_eq!(audit.len(), 1);
        assert_eq!(audit[0].action(), "create");
    }
}

#[test]
fn update_is_optimistic_and_preserves_identity_and_creation_time() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let before = service
        .create_event(CreateHealthEvent {
            occurred_at: datetime!(2026-07-30 09:00:00 +09:00),
            details: HealthEventDetails::Bowel(BowelAttributes::new(4, false).unwrap()),
            note: None,
            actor: "integration-test".to_string(),
        })
        .unwrap();

    let after = service
        .update_event(
            before.id().as_str(),
            UpdateHealthEvent {
                details: Some(HealthEventDetails::Bowel(
                    BowelAttributes::new(5, true).unwrap(),
                )),
                note: Some(Some("changed".to_string())),
                expected_updated_at: Some(before.updated_at()),
                actor: "integration-test".to_string(),
                reason: Some("correction".to_string()),
                ..UpdateHealthEvent::default()
            },
        )
        .unwrap();

    assert_eq!(after.id(), before.id());
    assert_eq!(after.created_at(), before.created_at());
    assert!(after.updated_at() > before.updated_at());
    assert_eq!(after.value_num(), Some(5.0));
    assert_eq!(after.note(), Some("changed"));
    assert!(matches!(
        service.update_event(
            after.id().as_str(),
            UpdateHealthEvent {
                expected_updated_at: Some(before.updated_at()),
                actor: "integration-test".to_string(),
                ..UpdateHealthEvent::default()
            }
        ),
        Err(HealthError::Conflict(_))
    ));
    assert_eq!(
        service
            .audit_for("health_event", after.id().as_str(), Page::default())
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn rejects_invalid_typed_category_values_before_writing() {
    assert!(BowelAttributes::new(8, false).is_err());
    assert!(SymptomAttributes::overall_condition("Condition", 11, None).is_err());
    assert!(MedicationAttributes::new("", 1.0, MedicationUnit::Tablet).is_err());
}

#[test]
fn regular_update_keeps_category_and_metric_identity_stable() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let before = service
        .create_event(CreateHealthEvent {
            occurred_at: datetime!(2026-07-30 09:00:00 +09:00),
            details: HealthEventDetails::Weight(
                WeightAttributes::body_weight("Weight", 68.2, "kg").unwrap(),
            ),
            note: None,
            actor: "integration-test".to_string(),
        })
        .unwrap();

    let result = service.update_event(
        before.id().as_str(),
        UpdateHealthEvent {
            details: Some(HealthEventDetails::Weight(
                WeightAttributes::new("different_weight", "Weight", 68.2, "kg").unwrap(),
            )),
            expected_updated_at: Some(before.updated_at()),
            actor: "integration-test".to_string(),
            ..UpdateHealthEvent::default()
        },
    );

    assert!(matches!(
        result,
        Err(HealthError::Validation {
            field: "event.identity",
            ..
        })
    ));
    assert_eq!(service.get_event(before.id().as_str()).unwrap(), before);
}

struct Fixture {
    _directory: tempfile::TempDir,
    database: std::path::PathBuf,
    media: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        Self {
            database: directory.path().join("health.sqlite"),
            media: directory.path().join("media"),
            _directory: directory,
        }
    }

    fn service(&self) -> HealthService<SqliteHealthRepository, LocalMediaStore> {
        HealthService::new(
            SqliteHealthRepository::open(&self.database).unwrap(),
            LocalMediaStore::new(&self.media).unwrap(),
        )
    }
}
