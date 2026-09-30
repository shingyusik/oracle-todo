use health_engine::application::commands::DailyMetricInput;
use health_engine::application::error::HealthError;
use health_engine::application::service::HealthService;
use health_engine::domain::{HealthEventDetails, WeightAttributes};
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use time::macros::datetime;

#[test]
fn lifecycle_rejects_invalid_transitions_and_restore_daily_conflicts() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let input = || DailyMetricInput {
        occurred_at: datetime!(2026-07-30 09:00:00 +09:00),
        details: HealthEventDetails::Weight(
            WeightAttributes::body_weight("Body weight", 68.0, "kg").unwrap(),
        ),
        note: None,
        actor: "test".to_string(),
        expected_updated_at: None,
    };
    let first = service
        .upsert_daily_metrics(vec![input()])
        .unwrap()
        .remove(0);
    assert!(matches!(
        service.archive_event_if_current(
            first.id().as_str(),
            Some(first.updated_at() - time::Duration::nanoseconds(1))
        ),
        Err(HealthError::Conflict(_))
    ));
    assert!(matches!(
        service.restore_event(first.id().as_str()),
        Err(HealthError::Conflict(_))
    ));
    let archived = service.archive_event(first.id().as_str()).unwrap();
    assert!(archived.is_deleted());
    assert!(service.get_event(first.id().as_str()).is_err());
    assert!(matches!(
        service.archive_event(first.id().as_str()),
        Err(HealthError::Conflict(_))
    ));

    service.upsert_daily_metrics(vec![input()]).unwrap();
    assert!(matches!(
        service.restore_event(first.id().as_str()),
        Err(HealthError::Conflict(_))
    ));
    assert!(
        service
            .get_event_including_archived(first.id().as_str())
            .unwrap()
            .is_deleted()
    );
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
