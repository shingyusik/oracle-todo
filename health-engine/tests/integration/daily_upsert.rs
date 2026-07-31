use health_engine::application::commands::DailyMetricInput;
use health_engine::application::error::HealthError;
use health_engine::application::ports::{EventQuery, Page};
use health_engine::application::service::HealthService;
use health_engine::domain::{
    HealthEventDetails, LabAttributes, SleepAttributes, SleepValue, SymptomAttributes,
    WeightAttributes,
};
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use rusqlite::Connection;
use time::{UtcOffset, macros::datetime};

#[test]
fn daily_weight_upsert_updates_instead_of_duplicating() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let first = service
        .upsert_daily_metrics(vec![weight(68.2, "actor")])
        .unwrap()
        .remove(0);
    let second = service
        .upsert_daily_metrics(vec![weight(67.9, "actor")])
        .unwrap()
        .remove(0);

    let rows = service
        .list_events(
            EventQuery::new(Page::default())
                .with_metric_key("BODY_WEIGHT")
                .unwrap(),
        )
        .unwrap();
    assert_eq!(rows, vec![second.clone()]);
    assert_eq!(rows[0].value_num(), Some(67.9));
    assert_eq!(second.id(), first.id());
    assert_eq!(second.created_at(), first.created_at());
    let audits = service
        .audit_for("health_event", second.id().as_str(), Page::default())
        .unwrap();
    assert_eq!(
        audits
            .iter()
            .map(|audit| audit.action())
            .collect::<Vec<_>>(),
        ["create", "update"]
    );
}

#[test]
fn batch_validates_every_item_and_duplicate_identity_before_any_write() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let result = service.upsert_daily_metrics(vec![
        weight(68.2, "actor"),
        DailyMetricInput {
            details: HealthEventDetails::Sleep(
                SleepAttributes::sleep_duration("Sleep", SleepValue::hours(7.0).unwrap()).unwrap(),
            ),
            actor: " ".to_string(),
            ..daily()
        },
    ]);
    assert!(matches!(result, Err(HealthError::Validation { .. })));
    assert!(
        service
            .list_events(EventQuery::default())
            .unwrap()
            .is_empty()
    );

    let duplicate =
        service.upsert_daily_metrics(vec![weight(68.2, "actor"), weight(67.9, "actor")]);
    assert!(matches!(
        duplicate,
        Err(HealthError::Validation {
            field: "daily_metrics",
            ..
        })
    ));
    assert!(
        service
            .list_events(EventQuery::default())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn one_batch_writes_one_audit_per_record_with_shared_request_id() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let events = service
        .upsert_daily_metrics(vec![
            weight(68.2, "actor"),
            DailyMetricInput {
                details: HealthEventDetails::Lab(
                    LabAttributes::new("crp", "CRP", 0.3, None).unwrap(),
                ),
                actor: "actor".to_string(),
                ..daily()
            },
            DailyMetricInput {
                details: HealthEventDetails::Symptom(
                    SymptomAttributes::overall_condition("Condition", 7, None).unwrap(),
                ),
                actor: "actor".to_string(),
                ..daily()
            },
        ])
        .unwrap();

    let audits = events
        .iter()
        .map(|event| {
            service
                .audit_for("health_event", event.id().as_str(), Page::default())
                .unwrap()
                .remove(0)
        })
        .collect::<Vec<_>>();
    assert!(audits.iter().all(|audit| audit.action() == "create"));
    assert!(
        audits
            .iter()
            .all(|audit| audit.request_id() == audits[0].request_id())
    );
}

#[test]
fn fixed_offset_controls_canonical_local_date_at_midnight() {
    let fixture = Fixture::new();
    let mut seoul = fixture
        .service()
        .with_local_offset(UtcOffset::from_hms(9, 0, 0).unwrap());
    let mut input = weight(68.2, "actor");
    input.occurred_at = datetime!(2026-07-29 15:00:00 UTC);
    seoul.upsert_daily_metrics(vec![input]).unwrap();

    assert_eq!(
        Connection::open(&fixture.database)
            .unwrap()
            .query_row("SELECT local_date FROM health_events", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
        "2026-07-30"
    );
}

#[test]
fn only_weight_sleep_lab_and_overall_condition_are_daily_metrics() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let symptom = DailyMetricInput {
        details: HealthEventDetails::Symptom(
            SymptomAttributes::new("headache", "Headache", 3, None).unwrap(),
        ),
        actor: "actor".to_string(),
        ..daily()
    };

    assert!(matches!(
        service.upsert_daily_metrics(vec![symptom]),
        Err(HealthError::Validation {
            field: "daily_metrics",
            ..
        })
    ));
}

#[test]
fn two_service_handles_cannot_create_duplicate_daily_rows() {
    let fixture = Fixture::new();
    let mut first = fixture.service();
    let mut second = fixture.service();

    let created = first
        .upsert_daily_metrics(vec![weight(68.2, "first")])
        .unwrap()
        .remove(0);
    let updated = second
        .upsert_daily_metrics(vec![weight(67.9, "second")])
        .unwrap()
        .remove(0);

    assert_eq!(updated.id(), created.id());
    assert_eq!(second.list_events(EventQuery::default()).unwrap().len(), 1);
}

#[test]
fn failed_batch_audit_rolls_back_every_metric_and_audit() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    Connection::open(&fixture.database)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER reject_second_health_audit
             BEFORE INSERT ON audit_events
             WHEN NEW.record_type = 'health_event'
              AND (SELECT COUNT(*) FROM audit_events) = 1
             BEGIN
                 SELECT RAISE(ABORT, 'audit failure');
             END;",
        )
        .unwrap();

    assert!(matches!(
        service.upsert_daily_metrics(vec![
            weight(68.2, "actor"),
            DailyMetricInput {
                details: HealthEventDetails::Lab(
                    LabAttributes::new("crp", "CRP", 0.3, None).unwrap(),
                ),
                actor: "actor".to_string(),
                ..daily()
            },
        ]),
        Err(HealthError::Storage(_))
    ));
    let connection = Connection::open(&fixture.database).unwrap();
    for table in ["health_events", "audit_events"] {
        assert_eq!(
            connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
    }
}

#[test]
fn identical_daily_submission_is_a_noop_without_another_audit() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let first = service
        .upsert_daily_metrics(vec![weight(68.2, "actor")])
        .unwrap()
        .remove(0);
    let second = service
        .upsert_daily_metrics(vec![weight(68.2, "actor")])
        .unwrap()
        .remove(0);

    assert_eq!(second, first);
    assert_eq!(
        service
            .audit_for("health_event", first.id().as_str(), Page::default())
            .unwrap()
            .len(),
        1
    );
}

fn daily() -> DailyMetricInput {
    DailyMetricInput {
        occurred_at: datetime!(2026-07-30 09:00:00 +09:00),
        details: HealthEventDetails::Weight(
            WeightAttributes::body_weight("Weight", 1.0, "kg").unwrap(),
        ),
        note: None,
        actor: String::new(),
    }
}

fn weight(value: f64, actor: &str) -> DailyMetricInput {
    DailyMetricInput {
        details: HealthEventDetails::Weight(
            WeightAttributes::body_weight("Weight", value, "kg").unwrap(),
        ),
        actor: actor.to_string(),
        ..daily()
    }
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
