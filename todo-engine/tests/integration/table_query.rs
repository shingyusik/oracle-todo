use time::{Date, Month, OffsetDateTime};
use todo_engine::application::error::TodoError;
use todo_engine::application::table::{
    FilterMode, GroupSort, PlannerFilterField, PlannerSortField, PlannerTableGroup,
    PlannerTableScope, RelativeDateUnit, SortDirection, TableContext, TablePage,
    TodoFilterOperator, TodoTableFilter, TodoTableFilterValue, TodoTableGroup,
    TodoTableGroupSettings, TodoTableQuery, TodoTableRecord, TodoTableRow, TodoTableScope,
    TodoTableSort, WorkspaceFilterField, WorkspaceSortField, WorkspaceTableGroup,
    WorkspaceTableScope, canonical_group_value, missing_group,
};
use todo_engine::domain::{Actor, ItemType, TodoItem};

fn date(year: i32, month: Month, day: u8) -> Date {
    Date::from_calendar_date(year, month, day).unwrap()
}

fn groups(group_by: TodoTableGroup) -> TodoTableGroupSettings {
    TodoTableGroupSettings::new(group_by, GroupSort::Manual, true, vec![], vec![]).unwrap()
}

fn workspace_query(scope: WorkspaceTableScope) -> Result<TodoTableQuery, TodoError> {
    TodoTableQuery::new(
        TodoTableScope::Workspace(scope),
        TableContext::Workspace,
        0,
        50,
        FilterMode::And,
        vec![],
        vec![],
        groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
        None,
    )
}

#[test]
fn accepts_all_workspace_and_planner_scopes_with_matching_contexts() {
    for scope in [
        WorkspaceTableScope::Area,
        WorkspaceTableScope::Project,
        WorkspaceTableScope::Goal,
        WorkspaceTableScope::Routine,
        WorkspaceTableScope::Task,
        WorkspaceTableScope::Event,
    ] {
        assert!(workspace_query(scope).is_ok(), "{scope:?}");
    }

    for scope in [
        PlannerTableScope::YearlyPeriodGoals,
        PlannerTableScope::YearlyMonthGoals,
        PlannerTableScope::MonthlyPeriodGoals,
        PlannerTableScope::MonthlyCalendar,
        PlannerTableScope::MonthlyWeekGoals,
        PlannerTableScope::WeeklyMonthGoals,
        PlannerTableScope::WeeklyWeekGoals,
        PlannerTableScope::WeeklyDayGrid,
        PlannerTableScope::DailyToday,
        PlannerTableScope::DailyOverdue,
        PlannerTableScope::DailyUnscheduled,
    ] {
        assert!(
            TodoTableQuery::new(
                TodoTableScope::Planner(scope),
                TableContext::Planner {
                    from: date(2026, Month::August, 1),
                    to: date(2026, Month::August, 31),
                },
                0,
                50,
                FilterMode::Or,
                vec![],
                vec![],
                groups(TodoTableGroup::Planner(PlannerTableGroup::None)),
                None,
            )
            .is_ok(),
            "{scope:?}"
        );
    }
}

#[test]
fn validates_context_and_every_real_link_relationship() {
    let links = [
        (ItemType::Area, ItemType::Project),
        (ItemType::Area, ItemType::Routine),
        (ItemType::Area, ItemType::Task),
        (ItemType::Area, ItemType::Event),
        (ItemType::Project, ItemType::Routine),
        (ItemType::Project, ItemType::Task),
        (ItemType::Project, ItemType::Event),
        (ItemType::Routine, ItemType::Task),
        (ItemType::Goal, ItemType::Goal),
        (ItemType::Goal, ItemType::Task),
    ];
    for (parent, child) in links {
        let child_scope = WorkspaceTableScope::try_from(child).unwrap();
        assert!(
            TodoTableQuery::new(
                TodoTableScope::Linked { parent, child },
                TableContext::Linked {
                    parent_type: parent,
                    parent_id: "parent-1".into()
                },
                0,
                50,
                FilterMode::And,
                vec![],
                vec![],
                groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
                None,
            )
            .is_ok(),
            "{parent:?}->{child:?}"
        );
        assert!(workspace_query(child_scope).is_ok());
    }

    assert!(
        TodoTableQuery::new(
            TodoTableScope::Linked {
                parent: ItemType::Area,
                child: ItemType::Task
            },
            TableContext::Workspace,
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .is_err()
    );
    assert!(
        TodoTableQuery::new(
            TodoTableScope::Linked {
                parent: ItemType::Area,
                child: ItemType::Task
            },
            TableContext::Linked {
                parent_type: ItemType::Project,
                parent_id: "parent-1".into()
            },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .is_err()
    );
    assert!(
        TodoTableQuery::new(
            TodoTableScope::Linked {
                parent: ItemType::Task,
                child: ItemType::Event
            },
            TableContext::Linked {
                parent_type: ItemType::Task,
                parent_id: "parent-1".into()
            },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .is_err()
    );
    assert!(
        TodoTableQuery::new(
            TodoTableScope::Planner(PlannerTableScope::DailyToday),
            TableContext::Planner {
                from: date(2026, Month::August, 2),
                to: date(2026, Month::August, 1)
            },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            groups(TodoTableGroup::Planner(PlannerTableGroup::None)),
            None,
        )
        .is_err()
    );
    assert!(
        TodoTableQuery::new(
            TodoTableScope::Workspace(WorkspaceTableScope::Task),
            TableContext::Planner {
                from: date(2026, Month::August, 1),
                to: date(2026, Month::August, 1)
            },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .is_err()
    );
}

#[test]
fn validates_limits_scope_allowlists_and_empty_sorts() {
    assert!(workspace_query(WorkspaceTableScope::Task).is_ok());
    for limit in [0, 51] {
        let result = TodoTableQuery::new(
            TodoTableScope::Workspace(WorkspaceTableScope::Task),
            TableContext::Workspace,
            0,
            limit,
            FilterMode::And,
            vec![],
            vec![],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        );
        assert!(result.is_err());
    }

    let area_due = TodoTableFilter::Workspace {
        field: WorkspaceFilterField::Due,
        operator: TodoFilterOperator::Is,
        value: TodoTableFilterValue::Text("2026-08-21".into()),
    };
    assert!(
        TodoTableQuery::new(
            TodoTableScope::Workspace(WorkspaceTableScope::Area),
            TableContext::Workspace,
            0,
            50,
            FilterMode::And,
            vec![area_due],
            vec![],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .is_err()
    );

    let bad_sort = todo_engine::application::table::TodoTableSort::Workspace {
        field: WorkspaceSortField::Routine,
        direction: SortDirection::Asc,
    };
    assert!(
        TodoTableQuery::new(
            TodoTableScope::Workspace(WorkspaceTableScope::Event),
            TableContext::Workspace,
            0,
            50,
            FilterMode::And,
            vec![],
            vec![bad_sort],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .is_err()
    );
}

#[test]
fn mirrors_every_workspace_filter_sort_and_group_allowlist() {
    use WorkspaceFilterField as F;
    use WorkspaceSortField as S;
    use WorkspaceTableGroup as G;
    type Case<'a> = (WorkspaceTableScope, &'a [F], &'a [S], &'a [G]);
    let cases: &[Case<'_>] = &[
        (
            WorkspaceTableScope::Area,
            &[F::Title, F::Status, F::Tags, F::Note],
            &[S::Title, S::Status, S::Tags, S::Note, S::Updated],
            &[G::None, G::Tag, G::Status],
        ),
        (
            WorkspaceTableScope::Project,
            &[F::Title, F::Status, F::Tags, F::Area, F::Due, F::Note],
            &[
                S::Title,
                S::Status,
                S::Tags,
                S::Area,
                S::Due,
                S::Note,
                S::Updated,
            ],
            &[G::None, G::Area, G::Tag, G::Status],
        ),
        (
            WorkspaceTableScope::Goal,
            &[
                F::Title,
                F::Status,
                F::Tags,
                F::Horizon,
                F::Scheduled,
                F::Parent,
                F::Note,
            ],
            &[
                S::Title,
                S::Status,
                S::Tags,
                S::Horizon,
                S::Scheduled,
                S::Parent,
                S::Note,
                S::Updated,
            ],
            &[G::None, G::Tag, G::Status],
        ),
        (
            WorkspaceTableScope::Routine,
            &[
                F::Title,
                F::Status,
                F::Tags,
                F::Area,
                F::Project,
                F::RecurrenceRule,
                F::MaterializationPolicy,
                F::Priority,
                F::Description,
                F::Note,
            ],
            &[
                S::Title,
                S::Status,
                S::Tags,
                S::Area,
                S::Project,
                S::RecurrenceRule,
                S::MaterializationPolicy,
                S::Priority,
                S::Description,
                S::Note,
                S::Updated,
            ],
            &[G::None, G::Area, G::Project, G::Tag, G::Status],
        ),
        (
            WorkspaceTableScope::Task,
            &[
                F::Title,
                F::Status,
                F::Tags,
                F::Area,
                F::Project,
                F::Routine,
                F::Scheduled,
                F::Due,
                F::Priority,
                F::Description,
                F::Note,
            ],
            &[
                S::Title,
                S::Status,
                S::Tags,
                S::Area,
                S::Project,
                S::Routine,
                S::Scheduled,
                S::Due,
                S::Priority,
                S::Description,
                S::Note,
                S::Updated,
            ],
            &[G::None, G::Area, G::Project, G::Routine, G::Tag, G::Status],
        ),
        (
            WorkspaceTableScope::Event,
            &[
                F::Title,
                F::Status,
                F::Tags,
                F::Area,
                F::Project,
                F::Scheduled,
                F::Due,
                F::Priority,
                F::Location,
                F::Participants,
                F::CommitmentType,
                F::Description,
                F::Note,
            ],
            &[
                S::Title,
                S::Status,
                S::Tags,
                S::Area,
                S::Project,
                S::Scheduled,
                S::Due,
                S::Priority,
                S::Location,
                S::Participants,
                S::CommitmentType,
                S::Description,
                S::Note,
                S::Updated,
            ],
            &[G::None, G::Area, G::Project, G::Tag, G::Status],
        ),
    ];

    for (scope, fields, sorts, group_fields) in cases {
        for field in *fields {
            assert!(
                TodoTableQuery::new(
                    TodoTableScope::Workspace(*scope),
                    TableContext::Workspace,
                    0,
                    50,
                    FilterMode::And,
                    vec![TodoTableFilter::Workspace {
                        field: *field,
                        operator: TodoFilterOperator::IsEmpty,
                        value: TodoTableFilterValue::Empty
                    }],
                    vec![],
                    groups_for_workspace(G::None),
                    None,
                )
                .is_ok(),
                "filter {scope:?}.{field:?}"
            );
        }
        for field in *sorts {
            assert!(
                TodoTableQuery::new(
                    TodoTableScope::Workspace(*scope),
                    TableContext::Workspace,
                    0,
                    50,
                    FilterMode::And,
                    vec![],
                    vec![TodoTableSort::Workspace {
                        field: *field,
                        direction: SortDirection::Asc
                    }],
                    groups_for_workspace(G::None),
                    None,
                )
                .is_ok(),
                "sort {scope:?}.{field:?}"
            );
        }
        for field in *group_fields {
            assert!(
                TodoTableQuery::new(
                    TodoTableScope::Workspace(*scope),
                    TableContext::Workspace,
                    0,
                    50,
                    FilterMode::And,
                    vec![],
                    vec![],
                    groups_for_workspace(*field),
                    None,
                )
                .is_ok(),
                "group {scope:?}.{field:?}"
            );
        }
    }
}

fn groups_for_workspace(field: WorkspaceTableGroup) -> TodoTableGroupSettings {
    groups(TodoTableGroup::Workspace(field))
}

#[test]
fn mirrors_every_planner_goal_and_work_allowlist() {
    use PlannerFilterField as F;
    use PlannerSortField as S;
    use PlannerTableGroup as G;
    type Case<'a> = (PlannerTableScope, &'a [F], &'a [S], &'a [G]);
    let goal_fields = [
        F::Title,
        F::Status,
        F::Tags,
        F::Horizon,
        F::Scheduled,
        F::Due,
        F::Parent,
        F::Note,
    ];
    let goal_sorts = [
        S::Title,
        S::Status,
        S::Tags,
        S::Horizon,
        S::Scheduled,
        S::Due,
        S::Parent,
        S::Note,
        S::Updated,
    ];
    let work_fields = [
        F::Title,
        F::Status,
        F::Tags,
        F::Area,
        F::Project,
        F::Routine,
        F::Scheduled,
        F::Due,
        F::Priority,
        F::RecurrenceRule,
        F::MaterializationPolicy,
        F::Location,
        F::Participants,
        F::CommitmentType,
        F::Description,
        F::Note,
    ];
    let work_sorts = [
        S::Title,
        S::Status,
        S::Tags,
        S::Area,
        S::Project,
        S::Routine,
        S::Scheduled,
        S::Due,
        S::Priority,
        S::RecurrenceRule,
        S::MaterializationPolicy,
        S::Location,
        S::Participants,
        S::CommitmentType,
        S::Description,
        S::Note,
        S::Updated,
    ];
    let cases: &[Case<'_>] = &[
        (
            PlannerTableScope::YearlyPeriodGoals,
            &goal_fields,
            &goal_sorts,
            &[G::None, G::Tag, G::Status],
        ),
        (
            PlannerTableScope::YearlyMonthGoals,
            &goal_fields,
            &goal_sorts,
            &[G::None, G::Tag, G::Status],
        ),
        (
            PlannerTableScope::MonthlyPeriodGoals,
            &goal_fields,
            &goal_sorts,
            &[G::None, G::Tag, G::Status],
        ),
        (
            PlannerTableScope::MonthlyWeekGoals,
            &goal_fields,
            &goal_sorts,
            &[G::None, G::Tag, G::Status],
        ),
        (
            PlannerTableScope::WeeklyMonthGoals,
            &goal_fields,
            &goal_sorts,
            &[G::None, G::Tag, G::Status],
        ),
        (
            PlannerTableScope::WeeklyWeekGoals,
            &goal_fields,
            &goal_sorts,
            &[G::None, G::Tag, G::Status],
        ),
        (
            PlannerTableScope::MonthlyCalendar,
            &work_fields,
            &work_sorts,
            &[
                G::None,
                G::Area,
                G::Project,
                G::Routine,
                G::Tag,
                G::ItemType,
                G::Status,
            ],
        ),
        (
            PlannerTableScope::WeeklyDayGrid,
            &work_fields,
            &work_sorts,
            &[
                G::None,
                G::Area,
                G::Project,
                G::Routine,
                G::Tag,
                G::ItemType,
                G::Status,
            ],
        ),
        (
            PlannerTableScope::DailyToday,
            &work_fields,
            &work_sorts,
            &[
                G::None,
                G::Area,
                G::Project,
                G::Routine,
                G::Tag,
                G::ItemType,
                G::Status,
            ],
        ),
        (
            PlannerTableScope::DailyOverdue,
            &work_fields,
            &work_sorts,
            &[
                G::None,
                G::Area,
                G::Project,
                G::Routine,
                G::Tag,
                G::ItemType,
                G::Status,
            ],
        ),
        (
            PlannerTableScope::DailyUnscheduled,
            &work_fields,
            &work_sorts,
            &[
                G::None,
                G::Area,
                G::Project,
                G::Routine,
                G::Tag,
                G::ItemType,
                G::Status,
            ],
        ),
    ];
    let context = TableContext::Planner {
        from: date(2026, Month::August, 1),
        to: date(2026, Month::August, 31),
    };
    for (scope, fields, sorts, group_fields) in cases {
        for field in *fields {
            assert!(
                TodoTableQuery::new(
                    TodoTableScope::Planner(*scope),
                    context.clone(),
                    0,
                    50,
                    FilterMode::And,
                    vec![TodoTableFilter::Planner {
                        field: *field,
                        operator: TodoFilterOperator::IsEmpty,
                        value: TodoTableFilterValue::Empty
                    }],
                    vec![],
                    groups(TodoTableGroup::Planner(G::None)),
                    None,
                )
                .is_ok(),
                "filter {scope:?}.{field:?}"
            );
        }
        for field in *sorts {
            assert!(
                TodoTableQuery::new(
                    TodoTableScope::Planner(*scope),
                    context.clone(),
                    0,
                    50,
                    FilterMode::And,
                    vec![],
                    vec![TodoTableSort::Planner {
                        field: *field,
                        direction: SortDirection::Desc
                    }],
                    groups(TodoTableGroup::Planner(G::None)),
                    None,
                )
                .is_ok(),
                "sort {scope:?}.{field:?}"
            );
        }
        for field in *group_fields {
            assert!(
                TodoTableQuery::new(
                    TodoTableScope::Planner(*scope),
                    context.clone(),
                    0,
                    50,
                    FilterMode::And,
                    vec![],
                    vec![],
                    groups(TodoTableGroup::Planner(*field)),
                    None,
                )
                .is_ok(),
                "group {scope:?}.{field:?}"
            );
        }
    }
}

#[test]
fn validates_operator_values_and_requires_explicit_relative_reference_date() {
    let invalid = TodoTableFilter::Planner {
        field: PlannerFilterField::Scheduled,
        operator: TodoFilterOperator::Contains,
        value: TodoTableFilterValue::Text("2026".into()),
    };
    let relative = TodoTableFilter::Planner {
        field: PlannerFilterField::Scheduled,
        operator: TodoFilterOperator::IsRelativeToToday,
        value: TodoTableFilterValue::Relative {
            amount: "1".into(),
            unit: RelativeDateUnit::Day,
        },
    };
    let scope = TodoTableScope::Planner(PlannerTableScope::DailyToday);
    let context = TableContext::Planner {
        from: date(2026, Month::August, 21),
        to: date(2026, Month::August, 21),
    };
    assert!(
        TodoTableQuery::new(
            scope,
            context.clone(),
            0,
            50,
            FilterMode::And,
            vec![invalid],
            vec![],
            groups(TodoTableGroup::Planner(PlannerTableGroup::None)),
            None,
        )
        .is_err()
    );
    assert!(
        TodoTableQuery::new(
            scope,
            context.clone(),
            0,
            50,
            FilterMode::And,
            vec![relative.clone()],
            vec![],
            groups(TodoTableGroup::Planner(PlannerTableGroup::None)),
            None,
        )
        .is_err()
    );
    assert!(
        TodoTableQuery::new(
            scope,
            context,
            0,
            50,
            FilterMode::Or,
            vec![relative],
            vec![todo_engine::application::table::TodoTableSort::Planner {
                field: PlannerSortField::Updated,
                direction: SortDirection::Desc,
            }],
            groups(TodoTableGroup::Planner(PlannerTableGroup::Status)),
            Some(date(2026, Month::August, 21)),
        )
        .is_ok()
    );
}

#[test]
fn bounds_and_deduplicates_rules_lists_and_group_settings() {
    let settings = TodoTableGroupSettings::new(
        TodoTableGroup::Workspace(WorkspaceTableGroup::Tag),
        GroupSort::Manual,
        false,
        vec!["alpha".into(), "alpha".into(), "beta".into()],
        vec!["hidden".into(), "hidden".into()],
    )
    .unwrap();
    assert_eq!(settings.manual_order(), &["alpha", "beta"]);
    assert_eq!(settings.hidden_group_keys(), &["hidden"]);
    assert!(!settings.hide_empty());
    assert!(
        TodoTableGroupSettings::new(
            TodoTableGroup::Workspace(WorkspaceTableGroup::Tag),
            GroupSort::Manual,
            true,
            vec!["x".repeat(257)],
            vec![],
        )
        .is_err()
    );

    let tags = TodoTableFilter::Workspace {
        field: WorkspaceFilterField::Tags,
        operator: TodoFilterOperator::Contains,
        value: TodoTableFilterValue::TextList(vec!["one".into(), "one".into(), "two".into()]),
    };
    let query = TodoTableQuery::new(
        TodoTableScope::Workspace(WorkspaceTableScope::Task),
        TableContext::Workspace,
        0,
        50,
        FilterMode::And,
        vec![tags],
        vec![],
        settings,
        None,
    )
    .unwrap();
    assert_eq!(query.filters()[0].values(), &["one", "two"]);

    let too_many = (0..51)
        .map(|_| TodoTableFilter::Workspace {
            field: WorkspaceFilterField::Title,
            operator: TodoFilterOperator::Contains,
            value: TodoTableFilterValue::Text("x".into()),
        })
        .collect();
    assert!(
        TodoTableQuery::new(
            TodoTableScope::Workspace(WorkspaceTableScope::Task),
            TableContext::Workspace,
            0,
            50,
            FilterMode::And,
            too_many,
            vec![],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .is_err()
    );
}

#[test]
fn row_keys_are_constructor_derived_and_group_values_preserve_saved_keys_safely() {
    assert_eq!(canonical_group_value("normal-tag"), "normal-tag");
    assert_ne!(canonical_group_value("untagged"), "untagged");
    assert_ne!(canonical_group_value("none"), "none");
    assert_ne!(canonical_group_value("\\value"), "\\value");
    assert_ne!(canonical_group_value("line\nbreak"), "line\nbreak");
    assert_eq!(
        missing_group(TodoTableGroup::Workspace(WorkspaceTableGroup::Area)),
        Some(("none", "No area"))
    );
    assert_eq!(
        missing_group(TodoTableGroup::Workspace(WorkspaceTableGroup::Tag)),
        Some(("untagged", "Untagged"))
    );
    assert_eq!(
        missing_group(TodoTableGroup::Planner(PlannerTableGroup::Routine)),
        Some(("none", "No routine"))
    );
    assert_eq!(
        missing_group(TodoTableGroup::Planner(PlannerTableGroup::None)),
        None
    );

    let item = TodoItem::new_task("same:id", "Task", Actor::User, OffsetDateTime::UNIX_EPOCH);
    let record = TodoTableRecord::new(item).unwrap();
    let first = TodoTableRow::new(Some("a:b".into()), Some("A".into()), record.clone()).unwrap();
    let second = TodoTableRow::new(Some("a".into()), Some("B".into()), record).unwrap();
    assert_ne!(first.key(), second.key());
    assert!(
        TodoTableRow::new(
            None,
            Some("bad".into()),
            TodoTableRecord::new(TodoItem::new_task(
                "id",
                "Task",
                Actor::User,
                OffsetDateTime::UNIX_EPOCH
            ),)
            .unwrap()
        )
        .is_err()
    );

    let page = TablePage::from_limit_plus_one(vec![first, second], 5, 1).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.next_offset, Some(6));
    assert!(TablePage::from_limit_plus_one(vec![1, 2], u32::MAX, 1).is_err());
}
