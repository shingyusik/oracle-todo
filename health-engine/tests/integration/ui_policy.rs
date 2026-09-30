use health_engine::application::commands::{
    CreateHealthEvent, DailyMetricInput, UpdateHealthEvent,
};
use health_engine::application::error::HealthError;
use health_engine::application::ports::{EventQuery, Page};
use health_engine::application::service::HealthService;
use health_engine::domain::{
    HealthEventDetails, LabAttributes, SymptomAttributes, WeightAttributes,
};
use health_engine::infrastructure::{media::LocalMediaStore, sqlite::SqliteHealthRepository};
use time::macros::datetime;

#[test]
fn canonical_daily_policy_is_atomic_versioned_and_preserves_legacy_inspection() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("health.sqlite");
    let mut service = HealthService::new(
        SqliteHealthRepository::open(&path).unwrap(),
        LocalMediaStore::new(temp.path().join("media")).unwrap(),
    );
    let at = datetime!(2026-09-30 12:00 +09:00);
    let weight = || DailyMetricInput {
        occurred_at: at,
        details: HealthEventDetails::Weight(
            WeightAttributes::body_weight("Body weight", 68.0, "kg").unwrap(),
        ),
        note: None,
        actor: "test".into(),
        expected_updated_at: None,
    };
    assert!(matches!(
        service.create_event(CreateHealthEvent {
            occurred_at: at,
            details: weight().details,
            note: None,
            actor: "test".into()
        }),
        Err(HealthError::Validation { .. })
    ));
    for details in [
        HealthEventDetails::Weight(WeightAttributes::body_weight("Weight", 68.0, "kg").unwrap()),
        HealthEventDetails::Lab(LabAttributes::new("crp", "CRP", -0.1, Some("mg/L")).unwrap()),
        HealthEventDetails::Lab(LabAttributes::new("crp", "CRP", 1.0, Some("mg/dL")).unwrap()),
        HealthEventDetails::Symptom(
            SymptomAttributes::new("headache", "Headache", 3, None).unwrap(),
        ),
    ] {
        assert!(matches!(
            service.upsert_daily_metrics(vec![
                weight(),
                DailyMetricInput {
                    details,
                    ..weight()
                }
            ]),
            Err(HealthError::Validation { .. })
        ));
        assert!(
            service
                .list_events(EventQuery::default())
                .unwrap()
                .is_empty()
        );
    }
    let saved = service
        .upsert_daily_metrics(vec![weight()])
        .unwrap()
        .remove(0);
    assert!(matches!(
        service.upsert_daily_metrics(vec![weight()]),
        Err(HealthError::Validation {
            field: "expected_updated_at",
            ..
        })
    ));
    assert!(matches!(
        service.update_event(
            saved.id().as_str(),
            UpdateHealthEvent {
                occurred_at: Some(at + time::Duration::days(1)),
                expected_updated_at: Some(saved.updated_at()),
                actor: "test".into(),
                ..UpdateHealthEvent::default()
            }
        ),
        Err(HealthError::Validation { .. })
    ));
    let legacy = super::legacy_support::seed(
        &path,
        at,
        HealthEventDetails::Lab(
            LabAttributes::new("custom", "Custom", -2.0, Some("other")).unwrap(),
        ),
        false,
    );
    let records = service.inspect_records(Page::default()).unwrap();
    assert!(records.iter().any(|item| item.id() == legacy.id().as_str()));
    let archived = service
        .archive_event_if_current(legacy.id().as_str(), Some(legacy.updated_at()))
        .unwrap();
    assert!(
        service
            .get_event_including_archived(legacy.id().as_str())
            .unwrap()
            .is_deleted()
    );
    service
        .restore_event_if_current(legacy.id().as_str(), Some(archived.updated_at()))
        .unwrap();
    assert_eq!(
        service
            .audit_for("health_event", legacy.id().as_str(), Page::default())
            .unwrap()
            .len(),
        2
    );
}
