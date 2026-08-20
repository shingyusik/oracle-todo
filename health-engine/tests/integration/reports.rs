use health_engine::application::commands::{CreateDietEntry, CreateHealthEvent, DailyMetricInput};
use health_engine::application::error::HealthError;
use health_engine::application::reports::{FixedMetric, HealthReportRange};
use health_engine::application::service::HealthService;
use health_engine::domain::{
    BowelAttributes, HealthEventDetails, LabAttributes, MealType, MedicationAttributes,
    MedicationUnit, SleepAttributes, SleepValue, SymptomAttributes, WeightAttributes,
};
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use rusqlite::Connection;
use time::{Date, Duration, UtcOffset, macros::datetime};

#[test]
fn reports_validate_ranges_and_preserve_missing_values() {
    let fixture = Fixture::new(UtcOffset::UTC);
    let service = fixture.service();
    for range in [
        HealthReportRange {
            from: date(2),
            to: date(1),
        },
        HealthReportRange {
            from: Date::MAX,
            to: Date::MAX,
        },
        HealthReportRange {
            from: datetime!(2025-01-01 00:00 UTC).date(),
            to: date(2),
        },
    ] {
        assert!(matches!(
            service.reports_at(range, datetime!(2026-07-10 00:00 UTC)),
            Err(HealthError::Validation { .. })
        ));
    }
    let edge = Fixture::new(UtcOffset::from_hms(23, 59, 59).unwrap()).service();
    let earliest_selectable = Date::MIN.next_day().unwrap();
    assert!(matches!(
        edge.reports_at(
            HealthReportRange {
                from: earliest_selectable,
                to: earliest_selectable
            },
            datetime!(2026-07-10 00:00 UTC)
        ),
        Err(HealthError::Validation { .. })
    ));
    let report = service
        .reports_at(range(1, 2), datetime!(2026-07-10 00:00 UTC))
        .unwrap();
    assert_eq!(
        (report.diet_count.current, report.diet_count.previous),
        (None, None)
    );
    assert_eq!(
        (report.bowel.current_count, report.bowel.current_average),
        (None, None)
    );
    assert_eq!(report.medication_count.current, None);
    assert_eq!(report.medication_count.previous, None);
    assert_eq!(report.bowel.previous_count, None);
    assert_eq!(report.bowel.previous_average, None);
    assert!(
        report
            .metrics
            .iter()
            .all(|metric| metric.current.is_none() && metric.previous.is_none())
    );
}

#[test]
fn reports_compare_equal_periods_and_use_preceding_daily_reading() {
    let fixture = Fixture::new(UtcOffset::UTC);
    let mut service = fixture.service();
    diet(&mut service, datetime!(2026-07-01 12:00 UTC), &["old"]);
    diet(&mut service, datetime!(2026-07-03 12:00 UTC), &["new"]);
    bowel(&mut service, datetime!(2026-07-02 10:00 UTC), 3);
    bowel(&mut service, datetime!(2026-07-03 10:00 UTC), 6);
    bowel(&mut service, datetime!(2026-07-04 10:00 UTC), 4);
    medication(&mut service, datetime!(2026-07-02 11:00 UTC), "A");
    medication(&mut service, datetime!(2026-07-03 11:00 UTC), "B");
    daily_weight(&mut service, datetime!(2026-06-30 09:00 UTC), 70.0);
    event(
        &mut service,
        datetime!(2026-07-01 09:00 UTC),
        HealthEventDetails::Weight(WeightAttributes::body_weight("ordinary", 69.5, "kg").unwrap()),
    );
    let archived_daily = service
        .upsert_daily_metrics(vec![daily(
            datetime!(2026-07-02 09:00 UTC),
            HealthEventDetails::Weight(
                WeightAttributes::body_weight("archived", 69.0, "kg").unwrap(),
            ),
        )])
        .unwrap()
        .remove(0);
    service.archive_event(archived_daily.id().as_str()).unwrap();
    daily_weight(&mut service, datetime!(2026-07-03 09:00 UTC), 68.0);
    event(
        &mut service,
        datetime!(2026-07-04 09:00 UTC),
        HealthEventDetails::Weight(WeightAttributes::body_weight("ordinary", 1.0, "kg").unwrap()),
    );

    let report = service
        .reports_at(range(3, 4), datetime!(2026-07-10 00:00 UTC))
        .unwrap();
    assert_eq!(report.previous_range, range(1, 2));
    assert_eq!(
        (report.diet_count.current, report.diet_count.previous),
        (Some(1), Some(1))
    );
    assert_eq!(
        (report.bowel.current_count, report.bowel.previous_count),
        (Some(2), Some(1))
    );
    assert_eq!(
        (report.bowel.current_average, report.bowel.previous_average),
        (Some(5.0), Some(3.0))
    );
    assert_eq!(
        (
            report.medication_count.current,
            report.medication_count.previous
        ),
        (Some(1), Some(1))
    );
    let weight = report
        .metrics
        .iter()
        .find(|item| item.metric == FixedMetric::BodyWeight)
        .unwrap();
    assert_eq!(weight.current.as_ref().unwrap().value, 68.0);
    assert_eq!(weight.previous.as_ref().unwrap().value, 70.0);
    assert_eq!(report.metric_series[0].points.len(), 1);
}

#[test]
fn bowel_responses_obey_boundaries_eligibility_and_ordering() {
    let fixture = Fixture::new(UtcOffset::UTC);
    let mut service = fixture.service();
    let meal = datetime!(2026-07-03 12:00 UTC);
    diet(&mut service, meal, &["zeta", "shared"]);
    diet(
        &mut service,
        meal + Duration::hours(1),
        &["alpha", "shared"],
    );
    diet(&mut service, meal + Duration::days(2), &["incomplete"]);
    for (at, scale) in [
        (meal, 1),
        (meal + Duration::nanoseconds(1), 2),
        (meal + Duration::hours(2), 3),
        (meal + Duration::hours(3), 4),
        (meal + Duration::hours(4), 5),
        (meal + Duration::hours(24), 6),
        (meal + Duration::hours(24) + Duration::nanoseconds(1), 7),
    ] {
        bowel(&mut service, at, scale);
    }

    let report = service
        .reports_at(range(3, 5), meal + Duration::hours(60))
        .unwrap();
    assert_eq!(
        report.reaction_disclaimer,
        "Observed associations only; they do not establish causation."
    );
    assert_eq!(
        report
            .diet_tag_frequencies
            .iter()
            .map(|row| (row.name.as_str(), row.count))
            .collect::<Vec<_>>(),
        vec![("shared", 2), ("alpha", 1), ("incomplete", 1), ("zeta", 1)]
    );
    assert_eq!(
        report
            .diet_tag_bowel_responses
            .iter()
            .map(|row| (
                row.tag.as_str(),
                row.positive_meals,
                row.eligible_meals,
                row.rate
            ))
            .collect::<Vec<_>>(),
        vec![
            ("alpha", 1, 1, 1.0),
            ("incomplete", 0, 0, 0.0),
            ("shared", 2, 2, 1.0),
            ("zeta", 1, 1, 1.0)
        ]
    );
}

#[test]
fn bowel_responses_classify_every_bristol_value_and_exact_window_edge() {
    let fixture = Fixture::new(UtcOffset::UTC);
    let mut service = fixture.service();
    for scale in 1..=7 {
        let meal = datetime!(2026-07-01 12:00 UTC) + Duration::days(i64::from(scale - 1) * 2);
        diet(&mut service, meal, &[&format!("scale_{scale}")]);
        bowel(&mut service, meal + Duration::hours(1), scale);
    }
    let instant = datetime!(2026-07-16 12:00 UTC);
    diet(&mut service, instant, &["instant_or_after"]);
    bowel(&mut service, instant, 1);
    bowel(
        &mut service,
        instant + Duration::hours(24) + Duration::nanoseconds(1),
        7,
    );
    let after = datetime!(2026-07-19 12:00 UTC);
    diet(&mut service, after, &["after_start"]);
    bowel(&mut service, after + Duration::nanoseconds(1), 2);
    let exact_end = datetime!(2026-07-22 12:00 UTC);
    diet(&mut service, exact_end, &["exact_end"]);
    bowel(&mut service, exact_end + Duration::hours(24), 6);

    let report = service
        .reports_at(
            HealthReportRange {
                from: date(1),
                to: date(23),
            },
            datetime!(2026-07-30 00:00 UTC),
        )
        .unwrap();
    assert_eq!(
        report
            .diet_tag_bowel_responses
            .iter()
            .map(|row| (row.tag.as_str(), row.positive_meals, row.eligible_meals))
            .collect::<Vec<_>>(),
        vec![
            ("after_start", 1, 1),
            ("exact_end", 1, 1),
            ("instant_or_after", 0, 1),
            ("scale_1", 1, 1),
            ("scale_2", 1, 1),
            ("scale_3", 0, 1),
            ("scale_4", 0, 1),
            ("scale_5", 0, 1),
            ("scale_6", 1, 1),
            ("scale_7", 1, 1),
        ]
    );
}

#[test]
fn bowel_response_rate_uses_all_eligible_meals() {
    let fixture = Fixture::new(UtcOffset::UTC);
    let mut service = fixture.service();
    let first = datetime!(2026-07-01 12:00 UTC);
    diet(&mut service, first, &["rate"]);
    bowel(&mut service, first + Duration::hours(1), 1);
    diet(&mut service, first + Duration::days(3), &["rate"]);
    let report = service
        .reports_at(
            HealthReportRange {
                from: date(1),
                to: date(4),
            },
            datetime!(2026-07-10 00:00 UTC),
        )
        .unwrap();
    let response = &report.diet_tag_bowel_responses[0];
    assert_eq!(
        (
            response.positive_meals,
            response.eligible_meals,
            response.rate
        ),
        (1, 2, 0.5)
    );
}

#[test]
fn reports_use_historical_lookahead_active_rows_and_fixed_offset_dates() {
    let fixture = Fixture::new(UtcOffset::from_hms(9, 0, 0).unwrap());
    let mut service = fixture.service();
    let meal = datetime!(2026-07-03 00:30 +09:00);
    diet(&mut service, meal, &["late"]);
    let archived_diet = diet(&mut service, meal, &["archived"]);
    service.archive_diet(archived_diet.id().as_str()).unwrap();
    bowel(&mut service, meal + Duration::hours(24), 7);
    let archived = medication(&mut service, datetime!(2026-07-03 15:30 UTC), "archived");
    service.archive_event(archived.id().as_str()).unwrap();
    let report = service
        .reports_at(range(3, 3), datetime!(2026-07-10 00:00 UTC))
        .unwrap();
    assert_eq!(report.diet_count.current, Some(1));
    assert_eq!(report.medication_count.current, None);
    assert_eq!(report.diet_tag_bowel_responses[0].positive_meals, 1);
    assert!(report.bowel_points.is_empty());
}

#[test]
fn report_points_break_equal_instant_ties_by_id() {
    let fixture = Fixture::new(UtcOffset::UTC);
    let service = fixture.service();
    let connection = Connection::open(&fixture.database).unwrap();
    connection
        .execute_batch("DROP INDEX uq_health_daily_metric;")
        .unwrap();
    for (id, scale) in [
        ("00000000-0000-4000-8000-000000000012", 6),
        ("00000000-0000-4000-8000-000000000011", 4),
    ] {
        let attributes = serde_json::json!({
            "bristol_scale": scale, "blood_visible": false
        })
        .to_string();
        connection
            .execute(
                "INSERT INTO health_events (
                    id, occurred_at, local_date, category, metric_key, name, value_num,
                    attributes_json, daily_upsert, created_at, updated_at
                 ) VALUES (
                    ?1, '2026-07-03T12:00:00.000000000Z', '2026-07-03',
                    'bowel', 'bowel', 'Bowel', ?2, ?3, 0,
                    '2026-07-03T12:00:00.000000000Z', '2026-07-03T12:00:00.000000000Z'
                 )",
                rusqlite::params![id, scale, attributes],
            )
            .unwrap();
    }
    for (id, value) in [
        ("00000000-0000-4000-8000-000000000002", 68.0),
        ("00000000-0000-4000-8000-000000000001", 67.0),
    ] {
        let attributes = serde_json::json!({
            "metric_key": "body_weight", "name": "Weight", "value": value, "unit": "kg"
        })
        .to_string();
        connection
            .execute(
                "INSERT INTO health_events (
                id, occurred_at, local_date, category, metric_key, name, value_num,
                unit, attributes_json, daily_upsert, created_at, updated_at
             ) VALUES (
                ?1, '2026-07-03T09:00:00.000000000Z', '2026-07-03',
                'weight', 'body_weight', 'Weight', ?2, 'kg', ?3, 1,
                '2026-07-03T09:00:00.000000000Z', '2026-07-03T09:00:00.000000000Z'
             )",
                rusqlite::params![id, value, attributes],
            )
            .unwrap();
    }
    let report = service
        .reports_at(range(3, 3), datetime!(2026-07-10 00:00 UTC))
        .unwrap();
    assert_eq!(
        report
            .bowel_points
            .iter()
            .map(|point| point.bristol_scale)
            .collect::<Vec<_>>(),
        vec![4, 6]
    );
    let weight = report
        .metric_series
        .iter()
        .find(|series| series.metric == FixedMetric::BodyWeight)
        .unwrap();
    assert_eq!(
        weight
            .points
            .iter()
            .map(|point| point.value)
            .collect::<Vec<_>>(),
        vec![67.0, 68.0]
    );
    assert!(
        serde_json::to_value(&report.bowel_points[0])
            .unwrap()
            .get("id")
            .is_none()
    );
    assert!(
        serde_json::to_value(&weight.points[0])
            .unwrap()
            .get("id")
            .is_none()
    );
}

#[test]
fn reports_publish_all_five_fixed_daily_metrics() {
    let fixture = Fixture::new(UtcOffset::UTC);
    let mut service = fixture.service();
    let occurred_at = datetime!(2026-07-03 09:00 UTC);
    service
        .upsert_daily_metrics(vec![
            daily(
                occurred_at,
                HealthEventDetails::Weight(
                    WeightAttributes::body_weight("Weight", 68.0, "kg").unwrap(),
                ),
            ),
            daily(
                occurred_at,
                HealthEventDetails::Sleep(
                    SleepAttributes::sleep_duration("Sleep", SleepValue::hours(7.5).unwrap())
                        .unwrap(),
                ),
            ),
            daily(
                occurred_at,
                HealthEventDetails::Lab(
                    LabAttributes::new("crp", "CRP", 0.4, Some("mg/L")).unwrap(),
                ),
            ),
            daily(
                occurred_at,
                HealthEventDetails::Lab(
                    LabAttributes::new(
                        "fecal_calprotectin",
                        "Fecal calprotectin",
                        40.0,
                        Some("µg/g"),
                    )
                    .unwrap(),
                ),
            ),
            daily(
                occurred_at,
                HealthEventDetails::Symptom(
                    SymptomAttributes::overall_condition("Overall condition", 8, None).unwrap(),
                ),
            ),
        ])
        .unwrap();
    let report = service
        .reports_at(range(3, 3), datetime!(2026-07-10 00:00 UTC))
        .unwrap();
    assert_eq!(
        report
            .metrics
            .iter()
            .map(|row| (row.metric, row.unit, row.current.as_ref().unwrap().value))
            .collect::<Vec<_>>(),
        vec![
            (FixedMetric::BodyWeight, Some("kg"), 68.0),
            (FixedMetric::SleepDuration, Some("hours"), 7.5),
            (FixedMetric::Crp, Some("mg/L"), 0.4),
            (FixedMetric::FecalCalprotectin, Some("µg/g"), 40.0),
            (FixedMetric::OverallCondition, None, 8.0),
        ]
    );
    assert!(
        report
            .metric_series
            .iter()
            .all(|series| series.points.len() == 1)
    );
}

#[test]
fn reports_reject_more_than_the_shared_record_ceiling() {
    let fixture = Fixture::new(UtcOffset::UTC);
    let service = fixture.service();
    Connection::open(&fixture.database)
        .unwrap()
        .execute_batch(
            "WITH RECURSIVE rows(value) AS (
             SELECT 1 UNION ALL SELECT value + 1 FROM rows WHERE value < 100001
         )
         INSERT INTO diet_entries (
             id, occurred_at, local_date, meal_type, food_name, created_at, updated_at
         )
         SELECT printf('00000000-0000-4000-8000-%012x', value),
                '2026-07-03T12:00:00.000000000Z', '2026-07-03', 'lunch', 'meal',
                '2026-07-03T12:00:00.000000000Z', '2026-07-03T12:00:00.000000000Z'
         FROM rows;",
        )
        .unwrap();
    let result = service.reports_at(range(3, 3), datetime!(2026-07-10 00:00 UTC));
    assert!(
        matches!(
            result,
            Err(HealthError::Validation {
                field: "reports.records",
                ..
            })
        ),
        "{result:?}"
    );
}

fn range(from: u8, to: u8) -> HealthReportRange {
    HealthReportRange {
        from: date(from),
        to: date(to),
    }
}
fn date(day: u8) -> Date {
    Date::from_calendar_date(2026, time::Month::July, day).unwrap()
}
fn diet(
    service: &mut Service,
    occurred_at: time::OffsetDateTime,
    tags: &[&str],
) -> health_engine::domain::DietEntry {
    service
        .create_diet(CreateDietEntry {
            occurred_at,
            meal_type: MealType::Lunch,
            food_name: "meal".into(),
            note: None,
            tags: tags.iter().map(|tag| (*tag).into()).collect(),
            media: None,
            actor: "test".into(),
        })
        .unwrap()
}
fn event(
    service: &mut Service,
    occurred_at: time::OffsetDateTime,
    details: HealthEventDetails,
) -> health_engine::domain::HealthEvent {
    service
        .create_event(CreateHealthEvent {
            occurred_at,
            details,
            note: None,
            actor: "test".into(),
        })
        .unwrap()
}
fn bowel(service: &mut Service, occurred_at: time::OffsetDateTime, scale: u8) {
    event(
        service,
        occurred_at,
        HealthEventDetails::Bowel(BowelAttributes::new(scale, false).unwrap()),
    );
}
fn medication(
    service: &mut Service,
    occurred_at: time::OffsetDateTime,
    name: &str,
) -> health_engine::domain::HealthEvent {
    event(
        service,
        occurred_at,
        HealthEventDetails::Medication(
            MedicationAttributes::new(name, 1.0, MedicationUnit::Tablet).unwrap(),
        ),
    )
}
fn daily_weight(service: &mut Service, occurred_at: time::OffsetDateTime, value: f64) {
    service
        .upsert_daily_metrics(vec![DailyMetricInput {
            occurred_at,
            details: HealthEventDetails::Weight(
                WeightAttributes::body_weight("Weight", value, "kg").unwrap(),
            ),
            note: None,
            actor: "test".into(),
            expected_updated_at: None,
        }])
        .unwrap();
}
fn daily(occurred_at: time::OffsetDateTime, details: HealthEventDetails) -> DailyMetricInput {
    DailyMetricInput {
        occurred_at,
        details,
        note: None,
        actor: "test".into(),
        expected_updated_at: None,
    }
}

type Service = HealthService<SqliteHealthRepository, LocalMediaStore>;
struct Fixture {
    _directory: tempfile::TempDir,
    database: std::path::PathBuf,
    media: std::path::PathBuf,
    offset: UtcOffset,
}
impl Fixture {
    fn new(offset: UtcOffset) -> Self {
        let directory = tempfile::tempdir().unwrap();
        Self {
            database: directory.path().join("health.sqlite"),
            media: directory.path().join("media"),
            _directory: directory,
            offset,
        }
    }
    fn service(&self) -> Service {
        HealthService::new(
            SqliteHealthRepository::open(&self.database).unwrap(),
            LocalMediaStore::new(&self.media).unwrap(),
        )
        .with_local_offset(self.offset)
    }
}
