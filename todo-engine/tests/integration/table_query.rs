use time::{Date, Month, OffsetDateTime};
use todo_engine::application::error::TodoError;
use todo_engine::application::service::{
    CreateArea, ProposeEvent, ProposeGoal, ProposeProject, ProposeRoutine, ProposeTask,
    TodoService, UpdateItem,
};
use todo_engine::application::table::{
    FilterMode, GroupSort, MAX_CANONICAL_GROUP_KEY_BYTES, MAX_TABLE_TEXT_BYTES, PlannerFilterField,
    PlannerSortField, PlannerTableGroup, PlannerTableScope, RelativeDateUnit, SortDirection,
    TableContext, TablePage, TodoFilterOperator, TodoTableFilter, TodoTableFilterValue,
    TodoTableGroup, TodoTableGroupSettings, TodoTableQuery, TodoTableRecord, TodoTableRow,
    TodoTableScope, TodoTableSort, WorkspaceFilterField, WorkspaceSortField, WorkspaceTableGroup,
    WorkspaceTableScope, canonical_group_value, missing_group,
};
use todo_engine::domain::{Actor, ItemType, TodoItem};
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};

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

fn page_titles(service: &mut TodoService, query: &TodoTableQuery) -> Vec<String> {
    service
        .query_table(query)
        .unwrap()
        .items
        .into_iter()
        .map(|row| row.record().title.clone())
        .collect()
}

#[test]
fn malformed_scheduled_is_unscheduled_and_never_in_range_or_overdue() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for service in [&mut memory, &mut sqlite] {
        for (title, scheduled) in [
            ("Valid", Some("2026-08-22")),
            ("Before", Some("2026-08-01")),
            ("Empty", Some("")),
            ("Null", None),
            ("Malformed", Some("2026-99-99")),
            ("Max", Some("9999-12-31")),
        ] {
            service
                .propose_task(
                    title,
                    ProposeTask {
                        scheduled: scheduled.map(str::to_string),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
    }
    let query = |scope, from, to| {
        TodoTableQuery::new(
            TodoTableScope::Planner(scope),
            TableContext::Planner { from, to },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![TodoTableSort::Planner {
                field: PlannerSortField::Title,
                direction: SortDirection::Asc,
            }],
            groups(TodoTableGroup::Planner(PlannerTableGroup::None)),
            None,
        )
        .unwrap()
    };
    for (scope, from, to, expected) in [
        (
            PlannerTableScope::DailyUnscheduled,
            date(2026, Month::August, 22),
            date(2026, Month::August, 22),
            vec!["Empty", "Malformed", "Null"],
        ),
        (
            PlannerTableScope::DailyToday,
            date(2026, Month::August, 22),
            date(2026, Month::August, 22),
            vec!["Valid"],
        ),
        (
            PlannerTableScope::DailyOverdue,
            date(2026, Month::August, 22),
            date(2026, Month::August, 22),
            vec!["Before"],
        ),
        (
            PlannerTableScope::DailyToday,
            Date::MAX,
            Date::MAX,
            vec!["Max"],
        ),
    ] {
        let query = query(scope, from, to);
        let memory_titles = page_titles(&mut memory, &query);
        assert_eq!(memory_titles, expected);
        assert_eq!(page_titles(&mut sqlite, &query), memory_titles);
    }
    for (operator, expected) in [
        (
            TodoFilterOperator::IsEmpty,
            vec!["Empty", "Malformed", "Null"],
        ),
        (
            TodoFilterOperator::IsNotEmpty,
            vec!["Before", "Max", "Valid"],
        ),
    ] {
        let query = TodoTableQuery::new(
            TodoTableScope::Workspace(WorkspaceTableScope::Task),
            TableContext::Workspace,
            0,
            50,
            FilterMode::And,
            vec![TodoTableFilter::Workspace {
                field: WorkspaceFilterField::Scheduled,
                operator,
                value: TodoTableFilterValue::Empty,
            }],
            vec![TodoTableSort::Workspace {
                field: WorkspaceSortField::Title,
                direction: SortDirection::Asc,
            }],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .unwrap();
        assert_eq!(page_titles(&mut memory, &query), expected);
        assert_eq!(page_titles(&mut sqlite, &query), expected);
    }
}

#[test]
fn unicode_fold_filters_match_for_title_tag_and_relation() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for service in [&mut memory, &mut sqlite] {
        service
            .create_area(CreateArea {
                title: "Ος".into(),
                review_cycle: None,
                standard: None,
                note: None,
                tags: vec![],
            })
            .unwrap();
        service
            .propose_task(
                "ΟΣ á한",
                ProposeTask {
                    area: Some("Ος".into()),
                    tags: vec!["İ".into(), "Á".into(), "한".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        service.propose_task("Neither", Default::default()).unwrap();
    }
    let cases = [
        (
            WorkspaceFilterField::Title,
            TodoFilterOperator::StartsWith,
            TodoTableFilterValue::Text("οσ".into()),
        ),
        (
            WorkspaceFilterField::Tags,
            TodoFilterOperator::Contains,
            TodoTableFilterValue::TextList(vec!["i\u{307}".into()]),
        ),
        (
            WorkspaceFilterField::Tags,
            TodoFilterOperator::Contains,
            TodoTableFilterValue::TextList(vec!["á".into(), "한".into()]),
        ),
        (
            WorkspaceFilterField::Area,
            TodoFilterOperator::Is,
            TodoTableFilterValue::TextList(vec!["ος".into()]),
        ),
    ];
    for (field, operator, value) in cases {
        let query = TodoTableQuery::new(
            TodoTableScope::Workspace(WorkspaceTableScope::Task),
            TableContext::Workspace,
            0,
            50,
            FilterMode::And,
            vec![TodoTableFilter::Workspace {
                field,
                operator,
                value,
            }],
            vec![],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .unwrap();
        assert_eq!(page_titles(&mut memory, &query), vec!["ΟΣ á한"]);
        assert_eq!(page_titles(&mut sqlite, &query), vec!["ΟΣ á한"]);
    }
}

fn canonical_page(page: &TablePage<TodoTableRow>) -> serde_json::Value {
    let mut value = serde_json::to_value(page).unwrap();
    for row in value["items"].as_array_mut().unwrap() {
        let record = row["record"].as_object_mut().unwrap();
        let alias = format!(
            "{}:{}",
            record["type"].as_str().unwrap(),
            record["title"].as_str().unwrap()
        );
        record.insert("id".into(), alias.clone().into());
        for field in ["area_id", "project_id", "routine_id", "parent_id"] {
            if !record[field].is_null() {
                record.insert(field.into(), format!("<{field}>").into());
            }
        }
        for field in [
            "created_at",
            "updated_at",
            "completed_at",
            "last_materialized_at",
        ] {
            if !record[field].is_null() {
                record.insert(field.into(), "<time>".into());
            }
        }
        let group = row["group_key"].as_str().unwrap_or_default();
        row["key"] = format!("{}:{group}:{alias}", group.len()).into();
    }
    value
}

#[test]
fn table_pages_match_between_memory_and_sqlite() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for index in 0..51 {
        let request = || ProposeTask {
            priority: Some(index % 3),
            tags: vec![format!("tag-{}", index % 2)],
            ..Default::default()
        };
        memory
            .propose_task(format!("task-{index:02}"), request())
            .unwrap();
        sqlite
            .propose_task(format!("task-{index:02}"), request())
            .unwrap();
    }

    let query = workspace_query(WorkspaceTableScope::Task).unwrap();
    let memory_page = memory.query_table(&query).unwrap();
    let sqlite_page = sqlite.query_table(&query).unwrap();
    assert_eq!(memory_page.items.len(), 50);
    assert_eq!(memory_page.next_offset, Some(50));
    assert_eq!(
        memory_page
            .items
            .iter()
            .map(|row| row.record().title.as_str())
            .collect::<Vec<_>>(),
        sqlite_page
            .items
            .iter()
            .map(|row| row.record().title.as_str())
            .collect::<Vec<_>>()
    );
    assert!(
        memory_page
            .items
            .iter()
            .all(|row| row.key().ends_with(row.record().logical_id()))
    );
    assert!(
        sqlite_page
            .items
            .iter()
            .all(|row| row.key().ends_with(row.record().logical_id()))
    );

    let page_two = TodoTableQuery::new(
        TodoTableScope::Workspace(WorkspaceTableScope::Task),
        TableContext::Workspace,
        50,
        50,
        FilterMode::And,
        vec![],
        vec![],
        groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
        None,
    )
    .unwrap();
    let memory_page = memory.query_table(&page_two).unwrap();
    let sqlite_page = sqlite.query_table(&page_two).unwrap();
    assert_eq!(memory_page.items.len(), 1);
    assert_eq!(memory_page.next_offset, None);
    assert_eq!(
        memory_page.items[0].record().title,
        sqlite_page.items[0].record().title
    );
}

#[test]
fn linked_project_tasks_match_runtime_context_and_parent_type() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    let project_request = || ProposeProject {
        title: "Parent".into(),
        definition_of_done: Some("Done".into()),
        actor: Actor::User,
        ..Default::default()
    };
    let memory_parent = memory.propose_project(project_request()).unwrap();
    let sqlite_parent = sqlite.propose_project(project_request()).unwrap();
    memory
        .propose_task(
            "Linked",
            ProposeTask {
                project_id: Some(memory_parent.id.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    sqlite
        .propose_task(
            "Linked",
            ProposeTask {
                project_id: Some(sqlite_parent.id.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    memory.propose_task("Other", Default::default()).unwrap();
    sqlite.propose_task("Other", Default::default()).unwrap();

    let query = |parent_id| {
        TodoTableQuery::new(
            TodoTableScope::Linked {
                parent: ItemType::Project,
                child: ItemType::Task,
            },
            TableContext::Linked {
                parent_id,
                parent_type: ItemType::Project,
            },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .unwrap()
    };
    let memory_page = memory.query_table(&query(memory_parent.id)).unwrap();
    let sqlite_page = sqlite.query_table(&query(sqlite_parent.id)).unwrap();
    assert_eq!(memory_page.items.len(), 1);
    assert_eq!(memory_page.items[0].record().title, "Linked");
    assert_eq!(
        memory_page.items[0].record().title,
        sqlite_page.items[0].record().title
    );
}

fn seed_link_matrix(service: &mut TodoService) -> Vec<(ItemType, ItemType, String, &'static str)> {
    let area = service
        .create_area(CreateArea {
            title: "Area".into(),
            review_cycle: None,
            standard: None,
            note: None,
            tags: vec![],
        })
        .unwrap();
    let project = service
        .propose_project(ProposeProject {
            title: "Project".into(),
            area: Some("Area".into()),
            definition_of_done: Some("Done".into()),
            ..Default::default()
        })
        .unwrap();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "Routine".into(),
            area: Some("Area".into()),
            project_id: Some(project.id.clone()),
            recurrence_rule: Some("daily".into()),
            ..Default::default()
        })
        .unwrap();
    service
        .propose_task(
            "Linked Task",
            ProposeTask {
                area: Some("Area".into()),
                project_id: Some(project.id.clone()),
                routine_id: Some(routine.id.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    service
        .propose_event(ProposeEvent {
            title: "Linked Event".into(),
            scheduled: Some("2026-08-22".into()),
            area: Some("Area".into()),
            project_id: Some(project.id.clone()),
            ..Default::default()
        })
        .unwrap();
    let parent_goal = service
        .propose_goal(ProposeGoal {
            title: "Parent Goal".into(),
            horizon: "year".into(),
            scheduled: "2026-01-01".into(),
            ..Default::default()
        })
        .unwrap();
    service
        .propose_goal(ProposeGoal {
            title: "Child Goal".into(),
            horizon: "month".into(),
            scheduled: "2026-08-01".into(),
            parent_id: Some(parent_goal.id.clone()),
            ..Default::default()
        })
        .unwrap();
    let goal_task = service
        .propose_task("Goal Task", ProposeTask::default())
        .unwrap();
    service
        .update_item(
            &goal_task.id,
            UpdateItem {
                parent_id: Some(parent_goal.id.clone()),
                scheduled: Some("2026-08-22".into()),
                ..Default::default()
            },
        )
        .unwrap();
    service
        .propose_task("Nonmatching", Default::default())
        .unwrap();
    vec![
        (
            ItemType::Area,
            ItemType::Project,
            area.id.clone(),
            "Project",
        ),
        (
            ItemType::Area,
            ItemType::Routine,
            area.id.clone(),
            "Routine",
        ),
        (
            ItemType::Area,
            ItemType::Task,
            area.id.clone(),
            "Linked Task",
        ),
        (ItemType::Area, ItemType::Event, area.id, "Linked Event"),
        (
            ItemType::Project,
            ItemType::Routine,
            project.id.clone(),
            "Routine",
        ),
        (
            ItemType::Project,
            ItemType::Task,
            project.id.clone(),
            "Linked Task",
        ),
        (
            ItemType::Project,
            ItemType::Event,
            project.id,
            "Linked Event",
        ),
        (ItemType::Routine, ItemType::Task, routine.id, "Linked Task"),
        (
            ItemType::Goal,
            ItemType::Goal,
            parent_goal.id.clone(),
            "Child Goal",
        ),
        (ItemType::Goal, ItemType::Task, parent_goal.id, "Goal Task"),
    ]
}

#[test]
fn all_link_relationships_execute_with_matching_and_nonmatching_rows() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    let memory_links = seed_link_matrix(&mut memory);
    let sqlite_links = seed_link_matrix(&mut sqlite);
    for ((parent, child, memory_id, expected), (_, _, sqlite_id, _)) in
        memory_links.into_iter().zip(sqlite_links)
    {
        let query = |parent_id| {
            TodoTableQuery::new(
                TodoTableScope::Linked { parent, child },
                TableContext::Linked {
                    parent_type: parent,
                    parent_id,
                },
                0,
                50,
                FilterMode::And,
                vec![],
                vec![],
                groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
                None,
            )
            .unwrap()
        };
        let memory_page = memory.query_table(&query(memory_id)).unwrap();
        let sqlite_page = sqlite.query_table(&query(sqlite_id)).unwrap();
        assert_eq!(memory_page.items.len(), 1);
        assert_eq!(sqlite_page.items.len(), 1);
        assert_eq!(memory_page.items[0].record().title, expected);
        assert_eq!(memory_page.items[0].record().item_type, child);
        assert!(
            memory_page
                .items
                .iter()
                .all(|row| row.record().title != "Nonmatching")
        );
        assert!(
            sqlite_page
                .items
                .iter()
                .all(|row| row.record().title != "Nonmatching")
        );
        assert_eq!(canonical_page(&sqlite_page), canonical_page(&memory_page));
    }
}

#[test]
fn planner_work_lifecycle_matches_visible_frontend_statuses() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for service in [&mut memory, &mut sqlite] {
        let request = || ProposeTask {
            scheduled: Some("2026-08-22".into()),
            ..Default::default()
        };
        service.propose_task("Active", request()).unwrap();
        let paused = service.propose_task("Paused", request()).unwrap();
        service.pause(&paused.id, None).unwrap();
        let completed = service.propose_task("Completed", request()).unwrap();
        service.complete(&completed.id, None).unwrap();
        let missed = service.propose_task("Missed", request()).unwrap();
        service.miss(&missed.id, "2026-08-23", None).unwrap();
        let dropped = service.propose_task("Dropped", request()).unwrap();
        service.drop(&dropped.id, None).unwrap();
        let archived = service.propose_task("Archived", request()).unwrap();
        service.archive(&archived.id, None).unwrap();
        let cancelled = service.propose_task("Cancelled", request()).unwrap();
        service.cancel(&cancelled.id, None).unwrap();
        let routine = service
            .propose_routine(ProposeRoutine {
                title: "Waiting".into(),
                recurrence_rule: Some("daily".into()),
                future_occurrences: 1,
                ..Default::default()
            })
            .unwrap();
        service
            .materialize_routine(&routine.id, "2026-08-22", Some(1))
            .unwrap();
        service.pause(&routine.id, None).unwrap();
    }
    let query = TodoTableQuery::new(
        TodoTableScope::Planner(PlannerTableScope::DailyToday),
        TableContext::Planner {
            from: date(2026, Month::August, 22),
            to: date(2026, Month::August, 22),
        },
        0,
        50,
        FilterMode::And,
        vec![],
        vec![],
        groups(TodoTableGroup::Planner(PlannerTableGroup::Status)),
        None,
    )
    .unwrap();
    let titles = |page: &TablePage<TodoTableRow>| {
        page.items
            .iter()
            .map(|row| row.record().title.clone())
            .collect::<Vec<_>>()
    };
    let memory_page = memory.query_table(&query).unwrap();
    let sqlite_page = sqlite.query_table(&query).unwrap();
    assert_eq!(
        titles(&memory_page),
        vec!["Active", "Paused", "Completed", "Missed", "Waiting"]
    );
    assert_eq!(titles(&memory_page), titles(&sqlite_page));
    assert_eq!(
        memory_page
            .items
            .iter()
            .map(|row| row.group_label().unwrap())
            .collect::<Vec<_>>(),
        vec!["Active", "Paused", "Completed", "missed", "Waiting"]
    );
}

#[test]
fn planner_lookup_types_are_scoped_before_projection() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for service in [&mut memory, &mut sqlite] {
        service
            .propose_task("Task", ProposeTask::default())
            .unwrap();
        service
            .propose_event(ProposeEvent {
                title: "Event".into(),
                scheduled: Some("2026-08-22".into()),
                ..Default::default()
            })
            .unwrap();
        service
            .propose_goal(ProposeGoal {
                title: "Goal".into(),
                horizon: "month".into(),
                scheduled: "2026-08-01".into(),
                ..Default::default()
            })
            .unwrap();
    }
    let projected = |service: &mut TodoService, scope| {
        service
            .table_lookups(TodoTableScope::Planner(scope))
            .unwrap()
            .into_iter()
            .map(|lookup| (lookup.item_type, lookup.title))
            .collect::<Vec<_>>()
    };
    for scope in [
        PlannerTableScope::MonthlyCalendar,
        PlannerTableScope::WeeklyDayGrid,
        PlannerTableScope::DailyToday,
        PlannerTableScope::DailyOverdue,
        PlannerTableScope::DailyUnscheduled,
    ] {
        let work = projected(&mut memory, scope);
        assert_eq!(
            work,
            vec![
                (ItemType::Event, "Event".into()),
                (ItemType::Task, "Task".into())
            ]
        );
        assert_eq!(work, projected(&mut sqlite, scope));
    }
    for scope in [
        PlannerTableScope::YearlyPeriodGoals,
        PlannerTableScope::YearlyMonthGoals,
        PlannerTableScope::MonthlyPeriodGoals,
        PlannerTableScope::MonthlyWeekGoals,
        PlannerTableScope::WeeklyMonthGoals,
        PlannerTableScope::WeeklyWeekGoals,
    ] {
        let goals = projected(&mut memory, scope);
        assert_eq!(goals, vec![(ItemType::Goal, "Goal".into())]);
        assert_eq!(goals, projected(&mut sqlite, scope));
    }
}

#[test]
fn corrupt_lookup_type_and_tags_return_storage_errors_instead_of_omission() {
    let insert = |conn: &rusqlite::Connection, id: &str, kind: &str, tags: &str| {
        conn.execute(
            "INSERT INTO items (id,type,title,status,proposed_by,tags,created_at,updated_at) VALUES (?1,?2,'Corrupt','active','system',?3,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
            rusqlite::params![id, kind, tags],
        )
        .unwrap();
    };
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    insert(&conn, "bad-type", "not-a-type", "[]");
    let mut service = TodoService::persistent(SqliteTodoRepository::new(conn));
    assert!(matches!(
        service.table_lookups(TodoTableScope::Workspace(WorkspaceTableScope::Task)),
        Err(TodoError::Storage(_))
    ));

    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    insert(&conn, "bad-tags", "task", "not-json");
    let mut service = TodoService::persistent(SqliteTodoRepository::new(conn));
    assert!(matches!(
        service.table_lookups(TodoTableScope::Workspace(WorkspaceTableScope::Task)),
        Err(TodoError::Storage(_))
    ));
}

#[test]
fn every_planner_scope_executes_seeded_boundaries_in_both_stores() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for service in [&mut memory, &mut sqlite] {
        for (title, scheduled) in [
            ("From", Some("2026-08-01")),
            ("Inside", Some("2026-08-15")),
            ("To", Some("2026-08-31")),
            ("Before", Some("2026-07-31")),
            ("After", Some("2026-09-01")),
            ("Unscheduled", None),
        ] {
            service
                .propose_task(
                    title,
                    ProposeTask {
                        scheduled: scheduled.map(str::to_string),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        for (title, horizon, scheduled) in [
            ("Year", "year", "2026-01-01"),
            ("Month", "month", "2026-08-01"),
            ("Week", "week", "2026-08-03"),
            ("Outside month", "month", "2026-09-01"),
            ("Outside week", "week", "2026-09-07"),
        ] {
            service
                .propose_goal(ProposeGoal {
                    title: title.into(),
                    horizon: horizon.into(),
                    scheduled: scheduled.into(),
                    ..Default::default()
                })
                .unwrap();
        }
    }
    let august = (date(2026, Month::August, 1), date(2026, Month::August, 31));
    let cases = [
        (
            PlannerTableScope::YearlyPeriodGoals,
            date(2026, Month::January, 1),
            date(2026, Month::December, 31),
            vec!["Year"],
        ),
        (
            PlannerTableScope::YearlyMonthGoals,
            august.0,
            august.1,
            vec!["Month"],
        ),
        (
            PlannerTableScope::MonthlyPeriodGoals,
            august.0,
            august.1,
            vec!["Month"],
        ),
        (
            PlannerTableScope::MonthlyWeekGoals,
            august.0,
            august.1,
            vec!["Week"],
        ),
        (
            PlannerTableScope::WeeklyMonthGoals,
            august.0,
            august.1,
            vec!["Month"],
        ),
        (
            PlannerTableScope::WeeklyWeekGoals,
            august.0,
            august.1,
            vec!["Week"],
        ),
        (
            PlannerTableScope::MonthlyCalendar,
            august.0,
            august.1,
            vec!["From", "Inside", "To"],
        ),
        (
            PlannerTableScope::WeeklyDayGrid,
            august.0,
            august.1,
            vec!["From", "Inside", "To"],
        ),
        (
            PlannerTableScope::DailyToday,
            august.0,
            august.1,
            vec!["From", "Inside", "To"],
        ),
        (
            PlannerTableScope::DailyOverdue,
            august.0,
            august.0,
            vec!["Before"],
        ),
        (
            PlannerTableScope::DailyUnscheduled,
            august.0,
            august.0,
            vec!["Unscheduled"],
        ),
    ];
    for (scope, from, to, expected) in cases {
        let query = TodoTableQuery::new(
            TodoTableScope::Planner(scope),
            TableContext::Planner { from, to },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![TodoTableSort::Planner {
                field: PlannerSortField::Title,
                direction: SortDirection::Asc,
            }],
            groups(TodoTableGroup::Planner(PlannerTableGroup::None)),
            None,
        )
        .unwrap();
        let memory_page = memory.query_table(&query).unwrap();
        let sqlite_page = sqlite.query_table(&query).unwrap();
        let memory_titles = memory_page
            .items
            .iter()
            .map(|row| row.record().title.clone())
            .collect::<Vec<_>>();
        assert_eq!(memory_titles, expected, "{scope:?}");
        assert_eq!(
            canonical_page(&sqlite_page),
            canonical_page(&memory_page),
            "{scope:?}"
        );
    }
}

#[test]
fn filtered_tag_occurrences_match_between_memory_and_sqlite() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for (title, priority, tags) in [
        ("Alpha work", 1, vec!["red".into(), "blue".into()]),
        ("Alpha later", 2, vec!["blue".into()]),
        ("Beta work", 1, Vec::new()),
        (
            "Sentinels",
            1,
            vec!["untagged".into(), "a\\b".into(), "\u{1}".into()],
        ),
    ] {
        let request = || ProposeTask {
            priority: Some(priority),
            tags: tags.clone(),
            ..Default::default()
        };
        memory.propose_task(title, request()).unwrap();
        sqlite.propose_task(title, request()).unwrap();
    }
    let query = TodoTableQuery::new(
        TodoTableScope::Workspace(WorkspaceTableScope::Task),
        TableContext::Workspace,
        0,
        50,
        FilterMode::And,
        vec![
            TodoTableFilter::Workspace {
                field: WorkspaceFilterField::Title,
                operator: TodoFilterOperator::Contains,
                value: TodoTableFilterValue::Text("alpha".into()),
            },
            TodoTableFilter::Workspace {
                field: WorkspaceFilterField::Priority,
                operator: TodoFilterOperator::Is,
                value: TodoTableFilterValue::TextList(vec!["1".into()]),
            },
        ],
        vec![TodoTableSort::Workspace {
            field: WorkspaceSortField::Title,
            direction: SortDirection::Asc,
        }],
        TodoTableGroupSettings::new(
            TodoTableGroup::Workspace(WorkspaceTableGroup::Tag),
            GroupSort::Alphabetical,
            true,
            vec![],
            vec![],
        )
        .unwrap(),
        None,
    )
    .unwrap();
    let project = |service: &mut TodoService| {
        service
            .query_table(&query)
            .unwrap()
            .items
            .into_iter()
            .map(|row| {
                (
                    row.group_label().unwrap().to_string(),
                    row.record().title.clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        project(&mut memory),
        vec![
            ("blue".into(), "Alpha work".into()),
            ("red".into(), "Alpha work".into())
        ]
    );
    assert_eq!(project(&mut sqlite), project(&mut memory));

    let grouped = TodoTableQuery::new(
        TodoTableScope::Workspace(WorkspaceTableScope::Task),
        TableContext::Workspace,
        0,
        50,
        FilterMode::And,
        vec![],
        vec![],
        TodoTableGroupSettings::new(
            TodoTableGroup::Workspace(WorkspaceTableGroup::Tag),
            GroupSort::Alphabetical,
            true,
            vec![],
            vec![],
        )
        .unwrap(),
        None,
    )
    .unwrap();
    let keys = |service: &mut TodoService| {
        service
            .query_table(&grouped)
            .unwrap()
            .items
            .into_iter()
            .map(|row| {
                (
                    row.group_key().unwrap().to_string(),
                    row.record().title.clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(keys(&mut sqlite), keys(&mut memory));

    let lookups = |service: &mut TodoService| {
        service
            .table_lookups(TodoTableScope::Workspace(WorkspaceTableScope::Task))
            .unwrap()
            .into_iter()
            .map(|entry| (entry.item_type, entry.title, entry.tags))
            .collect::<Vec<_>>()
    };
    assert_eq!(lookups(&mut sqlite), lookups(&mut memory));
}

#[test]
fn canonical_group_udf_matches_rust_for_controls_sentinels_and_hidden_keys() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    let tags = vec![
        "none".to_string(),
        "untagged".to_string(),
        "\\literal".to_string(),
        "nul\0tag".to_string(),
        "c1\u{0085}tag".to_string(),
        "x".repeat(MAX_CANONICAL_GROUP_KEY_BYTES / 2),
    ];
    for service in [&mut memory, &mut sqlite] {
        service
            .propose_task(
                "Canonical",
                ProposeTask {
                    tags: tags.clone(),
                    ..Default::default()
                },
            )
            .unwrap();
    }
    let query = |hidden| {
        TodoTableQuery::new(
            TodoTableScope::Workspace(WorkspaceTableScope::Task),
            TableContext::Workspace,
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            TodoTableGroupSettings::new(
                TodoTableGroup::Workspace(WorkspaceTableGroup::Tag),
                GroupSort::Manual,
                false,
                vec![],
                hidden,
            )
            .unwrap(),
            None,
        )
        .unwrap()
    };
    let keys = |service: &mut TodoService, query: &TodoTableQuery| {
        service
            .query_table(query)
            .unwrap()
            .items
            .into_iter()
            .map(|row| row.group_key().unwrap().to_string())
            .collect::<Vec<_>>()
    };
    let expected = tags
        .iter()
        .map(|tag| canonical_group_value(tag))
        .collect::<Vec<_>>();
    let mut memory_keys = keys(&mut memory, &query(vec![]));
    let mut sqlite_keys = keys(&mut sqlite, &query(vec![]));
    memory_keys.sort();
    sqlite_keys.sort();
    let mut expected_sorted = expected.clone();
    expected_sorted.sort();
    assert_eq!(memory_keys, expected_sorted);
    assert_eq!(sqlite_keys, expected_sorted);
    for hidden in expected {
        assert!(!keys(&mut memory, &query(vec![hidden.clone()])).contains(&hidden));
        assert!(!keys(&mut sqlite, &query(vec![hidden.clone()])).contains(&hidden));
    }
}

#[test]
fn relative_calendar_dates_and_or_filters_match_between_stores() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for service in [&mut memory, &mut sqlite] {
        service
            .propose_task(
                "Month rollover",
                ProposeTask {
                    scheduled: Some("2026-03-03".into()),
                    tags: vec!["calendar".into()],
                    ..Default::default()
                },
            )
            .unwrap();
        service
            .propose_task(
                "Other",
                ProposeTask {
                    scheduled: Some("2026-03-03".into()),
                    ..Default::default()
                },
            )
            .unwrap();
    }
    let query = TodoTableQuery::new(
        TodoTableScope::Planner(PlannerTableScope::DailyToday),
        TableContext::Planner {
            from: date(2026, Month::March, 3),
            to: date(2026, Month::March, 3),
        },
        0,
        50,
        FilterMode::Or,
        vec![
            TodoTableFilter::Planner {
                field: PlannerFilterField::Scheduled,
                operator: TodoFilterOperator::IsRelativeToToday,
                value: TodoTableFilterValue::Relative {
                    amount: "1".into(),
                    unit: RelativeDateUnit::Month,
                },
            },
            TodoTableFilter::Planner {
                field: PlannerFilterField::Tags,
                operator: TodoFilterOperator::Contains,
                value: TodoTableFilterValue::TextList(vec!["never".into()]),
            },
        ],
        vec![],
        groups(TodoTableGroup::Planner(PlannerTableGroup::None)),
        Some(date(2026, Month::January, 31)),
    )
    .unwrap();
    let titles = |service: &mut TodoService| {
        service
            .query_table(&query)
            .unwrap()
            .items
            .into_iter()
            .map(|row| row.record().title.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(titles(&mut memory), vec!["Other", "Month rollover"]);
    assert_eq!(titles(&mut sqlite), titles(&mut memory));

    for (group, key, label) in [
        (PlannerTableGroup::Month, "2026-03", "March 2026"),
        (PlannerTableGroup::Week, "2026-03-02", "Week of 2026-03-02"),
        (PlannerTableGroup::Day, "2026-03-03", "2026-03-03"),
    ] {
        let grouped = TodoTableQuery::new(
            TodoTableScope::Planner(PlannerTableScope::DailyToday),
            TableContext::Planner {
                from: date(2026, Month::March, 3),
                to: date(2026, Month::March, 3),
            },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            groups(TodoTableGroup::Planner(group)),
            None,
        )
        .unwrap();
        let projection = |service: &mut TodoService| {
            service
                .query_table(&grouped)
                .unwrap()
                .items
                .into_iter()
                .map(|row| {
                    (
                        row.group_key().unwrap().to_string(),
                        row.group_label().unwrap().to_string(),
                    )
                })
                .collect::<Vec<_>>()
        };
        let memory_rows = projection(&mut memory);
        assert!(
            memory_rows
                .iter()
                .all(|value| value == &(key.into(), label.into()))
        );
        assert_eq!(projection(&mut sqlite), memory_rows);
    }

    let lookup_titles = |service: &mut TodoService| {
        service
            .table_lookups(TodoTableScope::Planner(PlannerTableScope::DailyToday))
            .unwrap()
            .into_iter()
            .filter(|entry| entry.item_type == ItemType::Task)
            .map(|entry| entry.title)
            .collect::<Vec<_>>()
    };
    assert_eq!(lookup_titles(&mut sqlite), lookup_titles(&mut memory));
    assert_eq!(lookup_titles(&mut memory), vec!["Month rollover", "Other"]);
}

#[test]
fn multi_or_matches_each_rule_independently_and_excludes_neither() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for service in [&mut memory, &mut sqlite] {
        for (title, scheduled, tags) in [
            ("Date only", "2026-03-03", vec![]),
            ("Tag only", "2026-03-04", vec!["calendar"]),
            ("Neither", "2026-03-05", vec![]),
        ] {
            service
                .propose_task(
                    title,
                    ProposeTask {
                        scheduled: Some(scheduled.into()),
                        tags: tags.into_iter().map(str::to_string).collect(),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
    }
    let query = TodoTableQuery::new(
        TodoTableScope::Planner(PlannerTableScope::DailyToday),
        TableContext::Planner {
            from: date(2026, Month::March, 1),
            to: date(2026, Month::March, 31),
        },
        0,
        50,
        FilterMode::Or,
        vec![
            TodoTableFilter::Planner {
                field: PlannerFilterField::Scheduled,
                operator: TodoFilterOperator::IsRelativeToToday,
                value: TodoTableFilterValue::Relative {
                    amount: "1".into(),
                    unit: RelativeDateUnit::Month,
                },
            },
            TodoTableFilter::Planner {
                field: PlannerFilterField::Tags,
                operator: TodoFilterOperator::Contains,
                value: TodoTableFilterValue::TextList(vec!["calendar".into()]),
            },
        ],
        vec![TodoTableSort::Planner {
            field: PlannerSortField::Title,
            direction: SortDirection::Asc,
        }],
        groups(TodoTableGroup::Planner(PlannerTableGroup::None)),
        Some(date(2026, Month::January, 31)),
    )
    .unwrap();
    let memory_page = memory.query_table(&query).unwrap();
    let sqlite_page = sqlite.query_table(&query).unwrap();
    assert_eq!(
        memory_page
            .items
            .iter()
            .map(|row| row.record().title.as_str())
            .collect::<Vec<_>>(),
        vec!["Date only", "Tag only"]
    );
    assert_eq!(canonical_page(&sqlite_page), canonical_page(&memory_page));
    assert_eq!(
        memory
            .query_table(&query)
            .unwrap()
            .items
            .iter()
            .map(|row| row.key())
            .collect::<Vec<_>>(),
        memory_page
            .items
            .iter()
            .map(|row| row.key())
            .collect::<Vec<_>>()
    );
}

#[test]
fn unicode_and_field_specific_null_sorting_match_between_stores() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for (title, due) in [
        ("😀", None),
        ("한", None),
        ("ı", None),
        ("á", None),
        ("İ", None),
        ("I", None),
        ("Ος", None),
        ("ΟΣ", None),
        ("a", None),
        ("A", Some("2026-09-01")),
    ] {
        for service in [&mut memory, &mut sqlite] {
            service
                .propose_task(
                    title,
                    ProposeTask {
                        due: due.map(str::to_string),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
    }
    let sorted = |field, direction| {
        TodoTableQuery::new(
            TodoTableScope::Workspace(WorkspaceTableScope::Task),
            TableContext::Workspace,
            0,
            50,
            FilterMode::And,
            vec![],
            vec![TodoTableSort::Workspace { field, direction }],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .unwrap()
    };
    let titles = |service: &mut TodoService, query: &TodoTableQuery| {
        service
            .query_table(query)
            .unwrap()
            .items
            .into_iter()
            .map(|row| row.record().title.clone())
            .collect::<Vec<_>>()
    };
    let title_query = sorted(WorkspaceSortField::Title, SortDirection::Asc);
    assert_eq!(
        titles(&mut memory, &title_query),
        vec!["A", "a", "I", "İ", "á", "ı", "Ος", "ΟΣ", "한", "😀"]
    );
    assert_eq!(
        titles(&mut sqlite, &title_query),
        titles(&mut memory, &title_query)
    );
    let due_asc = sorted(WorkspaceSortField::Due, SortDirection::Asc);
    let due_desc = sorted(WorkspaceSortField::Due, SortDirection::Desc);
    assert_eq!(titles(&mut sqlite, &due_asc), titles(&mut memory, &due_asc));
    assert_eq!(
        titles(&mut sqlite, &due_desc),
        titles(&mut memory, &due_desc)
    );
    assert_eq!(
        titles(&mut memory, &due_asc).last().map(String::as_str),
        Some("A")
    );
    assert_eq!(
        titles(&mut memory, &due_desc).first().map(String::as_str),
        Some("A")
    );
}

#[test]
fn two_sort_rules_keep_null_and_id_ties_stable_in_both_stores() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for service in [&mut memory, &mut sqlite] {
        for (title, priority, due) in [
            ("Null", None, None),
            ("Later", Some(1), Some("2026-09-01")),
            ("Tie", Some(1), Some("2026-08-01")),
            ("Tie", Some(1), Some("2026-08-01")),
        ] {
            service
                .propose_task(
                    title,
                    ProposeTask {
                        priority,
                        due: due.map(str::to_string),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
    }
    let query = TodoTableQuery::new(
        TodoTableScope::Workspace(WorkspaceTableScope::Task),
        TableContext::Workspace,
        0,
        50,
        FilterMode::And,
        vec![],
        vec![
            TodoTableSort::Workspace {
                field: WorkspaceSortField::Priority,
                direction: SortDirection::Asc,
            },
            TodoTableSort::Workspace {
                field: WorkspaceSortField::Due,
                direction: SortDirection::Asc,
            },
        ],
        groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
        None,
    )
    .unwrap();
    let rows = |service: &mut TodoService| service.query_table(&query).unwrap().items;
    let memory_rows = rows(&mut memory);
    let sqlite_rows = rows(&mut sqlite);
    let titles = |rows: &[TodoTableRow]| {
        rows.iter()
            .map(|row| row.record().title.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(titles(&memory_rows), vec!["Tie", "Tie", "Later", "Null"]);
    assert_eq!(titles(&sqlite_rows), titles(&memory_rows));
    let memory_keys = memory_rows
        .iter()
        .map(|row| row.key().to_string())
        .collect::<Vec<_>>();
    let sqlite_keys = sqlite_rows
        .iter()
        .map(|row| row.key().to_string())
        .collect::<Vec<_>>();
    assert_eq!(
        memory_keys,
        rows(&mut memory)
            .iter()
            .map(|row| row.key().to_string())
            .collect::<Vec<_>>()
    );
    assert_eq!(
        sqlite_keys,
        rows(&mut sqlite)
            .iter()
            .map(|row| row.key().to_string())
            .collect::<Vec<_>>()
    );
}

#[test]
fn group_rank_is_contiguous_across_pages_and_honors_partial_manual_order() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for index in 0..53 {
        let tag = if index < 51 { "a" } else { "b" };
        for service in [&mut memory, &mut sqlite] {
            service
                .propose_task(
                    format!("row-{index:02}"),
                    ProposeTask {
                        tags: vec![tag.into()],
                        ..Default::default()
                    },
                )
                .unwrap();
        }
    }
    let query = |offset, hidden| {
        TodoTableQuery::new(
            TodoTableScope::Workspace(WorkspaceTableScope::Task),
            TableContext::Workspace,
            offset,
            50,
            FilterMode::And,
            vec![],
            vec![],
            TodoTableGroupSettings::new(
                TodoTableGroup::Workspace(WorkspaceTableGroup::Tag),
                GroupSort::Manual,
                false,
                vec!["a".into()],
                hidden,
            )
            .unwrap(),
            None,
        )
        .unwrap()
    };
    let keys = |service: &mut TodoService, query: &TodoTableQuery| {
        service
            .query_table(query)
            .unwrap()
            .items
            .into_iter()
            .map(|row| row.group_key().unwrap().to_string())
            .collect::<Vec<_>>()
    };
    let first = query(0, vec![]);
    let second = query(50, vec![]);
    assert_eq!(keys(&mut memory, &first), vec!["a"; 50]);
    assert_eq!(keys(&mut sqlite, &first), keys(&mut memory, &first));
    assert_eq!(keys(&mut memory, &second), vec!["a", "b", "b"]);
    assert_eq!(keys(&mut sqlite, &second), keys(&mut memory, &second));
    let hidden = query(0, vec!["b".into()]);
    assert!(keys(&mut memory, &hidden).iter().all(|key| key == "a"));
    assert_eq!(keys(&mut sqlite, &hidden), keys(&mut memory, &hidden));
}

#[test]
fn manual_group_base_orders_match_frontend_candidates() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    for service in [&mut memory, &mut sqlite] {
        for (title, scheduled, tags) in [
            ("September task", "2026-09-10", vec!["z"]),
            ("August task", "2026-08-10", vec!["a"]),
            ("October task", "2026-10-10", vec![]),
        ] {
            service
                .propose_task(
                    title,
                    ProposeTask {
                        scheduled: Some(scheduled.into()),
                        tags: tags.into_iter().map(str::to_string).collect(),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        service
            .propose_event(ProposeEvent {
                title: "August event".into(),
                scheduled: Some("2026-08-11".into()),
                tags: vec!["a".into()],
                ..Default::default()
            })
            .unwrap();
    }
    let cases = [
        (
            PlannerTableGroup::Tag,
            vec!["z"],
            vec!["z", "a", "untagged"],
        ),
        (PlannerTableGroup::ItemType, vec![], vec!["task", "event"]),
        (
            PlannerTableGroup::Month,
            vec![],
            vec!["2026-08", "2026-09", "2026-10"],
        ),
        (
            PlannerTableGroup::Week,
            vec![],
            vec!["2026-08-10", "2026-09-07", "2026-10-05"],
        ),
        (
            PlannerTableGroup::Day,
            vec![],
            vec!["2026-08-10", "2026-08-11", "2026-09-10", "2026-10-10"],
        ),
    ];
    for (group, manual, expected) in cases {
        let query = TodoTableQuery::new(
            TodoTableScope::Planner(PlannerTableScope::MonthlyCalendar),
            TableContext::Planner {
                from: date(2026, Month::August, 1),
                to: date(2026, Month::October, 31),
            },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            TodoTableGroupSettings::new(
                TodoTableGroup::Planner(group),
                GroupSort::Manual,
                false,
                manual.into_iter().map(str::to_string).collect(),
                vec![],
            )
            .unwrap(),
            None,
        )
        .unwrap();
        let keys = |service: &mut TodoService| {
            let mut keys = Vec::new();
            for row in service.query_table(&query).unwrap().items {
                let key = row.group_key().unwrap().to_string();
                if keys.last() != Some(&key) {
                    keys.push(key);
                }
            }
            keys
        };
        let expected = expected.into_iter().map(str::to_string).collect::<Vec<_>>();
        let memory_keys = keys(&mut memory);
        assert_eq!(memory_keys, expected, "{group:?}");
        assert_eq!(keys(&mut sqlite), memory_keys, "{group:?}");
    }
    for (group, expected) in [
        (PlannerTableGroup::Tag, vec!["z", "untagged", "a"]),
        (PlannerTableGroup::ItemType, vec!["task", "event"]),
        (
            PlannerTableGroup::Month,
            vec!["2026-09", "2026-10", "2026-08"],
        ),
        (
            PlannerTableGroup::Day,
            vec!["2026-10-10", "2026-09-10", "2026-08-11", "2026-08-10"],
        ),
    ] {
        let query = TodoTableQuery::new(
            TodoTableScope::Planner(PlannerTableScope::MonthlyCalendar),
            TableContext::Planner {
                from: date(2026, Month::August, 1),
                to: date(2026, Month::October, 31),
            },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            TodoTableGroupSettings::new(
                TodoTableGroup::Planner(group),
                GroupSort::ReverseAlphabetical,
                false,
                vec![],
                vec![],
            )
            .unwrap(),
            None,
        )
        .unwrap();
        let keys = |service: &mut TodoService| {
            let mut keys = Vec::new();
            for row in service.query_table(&query).unwrap().items {
                let key = row.group_key().unwrap().to_string();
                if keys.last() != Some(&key) {
                    keys.push(key);
                }
            }
            keys
        };
        let memory_keys = keys(&mut memory);
        assert_eq!(memory_keys, expected, "reverse {group:?}");
        assert_eq!(keys(&mut sqlite), memory_keys, "reverse {group:?}");
    }
}

#[test]
fn partial_manual_relation_order_uses_title_then_id_and_missing_last() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
    let seed = |service: &mut TodoService| {
        let late = service
            .propose_project(ProposeProject {
                title: "Late".into(),
                definition_of_done: Some("Done".into()),
                ..Default::default()
            })
            .unwrap();
        let early = service
            .propose_project(ProposeProject {
                title: "Early".into(),
                definition_of_done: Some("Done".into()),
                ..Default::default()
            })
            .unwrap();
        for (title, scheduled, project_id) in [
            ("Late task", "2026-09-01", Some(late.id.clone())),
            ("Early task", "2026-08-01", Some(early.id)),
            ("Missing task", "2026-07-01", None),
        ] {
            service
                .propose_task(
                    title,
                    ProposeTask {
                        scheduled: Some(scheduled.into()),
                        project_id,
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        late.id
    };
    let memory_late = seed(&mut memory);
    let sqlite_late = seed(&mut sqlite);
    let labels = |service: &mut TodoService, late: String| {
        let query = TodoTableQuery::new(
            TodoTableScope::Planner(PlannerTableScope::MonthlyCalendar),
            TableContext::Planner {
                from: date(2026, Month::July, 1),
                to: date(2026, Month::September, 30),
            },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            TodoTableGroupSettings::new(
                TodoTableGroup::Planner(PlannerTableGroup::Project),
                GroupSort::Manual,
                false,
                vec![late],
                vec![],
            )
            .unwrap(),
            None,
        )
        .unwrap();
        let mut labels = Vec::new();
        for row in service.query_table(&query).unwrap().items {
            let label = row.group_label().unwrap().to_string();
            if labels.last() != Some(&label) {
                labels.push(label);
            }
        }
        labels
    };
    let base = vec!["Early", "Late", "No project"];
    assert_eq!(labels(&mut memory, "not-present".into()), base);
    assert_eq!(labels(&mut sqlite, "not-present".into()), base);
    let expected = vec!["Late", "Early", "No project"];
    assert_eq!(labels(&mut memory, memory_late), expected);
    assert_eq!(labels(&mut sqlite, sqlite_late), expected);

    let reverse_labels = |service: &mut TodoService| {
        let query = TodoTableQuery::new(
            TodoTableScope::Planner(PlannerTableScope::MonthlyCalendar),
            TableContext::Planner {
                from: date(2026, Month::July, 1),
                to: date(2026, Month::September, 30),
            },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            TodoTableGroupSettings::new(
                TodoTableGroup::Planner(PlannerTableGroup::Project),
                GroupSort::ReverseAlphabetical,
                false,
                vec![],
                vec![],
            )
            .unwrap(),
            None,
        )
        .unwrap();
        let mut values = Vec::new();
        for row in service.query_table(&query).unwrap().items {
            let label = row.group_label().unwrap().to_string();
            if values.last() != Some(&label) {
                values.push(label);
            }
        }
        values
    };
    assert_eq!(
        reverse_labels(&mut memory),
        vec!["No project", "Late", "Early"]
    );
    assert_eq!(
        reverse_labels(&mut sqlite),
        vec!["No project", "Late", "Early"]
    );
}

#[test]
fn accepts_all_workspace_and_planner_scopes_with_matching_contexts() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
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
        let query = TodoTableQuery::new(
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
        .unwrap();
        assert_eq!(
            memory.query_table(&query).unwrap(),
            sqlite.query_table(&query).unwrap(),
            "{scope:?}"
        );
    }
}

#[test]
fn validates_context_and_every_real_link_relationship() {
    let mut memory = TodoService::in_memory();
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut sqlite = TodoService::persistent(SqliteTodoRepository::new(conn));
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
        let query = TodoTableQuery::new(
            TodoTableScope::Linked { parent, child },
            TableContext::Linked {
                parent_type: parent,
                parent_id: "parent-1".into(),
            },
            0,
            50,
            FilterMode::And,
            vec![],
            vec![],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .unwrap();
        assert_eq!(
            memory.query_table(&query).unwrap(),
            sqlite.query_table(&query).unwrap(),
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
                G::Month,
                G::Week,
                G::Day,
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
                G::Month,
                G::Week,
                G::Day,
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
                G::Month,
                G::Week,
                G::Day,
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
                G::Month,
                G::Week,
                G::Day,
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
                G::Month,
                G::Week,
                G::Day,
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
fn rejects_relative_dates_that_overflow_the_explicit_reference() {
    let query = |reference_date, unit| {
        TodoTableQuery::new(
            TodoTableScope::Planner(PlannerTableScope::DailyToday),
            TableContext::Planner {
                from: Date::MAX,
                to: Date::MAX,
            },
            0,
            50,
            FilterMode::And,
            vec![TodoTableFilter::Planner {
                field: PlannerFilterField::Scheduled,
                operator: TodoFilterOperator::IsRelativeToToday,
                value: TodoTableFilterValue::Relative {
                    amount: "100000".into(),
                    unit,
                },
            }],
            vec![],
            groups(TodoTableGroup::Planner(PlannerTableGroup::None)),
            Some(reference_date),
        )
    };
    assert!(query(Date::MAX, RelativeDateUnit::Day).is_err());
    assert!(query(Date::MAX, RelativeDateUnit::Week).is_err());
    assert!(query(Date::MAX, RelativeDateUnit::Month).is_err());
    assert!(query(Date::MIN, RelativeDateUnit::Day).is_ok());
}

#[test]
fn treats_priority_as_the_frontend_select_field() {
    let saved_view = TodoTableFilter::Workspace {
        field: WorkspaceFilterField::Priority,
        operator: TodoFilterOperator::Is,
        value: TodoTableFilterValue::TextList(vec!["1".into(), "3".into()]),
    };
    assert!(
        TodoTableQuery::new(
            TodoTableScope::Workspace(WorkspaceTableScope::Task),
            TableContext::Workspace,
            0,
            50,
            FilterMode::And,
            vec![saved_view],
            vec![],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
        )
        .is_ok()
    );

    let numeric = TodoTableFilter::Planner {
        field: PlannerFilterField::Priority,
        operator: TodoFilterOperator::GreaterThan,
        value: TodoTableFilterValue::Text("1".into()),
    };
    assert!(
        TodoTableQuery::new(
            TodoTableScope::Planner(PlannerTableScope::DailyToday),
            TableContext::Planner {
                from: date(2026, Month::August, 22),
                to: date(2026, Month::August, 22)
            },
            0,
            50,
            FilterMode::And,
            vec![numeric],
            vec![],
            groups(TodoTableGroup::Planner(PlannerTableGroup::None)),
            None,
        )
        .is_err()
    );
}

#[test]
fn rejects_page_offsets_that_overflow_before_reaching_a_store() {
    assert!(
        TodoTableQuery::new(
            TodoTableScope::Workspace(WorkspaceTableScope::Task),
            TableContext::Workspace,
            u32::MAX,
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
            TodoTableScope::Workspace(WorkspaceTableScope::Task),
            TableContext::Workspace,
            u32::MAX - 50,
            50,
            FilterMode::And,
            vec![],
            vec![],
            groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
            None,
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
            vec!["x".repeat(MAX_CANONICAL_GROUP_KEY_BYTES + 1)],
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

    for values in [
        vec!["duplicate".to_string(); 101],
        vec!["x".repeat(MAX_TABLE_TEXT_BYTES + 1)],
        vec![String::new()],
    ] {
        assert!(
            TodoTableQuery::new(
                TodoTableScope::Workspace(WorkspaceTableScope::Task),
                TableContext::Workspace,
                0,
                50,
                FilterMode::And,
                vec![TodoTableFilter::Workspace {
                    field: WorkspaceFilterField::Tags,
                    operator: TodoFilterOperator::Contains,
                    value: TodoTableFilterValue::TextList(values),
                }],
                vec![],
                groups(TodoTableGroup::Workspace(WorkspaceTableGroup::None)),
                None,
            )
            .is_err()
        );
    }

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
        missing_group(TodoTableGroup::Planner(PlannerTableGroup::Day)),
        Some(("none", "No date"))
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

    let raw = "\\".repeat(MAX_TABLE_TEXT_BYTES);
    let canonical = canonical_group_value(&raw);
    assert_eq!(canonical.len(), MAX_CANONICAL_GROUP_KEY_BYTES);
    let maximum = TodoTableRow::new(
        Some(canonical),
        Some(raw),
        TodoTableRecord::new(TodoItem::new_task(
            "max-tag",
            "Task",
            Actor::User,
            OffsetDateTime::UNIX_EPOCH,
        ))
        .unwrap(),
    )
    .unwrap();
    assert!(maximum.key().ends_with(":max-tag"));
    let sentinel = format!("none{}", "\\".repeat(MAX_TABLE_TEXT_BYTES - 4));
    assert_eq!(
        canonical_group_value(&sentinel).len(),
        MAX_CANONICAL_GROUP_KEY_BYTES
    );
    let too_long = "\\".repeat(MAX_TABLE_TEXT_BYTES + 1);
    assert!(
        TodoTableRow::new(
            Some(canonical_group_value(&too_long)),
            Some(too_long),
            TodoTableRecord::new(TodoItem::new_task(
                "long-tag",
                "Task",
                Actor::User,
                OffsetDateTime::UNIX_EPOCH
            ))
            .unwrap(),
        )
        .is_err()
    );
    assert!(
        TodoTableGroupSettings::new(
            TodoTableGroup::Workspace(WorkspaceTableGroup::Tag),
            GroupSort::Manual,
            true,
            vec!["x".repeat(MAX_CANONICAL_GROUP_KEY_BYTES + 1)],
            vec![],
        )
        .is_err()
    );
}
