use health_engine::{
    application::{
        commands::{CreateDietEntry, CreateHealthEvent, DailyMetricInput},
        service::HealthService,
        table::*,
    },
    domain::{
        BowelAttributes, HealthEventDetails, LabAttributes, MealType, MedicationAttributes,
        MedicationUnit, WeightAttributes,
    },
    infrastructure::{media::LocalMediaStore, sqlite::SqliteHealthRepository},
};
use time::{Date, Duration, Month, macros::datetime};

fn groups(_scope: HealthTableScope, group_by: HealthTableGroup) -> HealthTableGroupSettings {
    HealthTableGroupSettings::new(group_by, GroupSort::Manual, true, vec![], vec![]).unwrap()
}

#[test]
fn diet_pages_fifty_rows_then_one_without_hydrating_the_probe() {
    let directory = tempfile::tempdir().unwrap();
    let repository = SqliteHealthRepository::open(directory.path().join("health.sqlite")).unwrap();
    let media = LocalMediaStore::new(directory.path().join("media")).unwrap();
    let mut service = HealthService::new(repository, media);
    for index in 0..51 {
        service
            .create_diet(CreateDietEntry {
                occurred_at: datetime!(2025-01-01 00:00 UTC) + Duration::hours(index),
                meal_type: MealType::Breakfast,
                food_name: format!("food-{index:02}"),
                note: None,
                tags: vec!["page".into()],
                media: None,
                actor: "test".into(),
            })
            .unwrap();
    }
    let settings = groups(
        HealthTableScope::Diet,
        HealthTableGroup::Diet(DietTableGroup::None),
    );
    let first = service
        .query_table(
            &HealthTableQuery::new(
                HealthTableScope::Diet,
                0,
                50,
                FilterMode::And,
                vec![],
                vec![HealthTableSort::Diet {
                    field: DietTableSortField::Date,
                    direction: SortDirection::Desc,
                }],
                settings.clone(),
                None,
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(first.items.len(), 50);
    assert_eq!(first.next_offset, Some(50));
    let second = service
        .query_table(
            &HealthTableQuery::new(
                HealthTableScope::Diet,
                50,
                50,
                FilterMode::And,
                vec![],
                vec![HealthTableSort::Diet {
                    field: DietTableSortField::Date,
                    direction: SortDirection::Desc,
                }],
                settings,
                None,
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(second.items.len(), 1);
    assert_eq!(second.next_offset, None);
}

#[test]
fn table_query_validates_scope_operator_value_limit_and_reference_date() {
    let sort = HealthTableSort::Diet {
        field: DietTableSortField::Date,
        direction: SortDirection::Desc,
    };
    let group = groups(
        HealthTableScope::Diet,
        HealthTableGroup::Diet(DietTableGroup::None),
    );
    assert!(
        HealthTableQuery::new(
            HealthTableScope::Diet,
            0,
            51,
            FilterMode::And,
            vec![],
            vec![sort],
            group.clone(),
            None
        )
        .is_err()
    );
    let wrong = HealthTableFilter::Bowel {
        field: BowelTableFilterField::Date,
        operator: HealthFilterOperator::Is,
        value: HealthTableFilterValue::Text("2025-01-01".into()),
    };
    assert!(
        HealthTableQuery::new(
            HealthTableScope::Diet,
            0,
            50,
            FilterMode::And,
            vec![wrong],
            vec![sort],
            group.clone(),
            None
        )
        .is_err()
    );
    let bad = HealthTableFilter::Diet {
        field: DietTableFilterField::Food,
        operator: HealthFilterOperator::GreaterThan,
        value: HealthTableFilterValue::Text("x".into()),
    };
    assert!(
        HealthTableQuery::new(
            HealthTableScope::Diet,
            0,
            50,
            FilterMode::And,
            vec![bad],
            vec![sort],
            group.clone(),
            None
        )
        .is_err()
    );
    let relative = HealthTableFilter::Diet {
        field: DietTableFilterField::Date,
        operator: HealthFilterOperator::IsRelativeToToday,
        value: HealthTableFilterValue::Relative {
            amount: "1".into(),
            unit: RelativeDateUnit::Day,
        },
    };
    assert!(
        HealthTableQuery::new(
            HealthTableScope::Diet,
            0,
            50,
            FilterMode::And,
            vec![relative.clone()],
            vec![sort],
            group.clone(),
            None
        )
        .is_err()
    );
    assert!(
        HealthTableQuery::new(
            HealthTableScope::Diet,
            0,
            50,
            FilterMode::And,
            vec![relative],
            vec![sort],
            group,
            Some(Date::from_calendar_date(2025, Month::January, 1).unwrap())
        )
        .is_ok()
    );
}

#[test]
fn occurrence_keys_are_derived_from_group_and_logical_identity() {
    let record = HealthTableRecord::Metrics(HealthMetricsTableRecord {
        id: "2025-01-01".into(),
        date: "2025-01-01".into(),
        events: vec![],
        weight: None,
        sleep: None,
        crp: None,
        calprotectin: None,
        condition: None,
        note: String::new(),
        created_at: String::new(),
        updated_at: String::new(),
    });
    let left = HealthTableRow::new(
        Some("2025-01".into()),
        Some("January 2025".into()),
        record.clone(),
    )
    .unwrap();
    let same =
        HealthTableRow::new(Some("2025-01".into()), Some("January 2025".into()), record).unwrap();
    assert_eq!(left.key(), same.key());
    assert_eq!(left.key(), "7:2025-01:2025-01-01");
}

fn test_service() -> (
    tempfile::TempDir,
    HealthService<SqliteHealthRepository, LocalMediaStore>,
) {
    let directory = tempfile::tempdir().unwrap();
    let repository = SqliteHealthRepository::open(directory.path().join("health.sqlite")).unwrap();
    let media = LocalMediaStore::new(directory.path().join("media")).unwrap();
    (directory, HealthService::new(repository, media))
}

#[test]
fn diet_filters_before_multi_tag_expansion_and_applies_group_order() {
    let (_directory, mut service) = test_service();
    for (food, tags) in [
        ("Apple", vec!["alpha", "beta"]),
        ("Banana", vec!["beta"]),
        ("Carrot", vec![]),
    ] {
        service
            .create_diet(CreateDietEntry {
                occurred_at: datetime!(2025-01-01 09:00 +09:00),
                meal_type: MealType::Breakfast,
                food_name: food.into(),
                note: None,
                tags: tags.into_iter().map(str::to_string).collect(),
                media: None,
                actor: "test".into(),
            })
            .unwrap();
    }
    let archived = service
        .create_diet(CreateDietEntry {
            occurred_at: datetime!(2025-01-01 09:00 +09:00),
            meal_type: MealType::Breakfast,
            food_name: "Archived".into(),
            note: None,
            tags: vec!["alpha".into()],
            media: None,
            actor: "test".into(),
        })
        .unwrap();
    service.archive_diet(archived.id().as_str()).unwrap();
    let settings = HealthTableGroupSettings::new(
        HealthTableGroup::Diet(DietTableGroup::Tag),
        GroupSort::Manual,
        false,
        vec!["beta".into(), "alpha".into()],
        vec![],
    )
    .unwrap();
    let filter = HealthTableFilter::Diet {
        field: DietTableFilterField::Tags,
        operator: HealthFilterOperator::Contains,
        value: HealthTableFilterValue::TextList(vec!["alpha".into()]),
    };
    let query = HealthTableQuery::new(
        HealthTableScope::Diet,
        0,
        50,
        FilterMode::And,
        vec![filter],
        vec![HealthTableSort::Diet {
            field: DietTableSortField::Date,
            direction: SortDirection::Desc,
        }],
        settings,
        None,
    )
    .unwrap();
    let page = service.query_table(&query).unwrap();
    assert_eq!(page.items.len(), 2);
    assert_eq!(page.items[0].group_key(), Some("beta"));
    assert_eq!(page.items[1].group_key(), Some("alpha"));
    assert_ne!(page.items[0].key(), page.items[1].key());

    let hidden = HealthTableGroupSettings::new(
        HealthTableGroup::Diet(DietTableGroup::Tag),
        GroupSort::Alphabetical,
        true,
        vec![],
        vec!["beta".into()],
    )
    .unwrap();
    let page = service
        .query_table(
            &HealthTableQuery::new(
                HealthTableScope::Diet,
                0,
                50,
                FilterMode::And,
                vec![],
                vec![
                    HealthTableSort::Diet {
                        field: DietTableSortField::Food,
                        direction: SortDirection::Asc,
                    },
                    HealthTableSort::Diet {
                        field: DietTableSortField::Date,
                        direction: SortDirection::Desc,
                    },
                ],
                hidden,
                None,
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(
        page.items
            .iter()
            .map(|row| row.group_key().unwrap())
            .collect::<Vec<_>>(),
        vec!["alpha", "untagged"]
    );

    let ungrouped = groups(
        HealthTableScope::Diet,
        HealthTableGroup::Diet(DietTableGroup::None),
    );
    let filters = vec![
        HealthTableFilter::Diet {
            field: DietTableFilterField::Food,
            operator: HealthFilterOperator::Is,
            value: HealthTableFilterValue::Text("Apple".into()),
        },
        HealthTableFilter::Diet {
            field: DietTableFilterField::Food,
            operator: HealthFilterOperator::Is,
            value: HealthTableFilterValue::Text("Carrot".into()),
        },
    ];
    let page = service
        .query_table(
            &HealthTableQuery::new(
                HealthTableScope::Diet,
                0,
                50,
                FilterMode::Or,
                filters,
                vec![HealthTableSort::Diet {
                    field: DietTableSortField::Food,
                    direction: SortDirection::Desc,
                }],
                ungrouped,
                None,
            )
            .unwrap(),
        )
        .unwrap();
    let foods = page
        .items
        .iter()
        .map(|row| match row.record() {
            HealthTableRecord::Diet(row) => row.entry.food_name(),
            _ => unreachable!(),
        })
        .collect::<Vec<_>>();
    assert_eq!(foods, vec!["Carrot", "Apple"]);

    let first_seen = groups(
        HealthTableScope::Diet,
        HealthTableGroup::Diet(DietTableGroup::Tag),
    );
    let page = service
        .query_table(
            &HealthTableQuery::new(
                HealthTableScope::Diet,
                0,
                50,
                FilterMode::And,
                vec![],
                vec![HealthTableSort::Diet {
                    field: DietTableSortField::Food,
                    direction: SortDirection::Desc,
                }],
                first_seen,
                None,
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(page.items[0].group_key(), Some("untagged"));
}

#[test]
fn bowel_medication_and_metrics_rows_are_categorized() {
    let (_directory, mut service) = test_service();
    service
        .create_event(CreateHealthEvent {
            occurred_at: datetime!(2025-01-01 23:30 UTC),
            details: HealthEventDetails::Bowel(BowelAttributes::new(4, true).unwrap()),
            note: None,
            actor: "test".into(),
        })
        .unwrap();
    service
        .create_event(CreateHealthEvent {
            occurred_at: datetime!(2025-01-02 01:00 UTC),
            details: HealthEventDetails::Medication(
                MedicationAttributes::new("A", 2.0, MedicationUnit::Tablet).unwrap(),
            ),
            note: None,
            actor: "test".into(),
        })
        .unwrap();
    service
        .upsert_daily_metrics(vec![
            DailyMetricInput {
                occurred_at: datetime!(2025-01-02 00:00 UTC),
                details: HealthEventDetails::Weight(
                    WeightAttributes::body_weight("Body weight", 68.0, "kg").unwrap(),
                ),
                note: None,
                actor: "test".into(),
                expected_updated_at: None,
            },
            DailyMetricInput {
                occurred_at: datetime!(2025-01-02 00:00 UTC),
                details: HealthEventDetails::Lab(
                    LabAttributes::new("crp", "CRP", 0.2, Some("mg/L")).unwrap(),
                ),
                note: None,
                actor: "test".into(),
                expected_updated_at: None,
            },
        ])
        .unwrap();
    let make = |scope, sort, group| {
        HealthTableQuery::new(
            scope,
            0,
            50,
            FilterMode::And,
            vec![],
            vec![sort],
            HealthTableGroupSettings::new(group, GroupSort::Manual, true, vec![], vec![]).unwrap(),
            None,
        )
        .unwrap()
    };
    let bowel = service
        .query_table(&make(
            HealthTableScope::Bowel,
            HealthTableSort::Bowel {
                field: BowelTableSortField::Date,
                direction: SortDirection::Desc,
            },
            HealthTableGroup::Bowel(BowelTableGroup::None),
        ))
        .unwrap();
    assert!(
        matches!(bowel.items[0].record(), HealthTableRecord::Bowel(row) if row.bristol_scale == 4 && row.blood_visible)
    );
    let medication = service
        .query_table(&make(
            HealthTableScope::Medication,
            HealthTableSort::Medication {
                field: MedicationTableSortField::Date,
                direction: SortDirection::Desc,
            },
            HealthTableGroup::Medication(MedicationTableGroup::None),
        ))
        .unwrap();
    assert!(
        matches!(medication.items[0].record(), HealthTableRecord::Medication(row) if row.medication_name == "A" && row.dose == 2.0)
    );
    let metrics = service
        .query_table(&make(
            HealthTableScope::Metrics,
            HealthTableSort::Metrics {
                field: MetricsTableSortField::Date,
                direction: SortDirection::Desc,
            },
            HealthTableGroup::Metrics(MetricsTableGroup::None),
        ))
        .unwrap();
    assert!(
        matches!(metrics.items[0].record(), HealthTableRecord::Metrics(row) if row.weight == Some(68.0) && row.crp == Some(0.2) && row.events.len() == 2)
    );
}

#[test]
fn metrics_pages_logical_local_dates_not_individual_events() {
    let (_directory, mut service) = test_service();
    for day in 0..51 {
        service
            .upsert_daily_metrics(vec![DailyMetricInput {
                occurred_at: datetime!(2025-01-01 00:00 UTC) + Duration::days(day),
                details: HealthEventDetails::Weight(
                    WeightAttributes::body_weight("Body weight", 60.0 + day as f64 / 10.0, "kg")
                        .unwrap(),
                ),
                note: None,
                actor: "test".into(),
                expected_updated_at: None,
            }])
            .unwrap();
    }
    let settings = groups(
        HealthTableScope::Metrics,
        HealthTableGroup::Metrics(MetricsTableGroup::Month),
    );
    let make = |offset| {
        HealthTableQuery::new(
            HealthTableScope::Metrics,
            offset,
            50,
            FilterMode::And,
            vec![],
            vec![HealthTableSort::Metrics {
                field: MetricsTableSortField::Date,
                direction: SortDirection::Desc,
            }],
            settings.clone(),
            None,
        )
        .unwrap()
    };
    let first = service.query_table(&make(0)).unwrap();
    let second = service.query_table(&make(50)).unwrap();
    assert_eq!((first.items.len(), first.next_offset), (50, Some(50)));
    assert_eq!((second.items.len(), second.next_offset), (1, None));
    assert!(first.items.iter().all(
        |row| matches!(row.record(), HealthTableRecord::Metrics(record) if record.events.len() == 1)
    ));
}
