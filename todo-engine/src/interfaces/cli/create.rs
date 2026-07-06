use anyhow::Result;
use std::path::Path;

use super::output::print_json;
use super::{
    AreaCreateArgs, EventProposeArgs, GoalProposeArgs, ProjectProposeArgs, RoutineProposeArgs,
    TaskProposeArgs, service,
};
use crate::application::service::{
    CreateArea, ProposeEvent, ProposeGoal, ProposeProject, ProposeRoutine, ProposeTask,
};

pub(super) fn task_propose(home: &Path, args: TaskProposeArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.propose_task(
        args.title,
        ProposeTask {
            actor: args.actor,
            area: args.area,
            due: args.due,
            scheduled: args.scheduled,
            priority: args.priority,
            description: args.description,
            note: args.note,
            ..Default::default()
        },
    )?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn project_propose(home: &Path, args: ProjectProposeArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.propose_project(ProposeProject {
        title: args.title,
        area: args.area,
        definition_of_done: args.definition_of_done,
        outcome: args.outcome,
        due: args.due,
        actor: args.actor,
        note: args.note,
        tags: Vec::new(),
    })?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn goal_propose(home: &Path, args: GoalProposeArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.propose_goal(ProposeGoal {
        title: args.title,
        horizon: args.horizon,
        scheduled: args.scheduled,
        parent_id: args.parent_id,
        actor: args.actor,
        note: args.note,
        tags: Vec::new(),
    })?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn area_create(home: &Path, args: AreaCreateArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.create_area(CreateArea {
        title: args.title,
        review_cycle: args.review_cycle,
        standard: args.standard,
        note: args.note,
        tags: Vec::new(),
    })?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn routine_propose(home: &Path, args: RoutineProposeArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.propose_routine(ProposeRoutine {
        title: args.title,
        area: args.area,
        actor: args.actor,
        recurrence_rule: args.recurrence_rule,
        materialization_policy: args.materialization_policy,
        note: args.note,
        tags: Vec::new(),
    })?;
    print_json(&item)?;
    Ok(())
}

pub(super) fn event_propose(home: &Path, args: EventProposeArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.propose_event(ProposeEvent {
        title: args.title,
        actor: args.actor,
        scheduled: Some(args.scheduled),
        area: args.area,
        project_id: args.project_id,
        due: args.due,
        priority: args.priority,
        description: args.description,
        note: args.note,
        location: args.location,
        participants: args.participants,
        commitment_type: args.commitment_type,
        tags: Vec::new(),
    })?;
    print_json(&item)?;
    Ok(())
}
