use health_engine::{
    application::{
        commands::{CreateDietEntry, CreateHealthEvent, DailyMetricInput},
        service::HealthService,
        table::*,
    },
    domain::{
        BowelAttributes, HealthEventDetails, LabAttributes, MealType, MedicationAttributes,
        MedicationUnit, SleepAttributes, SleepValue, SymptomAttributes, WeightAttributes,
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
    let wrong_value = HealthTableFilter::Diet {
        field: DietTableFilterField::Date,
        operator: HealthFilterOperator::Is,
        value: HealthTableFilterValue::TextList(vec!["2025-01-01".into()]),
    };
    assert!(
        HealthTableQuery::new(
            HealthTableScope::Diet,
            0,
            50,
            FilterMode::And,
            vec![wrong_value],
            vec![],
            groups(
                HealthTableScope::Diet,
                HealthTableGroup::Diet(DietTableGroup::None)
            ),
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

    let and_filters = vec![
        HealthTableFilter::Diet {
            field: DietTableFilterField::MealType,
            operator: HealthFilterOperator::Is,
            value: HealthTableFilterValue::TextList(vec!["breakfast".into()]),
        },
        HealthTableFilter::Diet {
            field: DietTableFilterField::Food,
            operator: HealthFilterOperator::Contains,
            value: HealthTableFilterValue::Text("nan".into()),
        },
    ];
    let page = service
        .query_table(
            &HealthTableQuery::new(
                HealthTableScope::Diet,
                0,
                50,
                FilterMode::And,
                and_filters,
                vec![],
                groups(
                    HealthTableScope::Diet,
                    HealthTableGroup::Diet(DietTableGroup::None),
                ),
                None,
            )
            .unwrap(),
        )
        .unwrap();
    assert!(
        matches!(page.items.as_slice(), [row] if matches!(row.record(), HealthTableRecord::Diet(record) if record.food == "Banana"))
    );

    let reverse = HealthTableGroupSettings::new(
        HealthTableGroup::Diet(DietTableGroup::Tag),
        GroupSort::ReverseAlphabetical,
        false,
        vec![],
        vec![],
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
                vec![],
                reverse,
                None,
            )
            .unwrap(),
        )
        .unwrap();
    let mut group_keys = Vec::new();
    for row in &page.items {
        if !group_keys.contains(&row.group_key().unwrap()) {
            group_keys.push(row.group_key().unwrap());
        }
    }
    assert_eq!(group_keys, vec!["untagged", "beta", "alpha"]);

    let page = service
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
                groups(
                    HealthTableScope::Diet,
                    HealthTableGroup::Diet(DietTableGroup::None),
                ),
                None,
            )
            .unwrap(),
        )
        .unwrap();
    let ids = page
        .items
        .iter()
        .map(|row| match row.record() {
            HealthTableRecord::Diet(record) => record.entry.id().as_str(),
            _ => unreachable!(),
        })
        .collect::<Vec<_>>();
    let mut sorted_ids = ids.clone();
    sorted_ids.sort_unstable();
    assert_eq!(ids, sorted_ids);

    let first_seen = HealthTableGroupSettings::new(
        HealthTableGroup::Diet(DietTableGroup::Tag),
        GroupSort::Manual,
        false,
        vec![],
        vec![],
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
                occurred_at: datetime!(2025-01-01 16:00 UTC),
                details: HealthEventDetails::Weight(
                    WeightAttributes::body_weight("Body weight", 68.0, "kg").unwrap(),
                ),
                note: None,
                actor: "test".into(),
                expected_updated_at: None,
            },
            DailyMetricInput {
                occurred_at: datetime!(2025-01-01 16:00 UTC),
                details: HealthEventDetails::Lab(
                    LabAttributes::new("crp", "CRP", 0.2, Some("mg/L")).unwrap(),
                ),
                note: None,
                actor: "test".into(),
                expected_updated_at: None,
            },
            DailyMetricInput {
                occurred_at: datetime!(2025-01-01 16:00 UTC),
                details: HealthEventDetails::Sleep(
                    SleepAttributes::sleep_duration("Sleep", SleepValue::hours(7.5).unwrap())
                        .unwrap(),
                ),
                note: None,
                actor: "test".into(),
                expected_updated_at: None,
            },
            DailyMetricInput {
                occurred_at: datetime!(2025-01-01 16:00 UTC),
                details: HealthEventDetails::Lab(
                    LabAttributes::new(
                        "fecal_calprotectin",
                        "Fecal calprotectin",
                        42.0,
                        Some("µg/g"),
                    )
                    .unwrap(),
                ),
                note: None,
                actor: "test".into(),
                expected_updated_at: None,
            },
            DailyMetricInput {
                occurred_at: datetime!(2025-01-01 16:00 UTC),
                details: HealthEventDetails::Symptom(
                    SymptomAttributes::overall_condition("Overall condition", 8, Some("good"))
                        .unwrap(),
                ),
                note: None,
                actor: "test".into(),
                expected_updated_at: None,
            },
        ])
        .unwrap();
    service
        .create_event(CreateHealthEvent {
            occurred_at: datetime!(2025-01-01 17:00 UTC),
            details: HealthEventDetails::Weight(
                WeightAttributes::body_weight("Body weight", 99.0, "kg").unwrap(),
            ),
            note: None,
            actor: "test".into(),
        })
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
        matches!(metrics.items[0].record(), HealthTableRecord::Metrics(row) if row.date == "2025-01-02" && row.weight == Some(68.0) && row.sleep == Some(7.5) && row.crp == Some(0.2) && row.calprotectin == Some(42.0) && row.condition == Some(8.0) && row.events.len() == 5)
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

#[test]
fn empty_sorts_use_scope_defaults_and_scope_mismatches_are_rejected() {
    for (scope, group) in [
        (
            HealthTableScope::Diet,
            HealthTableGroup::Diet(DietTableGroup::None),
        ),
        (
            HealthTableScope::Bowel,
            HealthTableGroup::Bowel(BowelTableGroup::None),
        ),
        (
            HealthTableScope::Medication,
            HealthTableGroup::Medication(MedicationTableGroup::None),
        ),
        (
            HealthTableScope::Metrics,
            HealthTableGroup::Metrics(MetricsTableGroup::None),
        ),
    ] {
        assert!(
            HealthTableQuery::new(
                scope,
                0,
                50,
                FilterMode::And,
                vec![],
                vec![],
                groups(scope, group),
                None
            )
            .is_ok()
        );
    }
    assert!(
        HealthTableQuery::new(
            HealthTableScope::Diet,
            0,
            50,
            FilterMode::And,
            vec![],
            vec![HealthTableSort::Bowel {
                field: BowelTableSortField::Date,
                direction: SortDirection::Desc
            }],
            groups(
                HealthTableScope::Diet,
                HealthTableGroup::Diet(DietTableGroup::None)
            ),
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
            vec![],
            vec![],
            groups(
                HealthTableScope::Diet,
                HealthTableGroup::Bowel(BowelTableGroup::None)
            ),
            None
        )
        .is_err()
    );
}

#[test]
fn empty_sort_defaults_are_date_desc_for_all_four_scopes() {
    let (_directory, mut service) = test_service();
    for day in 0..2 {
        let at = datetime!(2025-01-01 00:00 UTC) + Duration::days(day);
        service
            .create_diet(CreateDietEntry {
                occurred_at: at,
                meal_type: MealType::Breakfast,
                food_name: format!("D{day}"),
                note: None,
                tags: vec![],
                media: None,
                actor: "test".into(),
            })
            .unwrap();
        service
            .create_event(CreateHealthEvent {
                occurred_at: at,
                details: HealthEventDetails::Bowel(BowelAttributes::new(4, false).unwrap()),
                note: None,
                actor: "test".into(),
            })
            .unwrap();
        service
            .create_event(CreateHealthEvent {
                occurred_at: at,
                details: HealthEventDetails::Medication(
                    MedicationAttributes::new(format!("M{day}"), 1.0, MedicationUnit::Mg).unwrap(),
                ),
                note: None,
                actor: "test".into(),
            })
            .unwrap();
        service
            .upsert_daily_metrics(vec![DailyMetricInput {
                occurred_at: at,
                details: HealthEventDetails::Weight(
                    WeightAttributes::body_weight("Body weight", 60.0 + day as f64, "kg").unwrap(),
                ),
                note: None,
                actor: "test".into(),
                expected_updated_at: None,
            }])
            .unwrap();
    }
    let query = |scope, group| {
        HealthTableQuery::new(
            scope,
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            groups(scope, group),
            None,
        )
        .unwrap()
    };
    let diet = service
        .query_table(&query(
            HealthTableScope::Diet,
            HealthTableGroup::Diet(DietTableGroup::None),
        ))
        .unwrap();
    assert!(
        matches!((&diet.items[0].record(), &diet.items[1].record()), (HealthTableRecord::Diet(a), HealthTableRecord::Diet(b)) if a.entry.occurred_at() > b.entry.occurred_at())
    );
    let bowel = service
        .query_table(&query(
            HealthTableScope::Bowel,
            HealthTableGroup::Bowel(BowelTableGroup::None),
        ))
        .unwrap();
    assert!(
        matches!((&bowel.items[0].record(), &bowel.items[1].record()), (HealthTableRecord::Bowel(a), HealthTableRecord::Bowel(b)) if a.event.occurred_at() > b.event.occurred_at())
    );
    let medication = service
        .query_table(&query(
            HealthTableScope::Medication,
            HealthTableGroup::Medication(MedicationTableGroup::None),
        ))
        .unwrap();
    assert!(
        matches!((&medication.items[0].record(), &medication.items[1].record()), (HealthTableRecord::Medication(a), HealthTableRecord::Medication(b)) if a.event.occurred_at() > b.event.occurred_at())
    );
    let metrics = service
        .query_table(&query(
            HealthTableScope::Metrics,
            HealthTableGroup::Metrics(MetricsTableGroup::None),
        ))
        .unwrap();
    assert!(
        matches!((&metrics.items[0].record(), &metrics.items[1].record()), (HealthTableRecord::Metrics(a), HealthTableRecord::Metrics(b)) if a.date > b.date)
    );
}

#[test]
fn metrics_numeric_filters_include_null_for_is_not_and_sort_null_last() {
    let (_directory, mut service) = test_service();
    service
        .upsert_daily_metrics(vec![DailyMetricInput {
            occurred_at: datetime!(2025-01-01 00:00 UTC),
            details: HealthEventDetails::Lab(
                LabAttributes::new("crp", "CRP", 1.0, Some("mg/L")).unwrap(),
            ),
            note: None,
            actor: "test".into(),
            expected_updated_at: None,
        }])
        .unwrap();
    for (day, weight) in [(2, 10.0), (3, 20.0)] {
        service
            .upsert_daily_metrics(vec![DailyMetricInput {
                occurred_at: datetime!(2025-01-01 00:00 UTC) + Duration::days(day - 1),
                details: HealthEventDetails::Weight(
                    WeightAttributes::body_weight("Body weight", weight, "kg").unwrap(),
                ),
                note: None,
                actor: "test".into(),
                expected_updated_at: None,
            }])
            .unwrap();
    }
    let setting = groups(
        HealthTableScope::Metrics,
        HealthTableGroup::Metrics(MetricsTableGroup::None),
    );
    let numeric = |operator: HealthFilterOperator, value: &str| HealthTableFilter::Metrics {
        field: MetricsTableFilterField::Weight,
        operator,
        value: HealthTableFilterValue::Text(value.into()),
    };
    let page = service
        .query_table(
            &HealthTableQuery::new(
                HealthTableScope::Metrics,
                0,
                50,
                FilterMode::And,
                vec![numeric(HealthFilterOperator::IsNot, "10")],
                vec![HealthTableSort::Metrics {
                    field: MetricsTableSortField::Weight,
                    direction: SortDirection::Asc,
                }],
                setting.clone(),
                None,
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(page.items.len(), 2);
    assert!(
        matches!(page.items.last().unwrap().record(), HealthTableRecord::Metrics(row) if row.weight.is_none())
    );
    let greater = service
        .query_table(
            &HealthTableQuery::new(
                HealthTableScope::Metrics,
                0,
                50,
                FilterMode::And,
                vec![numeric(HealthFilterOperator::GreaterThan, "9")],
                vec![HealthTableSort::Metrics {
                    field: MetricsTableSortField::Weight,
                    direction: SortDirection::Asc,
                }],
                setting.clone(),
                None,
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(greater.items.len(), 2);
    for direction in [SortDirection::Asc, SortDirection::Desc] {
        let page = service
            .query_table(
                &HealthTableQuery::new(
                    HealthTableScope::Metrics,
                    0,
                    50,
                    FilterMode::And,
                    vec![],
                    vec![HealthTableSort::Metrics {
                        field: MetricsTableSortField::Weight,
                        direction,
                    }],
                    setting.clone(),
                    None,
                )
                .unwrap(),
            )
            .unwrap();
        assert!(
            matches!(page.items.last().unwrap().record(), HealthTableRecord::Metrics(row) if row.weight.is_none())
        );
    }
}

#[test]
fn medication_group_labels_and_partial_manual_order_match_ui() {
    let (_directory, mut service) = test_service();
    for (index, unit) in [
        MedicationUnit::Tablet,
        MedicationUnit::Capsule,
        MedicationUnit::Packet,
        MedicationUnit::Mg,
        MedicationUnit::G,
        MedicationUnit::Ml,
        MedicationUnit::Drop,
        MedicationUnit::Dose,
    ]
    .into_iter()
    .enumerate()
    {
        service
            .create_event(CreateHealthEvent {
                occurred_at: datetime!(2025-01-01 00:00 UTC) + Duration::hours(index as i64),
                details: HealthEventDetails::Medication(
                    MedicationAttributes::new(format!("M{index}"), 1.0, unit).unwrap(),
                ),
                note: None,
                actor: "test".into(),
            })
            .unwrap();
    }
    let settings = HealthTableGroupSettings::new(
        HealthTableGroup::Medication(MedicationTableGroup::MedicationUnit),
        GroupSort::Alphabetical,
        true,
        vec![],
        vec![],
    )
    .unwrap();
    let page = service
        .query_table(
            &HealthTableQuery::new(
                HealthTableScope::Medication,
                0,
                50,
                FilterMode::And,
                vec![],
                vec![],
                settings,
                None,
            )
            .unwrap(),
        )
        .unwrap();
    let labels = [
        ("tablet", "정"),
        ("capsule", "캡슐"),
        ("packet", "포"),
        ("mg", "mg"),
        ("g", "g"),
        ("ml", "ml"),
        ("drop", "방울"),
        ("dose", "회"),
    ];
    for (key, label) in labels {
        assert!(
            page.items
                .iter()
                .any(|row| row.group_key() == Some(key) && row.group_label() == Some(label))
        );
    }

    let mut service = service;
    for (food, tag, hour) in [
        ("Gamma", "gamma", 3),
        ("Alpha", "alpha", 2),
        ("Beta", "beta", 1),
    ] {
        service
            .create_diet(CreateDietEntry {
                occurred_at: datetime!(2025-01-01 00:00 UTC) + Duration::hours(hour),
                meal_type: MealType::Breakfast,
                food_name: food.into(),
                note: None,
                tags: vec![tag.into()],
                media: None,
                actor: "test".into(),
            })
            .unwrap();
    }
    let partial = HealthTableGroupSettings::new(
        HealthTableGroup::Diet(DietTableGroup::Tag),
        GroupSort::Manual,
        true,
        vec!["alpha".into()],
        vec![],
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
                vec![],
                partial,
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
        vec!["alpha", "gamma", "beta"]
    );
}

#[test]
fn literal_untagged_and_synthetic_untagged_have_distinct_stable_occurrences() {
    let (_directory, mut service) = test_service();
    for (food, tags) in [
        ("Literal", vec!["untagged"]),
        ("Escaped", vec!["\\untagged"]),
        ("Missing", vec![]),
    ] {
        service
            .create_diet(CreateDietEntry {
                occurred_at: datetime!(2025-01-01 00:00 UTC),
                meal_type: MealType::Breakfast,
                food_name: food.into(),
                note: None,
                tags: tags.into_iter().map(str::to_string).collect(),
                media: None,
                actor: "test".into(),
            })
            .unwrap();
    }
    let settings = |hidden| {
        HealthTableGroupSettings::new(
            HealthTableGroup::Diet(DietTableGroup::Tag),
            GroupSort::Alphabetical,
            false,
            vec![],
            hidden,
        )
        .unwrap()
    };
    let query = |offset, limit, hidden| {
        HealthTableQuery::new(
            HealthTableScope::Diet,
            offset,
            limit,
            FilterMode::And,
            vec![],
            vec![HealthTableSort::Diet {
                field: DietTableSortField::Food,
                direction: SortDirection::Asc,
            }],
            settings(hidden),
            None,
        )
        .unwrap()
    };
    let page = service.query_table(&query(0, 50, vec![])).unwrap();
    let by_food = page
        .items
        .iter()
        .map(|row| match row.record() {
            HealthTableRecord::Diet(record) => {
                (record.food.as_str(), row.group_key().unwrap(), row.key())
            }
            _ => unreachable!(),
        })
        .collect::<Vec<_>>();
    assert_eq!(
        by_food.iter().find(|row| row.0 == "Missing").unwrap().1,
        "untagged"
    );
    assert_eq!(
        by_food.iter().find(|row| row.0 == "Literal").unwrap().1,
        "\\untagged"
    );
    assert_eq!(
        by_food.iter().find(|row| row.0 == "Escaped").unwrap().1,
        "\\\\untagged"
    );
    let keys = by_food
        .iter()
        .map(|row| row.2)
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(keys.len(), 3);
    assert_eq!(
        service
            .query_table(&query(0, 50, vec!["untagged".into()]))
            .unwrap()
            .items
            .len(),
        2
    );
    assert_eq!(
        service
            .query_table(&query(0, 50, vec!["\\untagged".into()]))
            .unwrap()
            .items
            .len(),
        2
    );
    let first = service.query_table(&query(0, 1, vec![])).unwrap();
    let second = service.query_table(&query(1, 1, vec![])).unwrap();
    let third = service.query_table(&query(2, 1, vec![])).unwrap();
    assert_eq!(first.next_offset, Some(1));
    assert_eq!(second.next_offset, Some(2));
    assert_eq!(third.next_offset, None);
    assert_ne!(first.items[0].key(), second.items[0].key());
    assert_ne!(second.items[0].key(), third.items[0].key());
}

#[test]
fn tag_filters_compare_normalized_rows_without_separator_collisions() {
    let (_directory, mut service) = test_service();
    for (food, tags) in [("Split", vec!["a", "b"]), ("Literal", vec!["a\u{1f}b"])] {
        service
            .create_diet(CreateDietEntry {
                occurred_at: datetime!(2025-01-01 00:00 UTC),
                meal_type: MealType::Breakfast,
                food_name: food.into(),
                note: None,
                tags: tags.into_iter().map(str::to_string).collect(),
                media: None,
                actor: "test".into(),
            })
            .unwrap();
    }
    let filter = HealthTableFilter::Diet {
        field: DietTableFilterField::Tags,
        operator: HealthFilterOperator::Contains,
        value: HealthTableFilterValue::TextList(vec!["a\u{1f}b".into()]),
    };
    let page = service
        .query_table(
            &HealthTableQuery::new(
                HealthTableScope::Diet,
                0,
                50,
                FilterMode::And,
                vec![filter],
                vec![],
                groups(
                    HealthTableScope::Diet,
                    HealthTableGroup::Diet(DietTableGroup::None),
                ),
                None,
            )
            .unwrap(),
        )
        .unwrap();
    assert!(
        matches!(page.items.as_slice(), [row] if matches!(row.record(), HealthTableRecord::Diet(record) if record.food == "Literal"))
    );
}

#[test]
fn occurrence_key_is_unambiguous_for_delimiters_and_rejects_empty_groups() {
    let record = |id: &str| {
        HealthTableRecord::Metrics(HealthMetricsTableRecord {
            id: id.into(),
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
        })
    };
    let left = HealthTableRow::new(Some("a".into()), Some("a".into()), record("b:c")).unwrap();
    let right = HealthTableRow::new(Some("a:b".into()), Some("a:b".into()), record("c")).unwrap();
    assert_ne!(left.key(), right.key());
    assert!(HealthTableRow::new(Some(String::new()), Some(String::new()), record("id")).is_err());
}
