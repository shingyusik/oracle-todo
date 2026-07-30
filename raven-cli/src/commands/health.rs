use std::fs::File;
use std::io::Read;
use std::str::FromStr;

use anyhow::Result;
use health_engine::application::commands::{
    CreateDietEntry, CreateHealthEvent, DailyMetricInput, DietMediaUpdate, MediaUpload,
    UpdateDietEntry, UpdateHealthEvent,
};
use health_engine::application::error::{HealthError, HealthResult};
use health_engine::application::ports::{EventQuery, Page};
use health_engine::application::queries::{HealthQuery, TimelineItem};
use health_engine::application::service::HealthService;
use health_engine::application::trends::HealthTrends;
use health_engine::domain::{
    BowelAttributes, HealthCategory, HealthEvent, HealthEventDetails, LabAttributes, MealType,
    MedicationAttributes, MedicationUnit, SleepAttributes, SleepValue, SymptomAttributes,
    WeightAttributes,
};
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::{HealthStorageHealth, SqliteHealthRepository};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::cli::{
    BowelAddArgs, BowelCommand, BowelUpdateArgs, DietAddArgs, DietCommand, DietUpdateArgs,
    HealthCommand, HealthEventCategoryArg, HealthIdentityArgs, HealthIdentityReadArgs,
    HealthMetricCategoryArg, HealthPageArgs, HealthPurgeArgs, HealthTimelineArgs, HealthTrendsArgs,
    MedicationAddArgs, MedicationCommand, MedicationUpdateArgs, MetricAddArgs, MetricCommand,
    MetricDailyUpsertArgs, MetricListArgs, MetricUpdateArgs, OutputFormat,
};
use crate::config::RavenPaths;

type Service = HealthService<SqliteHealthRepository, LocalMediaStore>;

const ACTOR: &str = "raven-cli";
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

pub fn run(paths: &RavenPaths, command: HealthCommand) -> Result<()> {
    let mut service = open_service(paths, is_mutation(&command)).map_err(anyhow::Error::new)?;
    execute(&mut service, command).map_err(anyhow::Error::new)
}

fn is_mutation(command: &HealthCommand) -> bool {
    match command {
        HealthCommand::Diet { command } => {
            !matches!(command, DietCommand::List(_) | DietCommand::Show(_))
        }
        HealthCommand::Bowel { command } => {
            !matches!(command, BowelCommand::List(_) | BowelCommand::Show(_))
        }
        HealthCommand::Medication { command } => !matches!(
            command,
            MedicationCommand::List(_) | MedicationCommand::Show(_)
        ),
        HealthCommand::Metric { command } => {
            !matches!(command, MetricCommand::List(_) | MetricCommand::Show(_))
        }
        HealthCommand::Timeline(_) | HealthCommand::Trends(_) => false,
    }
}

fn open_service(paths: &RavenPaths, mutation: bool) -> HealthResult<Service> {
    if mutation {
        std::fs::create_dir_all(paths.home())
            .map_err(|_| HealthError::Storage("could not create Raven data home".to_string()))?;
        let repository = SqliteHealthRepository::open(paths.health_db())?;
        let media = LocalMediaStore::new(paths.health_media_dir())?;
        return HealthService::start(repository, media);
    }

    if !matches!(
        SqliteHealthRepository::health_at(paths.health_db()),
        HealthStorageHealth::Healthy { .. }
    ) {
        return Err(HealthError::Storage(
            "Health database is not initialized or unavailable".to_string(),
        ));
    }
    if !paths.health_media_dir().is_dir() {
        return Err(HealthError::Storage(
            "Health media directory is not initialized".to_string(),
        ));
    }
    Ok(HealthService::new(
        SqliteHealthRepository::open(paths.health_db())?,
        LocalMediaStore::new(paths.health_media_dir())?,
    ))
}

fn execute(service: &mut Service, command: HealthCommand) -> HealthResult<()> {
    match command {
        HealthCommand::Diet { command } => diet(service, command),
        HealthCommand::Bowel { command } => bowel(service, command),
        HealthCommand::Medication { command } => medication(service, command),
        HealthCommand::Metric { command } => metric(service, command),
        HealthCommand::Timeline(args) => timeline(service, args),
        HealthCommand::Trends(args) => trends(service, args),
    }
}

fn diet(service: &mut Service, command: DietCommand) -> HealthResult<()> {
    match command {
        DietCommand::Add(args) => {
            let input = diet_add_input(args)?;
            print_json(&service.create_diet(CreateDietEntry {
                occurred_at: parse_timestamp(&input.at, "at")?,
                meal_type: input.meal.parse()?,
                food_name: input.food,
                note: input.note,
                tags: input.tags,
                media: input.image.map(read_upload).transpose()?,
                actor: ACTOR.to_string(),
            })?)
        }
        DietCommand::Update(args) => update_diet(service, args),
        DietCommand::List(args) => {
            let entries = service.list_diet(page(args.offset, args.limit)?)?;
            print_diet_list(&entries, args.format)
        }
        DietCommand::Show(args) => {
            let record = service.get_diet_including_archived(&args.id)?;
            print_record(&record, args.format, diet_table)
        }
        DietCommand::Archive(args) => print_json(&service.archive_diet_if_current(
            &args.id,
            parse_optional_timestamp(args.expected_updated_at.as_deref(), "expected_updated_at")?,
        )?),
        DietCommand::Restore(args) => print_json(&service.restore_diet_if_current(
            &args.id,
            parse_optional_timestamp(args.expected_updated_at.as_deref(), "expected_updated_at")?,
        )?),
        DietCommand::Purge(args) => purge_diet(service, args),
    }
}

fn update_diet(service: &mut Service, args: DietUpdateArgs) -> HealthResult<()> {
    let id = args.id.clone();
    let input = if let Some(json) = args.json {
        strict_json::<DietUpdateInput>(&json)?
    } else {
        DietUpdateInput {
            at: args.at,
            meal: args.meal,
            food: args.food,
            note: args.note,
            clear_note: args.clear_note,
            tags: args.tags,
            image: args.image.map(|path| ImageInput {
                path,
                content_type: args.content_type,
            }),
            remove_image: args.remove_image,
            expected_updated_at: args.expected_updated_at,
            reason: args.reason,
        }
    };
    if input.image.is_some() && input.remove_image {
        return validation("image", "cannot be combined with remove_image");
    }
    let media = match (input.image, input.remove_image) {
        (Some(image), false) => DietMediaUpdate::Replace(read_upload(image)?),
        (None, true) => DietMediaUpdate::Remove,
        (None, false) => DietMediaUpdate::Preserve,
        (Some(_), true) => unreachable!(),
    };
    print_json(&service.update_diet(
        &id,
        UpdateDietEntry {
            occurred_at: parse_optional_timestamp(input.at.as_deref(), "at")?,
            meal_type: input.meal.as_deref().map(MealType::from_str).transpose()?,
            food_name: input.food,
            note: optional_clear(input.note, input.clear_note, "note")?,
            tags: input.tags,
            media,
            expected_updated_at: parse_optional_timestamp(
                input.expected_updated_at.as_deref(),
                "expected_updated_at",
            )?,
            actor: ACTOR.to_string(),
            reason: input.reason,
        },
    )?)
}

fn bowel(service: &mut Service, command: BowelCommand) -> HealthResult<()> {
    match command {
        BowelCommand::Add(args) => {
            let input = bowel_add_input(args)?;
            let details = HealthEventDetails::Bowel(BowelAttributes::new(
                input.bristol,
                input.blood_visible,
            )?);
            print_json(&service.create_event(CreateHealthEvent {
                occurred_at: parse_timestamp(&input.at, "at")?,
                details,
                note: input.note,
                actor: ACTOR.to_string(),
            })?)
        }
        BowelCommand::Update(args) => update_bowel(service, args),
        BowelCommand::List(args) => list_events(service, HealthCategory::Bowel, None, args),
        BowelCommand::Show(args) => show_event_category(service, args, HealthCategory::Bowel),
        BowelCommand::Archive(args) => transition_event(service, args, true, EventKind::Bowel),
        BowelCommand::Restore(args) => transition_event(service, args, false, EventKind::Bowel),
        BowelCommand::Purge(args) => purge_event(service, args, EventKind::Bowel),
    }
}

fn update_bowel(service: &mut Service, args: BowelUpdateArgs) -> HealthResult<()> {
    let id = args.id.clone();
    let input = if let Some(json) = args.json {
        strict_json::<BowelUpdateInput>(&json)?
    } else {
        BowelUpdateInput {
            at: args.at,
            bristol: args.bristol,
            blood_visible: args.blood_visible,
            note: args.note,
            clear_note: args.clear_note,
            expected_updated_at: args.expected_updated_at,
            reason: args.reason,
        }
    };
    let current = service.get_event(&id)?;
    let HealthEventDetails::Bowel(before) = current.details()? else {
        return validation("id", "does not identify a bowel event");
    };
    let details = if input.bristol.is_some() || input.blood_visible.is_some() {
        Some(HealthEventDetails::Bowel(BowelAttributes::new(
            input.bristol.unwrap_or(before.bristol_scale()),
            input.blood_visible.unwrap_or(before.blood_visible()),
        )?))
    } else {
        None
    };
    print_json(&service.update_event(&id, event_update(input.common(), details)?)?)
}

fn medication(service: &mut Service, command: MedicationCommand) -> HealthResult<()> {
    match command {
        MedicationCommand::Add(args) => {
            let input = medication_add_input(args)?;
            let details = HealthEventDetails::Medication(MedicationAttributes::new(
                input.name,
                input.dose,
                input.unit.parse()?,
            )?);
            print_json(&service.create_event(CreateHealthEvent {
                occurred_at: parse_timestamp(&input.at, "at")?,
                details,
                note: input.note,
                actor: ACTOR.to_string(),
            })?)
        }
        MedicationCommand::Update(args) => update_medication(service, args),
        MedicationCommand::List(args) => {
            list_events(service, HealthCategory::Medication, None, args)
        }
        MedicationCommand::Show(args) => {
            show_event_category(service, args, HealthCategory::Medication)
        }
        MedicationCommand::Archive(args) => {
            transition_event(service, args, true, EventKind::Medication)
        }
        MedicationCommand::Restore(args) => {
            transition_event(service, args, false, EventKind::Medication)
        }
        MedicationCommand::Purge(args) => purge_event(service, args, EventKind::Medication),
    }
}

fn update_medication(service: &mut Service, args: MedicationUpdateArgs) -> HealthResult<()> {
    let id = args.id.clone();
    let input = if let Some(json) = args.json {
        strict_json::<MedicationUpdateInput>(&json)?
    } else {
        MedicationUpdateInput {
            at: args.at,
            name: args.name,
            dose: args.dose,
            unit: args.unit,
            note: args.note,
            clear_note: args.clear_note,
            expected_updated_at: args.expected_updated_at,
            reason: args.reason,
        }
    };
    let current = service.get_event(&id)?;
    let HealthEventDetails::Medication(before) = current.details()? else {
        return validation("id", "does not identify a medication event");
    };
    let details = if input.name.is_some() || input.dose.is_some() || input.unit.is_some() {
        Some(HealthEventDetails::Medication(MedicationAttributes::new(
            input
                .name
                .clone()
                .unwrap_or_else(|| before.medication_name().to_string()),
            input.dose.unwrap_or(before.dose()),
            input
                .unit
                .as_deref()
                .map(MedicationUnit::from_str)
                .transpose()?
                .unwrap_or(before.unit()),
        )?))
    } else {
        None
    };
    print_json(&service.update_event(&id, event_update(input.common(), details)?)?)
}

fn metric(service: &mut Service, command: MetricCommand) -> HealthResult<()> {
    match command {
        MetricCommand::Add(args) => {
            let input = metric_add_input(args)?;
            print_json(&service.create_event(CreateHealthEvent {
                occurred_at: parse_timestamp(&input.at, "at")?,
                details: metric_details(&input)?,
                note: input.note,
                actor: ACTOR.to_string(),
            })?)
        }
        MetricCommand::DailyUpsert(MetricDailyUpsertArgs { json }) => {
            let inputs = strict_json::<Vec<MetricInput>>(&json)?;
            let mut commands = Vec::with_capacity(inputs.len());
            for input in inputs {
                commands.push(DailyMetricInput {
                    occurred_at: parse_timestamp(&input.at, "at")?,
                    details: metric_details(&input)?,
                    note: input.note,
                    actor: ACTOR.to_string(),
                });
            }
            print_json(&service.upsert_daily_metrics(commands)?)
        }
        MetricCommand::Update(args) => update_metric(service, args),
        MetricCommand::List(args) => metric_list(service, args),
        MetricCommand::Show(args) => {
            let record = service.get_event_including_archived(&args.id)?;
            if matches!(
                record.category(),
                HealthCategory::Bowel | HealthCategory::Medication
            ) {
                return validation("id", "does not identify a metric event");
            }
            print_record(&record, args.format, event_table)
        }
        MetricCommand::Archive(args) => transition_event(service, args, true, EventKind::Metric),
        MetricCommand::Restore(args) => transition_event(service, args, false, EventKind::Metric),
        MetricCommand::Purge(args) => purge_event(service, args, EventKind::Metric),
    }
}

fn update_metric(service: &mut Service, args: MetricUpdateArgs) -> HealthResult<()> {
    let id = args.id.clone();
    let input = if let Some(json) = args.json {
        strict_json::<MetricUpdateInput>(&json)?
    } else {
        MetricUpdateInput {
            at: args.at,
            name: args.name,
            value: args.value,
            unit: args.unit,
            condition_note: args.condition_note,
            note: args.note,
            clear_note: args.clear_note,
            expected_updated_at: args.expected_updated_at,
            reason: args.reason,
        }
    };
    let current = service.get_event(&id)?;
    let details = update_metric_details(current.details()?, &input)?;
    print_json(&service.update_event(&id, event_update(input.common(), Some(details))?)?)
}

fn metric_list(service: &Service, args: MetricListArgs) -> HealthResult<()> {
    if args.category.is_some_and(|category| {
        matches!(
            category,
            HealthEventCategoryArg::Bowel | HealthEventCategoryArg::Medication
        )
    }) {
        return validation("category", "must be weight, sleep, lab, or symptom");
    }
    let mut query = EventQuery::new(page(args.page.offset, args.page.limit)?);
    if let Some(category) = args.category {
        query = query.with_category(category.into());
    }
    if let Some(key) = args.key {
        query = query.with_metric_key(key)?;
    }
    let records = service
        .list_events(query)?
        .into_iter()
        .filter(|event| {
            !matches!(
                event.category(),
                HealthCategory::Bowel | HealthCategory::Medication
            )
        })
        .collect::<Vec<_>>();
    print_event_list(&records, args.page.format)
}

fn list_events(
    service: &Service,
    category: HealthCategory,
    key: Option<&str>,
    args: HealthPageArgs,
) -> HealthResult<()> {
    let mut query = EventQuery::new(page(args.offset, args.limit)?).with_category(category);
    if let Some(key) = key {
        query = query.with_metric_key(key)?;
    }
    print_event_list(&service.list_events(query)?, args.format)
}

fn show_event_category(
    service: &Service,
    args: HealthIdentityReadArgs,
    category: HealthCategory,
) -> HealthResult<()> {
    let record = service.get_event_including_archived(&args.id)?;
    if record.category() != category {
        return validation("id", "does not identify the requested event type");
    }
    print_record(&record, args.format, event_table)
}

fn transition_event(
    service: &mut Service,
    args: HealthIdentityArgs,
    archive: bool,
    kind: EventKind,
) -> HealthResult<()> {
    ensure_event_kind(&service.get_event_including_archived(&args.id)?, kind)?;
    let expected =
        parse_optional_timestamp(args.expected_updated_at.as_deref(), "expected_updated_at")?;
    let event = if archive {
        service.archive_event_if_current(&args.id, expected)?
    } else {
        service.restore_event_if_current(&args.id, expected)?
    };
    print_json(&event)
}

fn purge_diet(service: &mut Service, args: HealthPurgeArgs) -> HealthResult<()> {
    if service
        .get_diet_including_archived(&args.id)?
        .deleted_at()
        .is_none()
    {
        return Err(HealthError::Conflict(
            "diet entry must be archived before purge".to_string(),
        ));
    }
    purge_preview_or_confirm(&args)?;
    service.purge_diet(&args.id, args.confirm.as_deref().unwrap_or_default())?;
    print_json(&PurgeResult {
        purged: true,
        id: args.id,
    })
}

fn purge_event(service: &mut Service, args: HealthPurgeArgs, kind: EventKind) -> HealthResult<()> {
    let event = service.get_event_including_archived(&args.id)?;
    ensure_event_kind(&event, kind)?;
    if event.deleted_at().is_none() {
        return Err(HealthError::Conflict(
            "health event must be archived before purge".to_string(),
        ));
    }
    purge_preview_or_confirm(&args)?;
    service.purge_event(&args.id, args.confirm.as_deref().unwrap_or_default())?;
    print_json(&PurgeResult {
        purged: true,
        id: args.id,
    })
}

#[derive(Clone, Copy)]
enum EventKind {
    Bowel,
    Medication,
    Metric,
}

fn ensure_event_kind(event: &HealthEvent, kind: EventKind) -> HealthResult<()> {
    let valid = match kind {
        EventKind::Bowel => event.category() == HealthCategory::Bowel,
        EventKind::Medication => event.category() == HealthCategory::Medication,
        EventKind::Metric => !matches!(
            event.category(),
            HealthCategory::Bowel | HealthCategory::Medication
        ),
    };
    if valid {
        Ok(())
    } else {
        validation("id", "does not identify the requested event type")
    }
}

fn purge_preview_or_confirm(args: &HealthPurgeArgs) -> HealthResult<()> {
    if args.confirm.is_none() {
        print_json(&PurgePreview {
            confirmation_id: &args.id,
        })?;
        return Err(HealthError::ConfirmationMismatch);
    }
    Ok(())
}

fn timeline(service: &Service, args: HealthTimelineArgs) -> HealthResult<()> {
    let mut query = HealthQuery::new(page(args.offset, args.limit)?)
        .with_range(
            parse_optional_timestamp(args.from.as_deref(), "from")?,
            parse_optional_timestamp(args.to.as_deref(), "to")?,
        )?
        .include_archived(args.include_archived);
    if let Some(category) = args.category {
        query = query.with_category(category.into());
    }
    let records = service.timeline(query)?;
    match args.format {
        OutputFormat::Json => print_json(&records),
        OutputFormat::Table => {
            println!("KIND\tID\tOCCURRED_AT\tCATEGORY\tNAME\tVALUE");
            for item in records {
                match item {
                    TimelineItem::Diet { record } => println!(
                        "diet\t{}\t{}\tdiet\t{}\t",
                        record.id().as_str(),
                        format_timestamp(record.occurred_at())?,
                        cell(record.food_name()),
                    ),
                    TimelineItem::HealthEvent { record } => println!(
                        "health_event\t{}\t{}\t{}\t{}\t{}",
                        record.id().as_str(),
                        format_timestamp(record.occurred_at())?,
                        category_name(record.category()),
                        cell(record.name()),
                        record
                            .value_num()
                            .map(|value| value.to_string())
                            .unwrap_or_default(),
                    ),
                }
            }
            Ok(())
        }
    }
}

fn trends(service: &Service, args: HealthTrendsArgs) -> HealthResult<()> {
    let trends = service.trends(args.days)?;
    match args.format {
        OutputFormat::Json => print_json(&trends),
        OutputFormat::Table => print_trends_table(&trends),
    }
}

fn print_trends_table(trends: &HealthTrends) -> HealthResult<()> {
    println!("SECTION\tNAME\tVALUE");
    for item in &trends.top_diet_tags {
        println!("diet_tag\t{}\t{}", cell(&item.name), item.count);
    }
    for item in &trends.symptom_frequencies {
        println!("symptom\t{}\t{}", cell(&item.name), item.count);
    }
    for item in &trends.medication_frequencies {
        println!("medication\t{}\t{}", cell(&item.name), item.count);
    }
    println!("disclaimer\t\t{}", cell(trends.reaction_disclaimer));
    Ok(())
}

fn metric_details(input: &MetricInput) -> HealthResult<HealthEventDetails> {
    let category = parse_metric_category(&input.category)?;
    let name = required(input.name.clone(), "name")?;
    let value = required(input.value, "value")?;
    Ok(match category {
        HealthMetricCategory::Weight => HealthEventDetails::Weight(WeightAttributes::new(
            input
                .key
                .clone()
                .unwrap_or_else(|| "body_weight".to_string()),
            name,
            value,
            required(input.unit.clone(), "unit")?,
        )?),
        HealthMetricCategory::Sleep => HealthEventDetails::Sleep(SleepAttributes::new(
            input
                .key
                .clone()
                .unwrap_or_else(|| "sleep_duration".to_string()),
            name,
            SleepValue::hours(value)?,
        )?),
        HealthMetricCategory::Lab => HealthEventDetails::Lab(LabAttributes::new(
            required(input.key.clone(), "key")?,
            name,
            value,
            input.unit.as_deref(),
        )?),
        HealthMetricCategory::Symptom => HealthEventDetails::Symptom(SymptomAttributes::new(
            required(input.key.clone(), "key")?,
            name,
            strict_score(value)?,
            input.condition_note.as_deref(),
        )?),
        HealthMetricCategory::OverallCondition => {
            HealthEventDetails::Symptom(SymptomAttributes::overall_condition(
                name,
                strict_score(value)?,
                input.condition_note.as_deref(),
            )?)
        }
    })
}

fn update_metric_details(
    before: HealthEventDetails,
    input: &MetricUpdateInput,
) -> HealthResult<HealthEventDetails> {
    let name = |old: &str| input.name.clone().unwrap_or_else(|| old.to_string());
    Ok(match before {
        HealthEventDetails::Weight(old) => HealthEventDetails::Weight(WeightAttributes::new(
            old.metric_key().as_str(),
            name(old.name()),
            input.value.unwrap_or(old.value().get()),
            input.unit.clone().unwrap_or_else(|| old.unit().to_string()),
        )?),
        HealthEventDetails::Sleep(old) => HealthEventDetails::Sleep(SleepAttributes::new(
            old.metric_key().as_str(),
            name(old.name()),
            SleepValue::hours(input.value.unwrap_or(old.hours().get()))?,
        )?),
        HealthEventDetails::Lab(old) => HealthEventDetails::Lab(LabAttributes::new(
            old.metric_key().as_str(),
            name(old.name()),
            input.value.unwrap_or(old.value()),
            input.unit.as_deref().or(old.unit()),
        )?),
        HealthEventDetails::Symptom(old) => HealthEventDetails::Symptom(SymptomAttributes::new(
            old.metric_key().as_str(),
            name(old.name()),
            input
                .value
                .map(strict_score)
                .transpose()?
                .unwrap_or(old.score()),
            input.condition_note.as_deref().or(old.condition_note()),
        )?),
        HealthEventDetails::Bowel(_) | HealthEventDetails::Medication(_) => {
            return validation("id", "does not identify a metric event");
        }
    })
}

fn event_update(
    input: CommonUpdate,
    details: Option<HealthEventDetails>,
) -> HealthResult<UpdateHealthEvent> {
    Ok(UpdateHealthEvent {
        occurred_at: parse_optional_timestamp(input.at.as_deref(), "at")?,
        details,
        note: optional_clear(input.note, input.clear_note, "note")?,
        expected_updated_at: parse_optional_timestamp(
            input.expected_updated_at.as_deref(),
            "expected_updated_at",
        )?,
        actor: ACTOR.to_string(),
        reason: input.reason,
    })
}

fn read_upload(input: ImageInput) -> HealthResult<MediaUpload> {
    let metadata = std::fs::metadata(&input.path).map_err(|_| HealthError::Validation {
        field: "image",
        message: "cannot be opened".to_string(),
    })?;
    if !metadata.is_file() {
        return validation("image", "must be a regular file");
    }
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err(HealthError::MediaTooLarge);
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(&input.path)
        .and_then(|file| file.take(MAX_IMAGE_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|_| HealthError::Validation {
            field: "image",
            message: "could not be read".to_string(),
        })?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(HealthError::MediaTooLarge);
    }
    if bytes.len() as u64 != metadata.len() {
        return validation("image", "changed while it was being read");
    }
    let detected = infer::get(&bytes)
        .map(|kind| kind.mime_type())
        .filter(|mime| matches!(*mime, "image/jpeg" | "image/png" | "image/webp"))
        .ok_or(HealthError::UnsupportedMedia)?;
    if input
        .content_type
        .as_deref()
        .is_some_and(|declared| declared != detected)
    {
        return Err(HealthError::UnsupportedMedia);
    }
    Ok(MediaUpload::new(detected, bytes))
}

fn diet_add_input(args: DietAddArgs) -> HealthResult<DietInput> {
    if let Some(json) = args.json {
        return strict_json(&json);
    }
    Ok(DietInput {
        at: required(args.at, "at")?,
        meal: required(args.meal, "meal")?,
        food: required(args.food, "food")?,
        note: args.note,
        tags: args.tags,
        image: args.image.map(|path| ImageInput {
            path,
            content_type: args.content_type,
        }),
    })
}

fn bowel_add_input(args: BowelAddArgs) -> HealthResult<BowelInput> {
    if let Some(json) = args.json {
        return strict_json(&json);
    }
    Ok(BowelInput {
        at: required(args.at, "at")?,
        bristol: required(args.bristol, "bristol")?,
        blood_visible: args.blood_visible,
        note: args.note,
    })
}

fn medication_add_input(args: MedicationAddArgs) -> HealthResult<MedicationInput> {
    if let Some(json) = args.json {
        return strict_json(&json);
    }
    Ok(MedicationInput {
        at: required(args.at, "at")?,
        name: required(args.name, "name")?,
        dose: required(args.dose, "dose")?,
        unit: required(args.unit, "unit")?,
        note: args.note,
    })
}

fn metric_add_input(args: MetricAddArgs) -> HealthResult<MetricInput> {
    if let Some(json) = args.json {
        return strict_json(&json);
    }
    Ok(MetricInput {
        at: required(args.at, "at")?,
        category: metric_category_arg(required(args.category, "category")?),
        key: args.key,
        name: args.name,
        value: args.value,
        unit: args.unit,
        condition_note: args.condition_note,
        note: args.note,
    })
}

fn parse_timestamp(value: &str, field: &'static str) -> HealthResult<OffsetDateTime> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| HealthError::Validation {
        field,
        message: "must be RFC3339".to_string(),
    })
}

fn parse_optional_timestamp(
    value: Option<&str>,
    field: &'static str,
) -> HealthResult<Option<OffsetDateTime>> {
    value.map(|value| parse_timestamp(value, field)).transpose()
}

fn format_timestamp(value: OffsetDateTime) -> HealthResult<String> {
    value
        .format(&Rfc3339)
        .map_err(|_| HealthError::Storage("could not format a stored timestamp".to_string()))
}

fn page(offset: u32, limit: u16) -> HealthResult<Page> {
    Page::new(offset, limit)
}

fn optional_clear<T>(
    value: Option<T>,
    clear: bool,
    field: &'static str,
) -> HealthResult<Option<Option<T>>> {
    if value.is_some() && clear {
        return validation(field, "cannot be set and cleared together");
    }
    Ok(if clear { Some(None) } else { value.map(Some) })
}

fn strict_score(value: f64) -> HealthResult<u8> {
    if !value.is_finite() || value.fract() != 0.0 || !(1.0..=10.0).contains(&value) {
        return validation("value", "must be an integer from 1 through 10");
    }
    Ok(value as u8)
}

fn strict_json<T: for<'de> Deserialize<'de>>(json: &str) -> HealthResult<T> {
    serde_json::from_str(json).map_err(|_| HealthError::Validation {
        field: "json",
        message: "must match the documented strict JSON shape".to_string(),
    })
}

fn required<T>(value: Option<T>, field: &'static str) -> HealthResult<T> {
    value.ok_or_else(|| HealthError::Validation {
        field,
        message: "is required".to_string(),
    })
}

fn validation<T>(field: &'static str, message: impl Into<String>) -> HealthResult<T> {
    Err(HealthError::Validation {
        field,
        message: message.into(),
    })
}

fn print_json(value: &(impl Serialize + ?Sized)) -> HealthResult<()> {
    let document = serde_json::to_string(value)
        .map_err(|_| HealthError::Storage("could not serialize output".to_string()))?;
    println!("{document}");
    Ok(())
}

fn print_record<T: Serialize>(
    record: &T,
    format: OutputFormat,
    table: fn(&T) -> HealthResult<()>,
) -> HealthResult<()> {
    match format {
        OutputFormat::Json => print_json(record),
        OutputFormat::Table => table(record),
    }
}

fn print_diet_list(
    records: &[health_engine::domain::DietEntry],
    format: OutputFormat,
) -> HealthResult<()> {
    match format {
        OutputFormat::Json => print_json(records),
        OutputFormat::Table => {
            println!("ID\tOCCURRED_AT\tMEAL\tFOOD\tTAGS\tARCHIVED");
            for record in records {
                println!(
                    "{}\t{}\t{}\t{}\t{}\t{}",
                    record.id().as_str(),
                    format_timestamp(record.occurred_at())?,
                    record.meal_type(),
                    cell(record.food_name()),
                    cell(&record.tags().join(",")),
                    record.is_deleted(),
                );
            }
            Ok(())
        }
    }
}

fn print_event_list(records: &[HealthEvent], format: OutputFormat) -> HealthResult<()> {
    match format {
        OutputFormat::Json => print_json(records),
        OutputFormat::Table => {
            println!("ID\tOCCURRED_AT\tCATEGORY\tKEY\tNAME\tVALUE\tUNIT\tARCHIVED");
            for record in records {
                println!(
                    "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                    record.id().as_str(),
                    format_timestamp(record.occurred_at())?,
                    category_name(record.category()),
                    record.metric_key().as_str(),
                    cell(record.name()),
                    record
                        .value_num()
                        .map(|value| value.to_string())
                        .unwrap_or_default(),
                    record.unit().unwrap_or_default(),
                    record.is_deleted(),
                );
            }
            Ok(())
        }
    }
}

fn diet_table(record: &health_engine::domain::DietEntry) -> HealthResult<()> {
    println!("FIELD\tVALUE");
    println!("id\t{}", record.id().as_str());
    println!("occurred_at\t{}", format_timestamp(record.occurred_at())?);
    println!("meal_type\t{}", record.meal_type());
    println!("food_name\t{}", cell(record.food_name()));
    println!("tags\t{}", cell(&record.tags().join(",")));
    println!("archived\t{}", record.is_deleted());
    Ok(())
}

fn event_table(record: &HealthEvent) -> HealthResult<()> {
    println!("FIELD\tVALUE");
    println!("id\t{}", record.id().as_str());
    println!("occurred_at\t{}", format_timestamp(record.occurred_at())?);
    println!("category\t{}", category_name(record.category()));
    println!("metric_key\t{}", record.metric_key().as_str());
    println!("name\t{}", cell(record.name()));
    println!(
        "value\t{}",
        record
            .value_num()
            .map(|value| value.to_string())
            .unwrap_or_default()
    );
    println!("unit\t{}", record.unit().unwrap_or_default());
    println!("archived\t{}", record.is_deleted());
    Ok(())
}

fn cell(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if matches!(character, '\t' | '\n' | '\r') || character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect()
}

fn category_name(category: HealthCategory) -> &'static str {
    match category {
        HealthCategory::Weight => "weight",
        HealthCategory::Bowel => "bowel",
        HealthCategory::Sleep => "sleep",
        HealthCategory::Lab => "lab",
        HealthCategory::Symptom => "symptom",
        HealthCategory::Medication => "medication",
    }
}

impl From<HealthEventCategoryArg> for HealthCategory {
    fn from(value: HealthEventCategoryArg) -> Self {
        match value {
            HealthEventCategoryArg::Weight => Self::Weight,
            HealthEventCategoryArg::Bowel => Self::Bowel,
            HealthEventCategoryArg::Sleep => Self::Sleep,
            HealthEventCategoryArg::Lab => Self::Lab,
            HealthEventCategoryArg::Symptom => Self::Symptom,
            HealthEventCategoryArg::Medication => Self::Medication,
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum HealthMetricCategory {
    Weight,
    Sleep,
    Lab,
    Symptom,
    OverallCondition,
}

fn metric_category_arg(value: HealthMetricCategoryArg) -> String {
    match value {
        HealthMetricCategoryArg::Weight => "weight",
        HealthMetricCategoryArg::Sleep => "sleep",
        HealthMetricCategoryArg::Lab => "lab",
        HealthMetricCategoryArg::Symptom => "symptom",
        HealthMetricCategoryArg::OverallCondition => "overall_condition",
    }
    .to_string()
}

fn parse_metric_category(value: &str) -> HealthResult<HealthMetricCategory> {
    match value {
        "weight" => Ok(HealthMetricCategory::Weight),
        "sleep" => Ok(HealthMetricCategory::Sleep),
        "lab" => Ok(HealthMetricCategory::Lab),
        "symptom" => Ok(HealthMetricCategory::Symptom),
        "overall_condition" => Ok(HealthMetricCategory::OverallCondition),
        _ => validation(
            "category",
            "must be weight, sleep, lab, symptom, or overall_condition",
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ImageInput {
    path: std::path::PathBuf,
    #[serde(default)]
    content_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DietInput {
    at: String,
    meal: String,
    food: String,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    image: Option<ImageInput>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DietUpdateInput {
    #[serde(default)]
    at: Option<String>,
    #[serde(default)]
    meal: Option<String>,
    #[serde(default)]
    food: Option<String>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    clear_note: bool,
    #[serde(default)]
    tags: Option<Vec<String>>,
    #[serde(default)]
    image: Option<ImageInput>,
    #[serde(default)]
    remove_image: bool,
    #[serde(default)]
    expected_updated_at: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BowelInput {
    at: String,
    bristol: u8,
    #[serde(default)]
    blood_visible: bool,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BowelUpdateInput {
    #[serde(default)]
    at: Option<String>,
    #[serde(default)]
    bristol: Option<u8>,
    #[serde(default)]
    blood_visible: Option<bool>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    clear_note: bool,
    #[serde(default)]
    expected_updated_at: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

impl BowelUpdateInput {
    fn common(&self) -> CommonUpdate {
        CommonUpdate::new(
            self.at.clone(),
            self.note.clone(),
            self.clear_note,
            self.expected_updated_at.clone(),
            self.reason.clone(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MedicationInput {
    at: String,
    name: String,
    dose: f64,
    unit: String,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MedicationUpdateInput {
    #[serde(default)]
    at: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    dose: Option<f64>,
    #[serde(default)]
    unit: Option<String>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    clear_note: bool,
    #[serde(default)]
    expected_updated_at: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

impl MedicationUpdateInput {
    fn common(&self) -> CommonUpdate {
        CommonUpdate::new(
            self.at.clone(),
            self.note.clone(),
            self.clear_note,
            self.expected_updated_at.clone(),
            self.reason.clone(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MetricInput {
    at: String,
    category: String,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    value: Option<f64>,
    #[serde(default)]
    unit: Option<String>,
    #[serde(default)]
    condition_note: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MetricUpdateInput {
    #[serde(default)]
    at: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    value: Option<f64>,
    #[serde(default)]
    unit: Option<String>,
    #[serde(default)]
    condition_note: Option<String>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    clear_note: bool,
    #[serde(default)]
    expected_updated_at: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

impl MetricUpdateInput {
    fn common(&self) -> CommonUpdate {
        CommonUpdate::new(
            self.at.clone(),
            self.note.clone(),
            self.clear_note,
            self.expected_updated_at.clone(),
            self.reason.clone(),
        )
    }
}

struct CommonUpdate {
    at: Option<String>,
    note: Option<String>,
    clear_note: bool,
    expected_updated_at: Option<String>,
    reason: Option<String>,
}

impl CommonUpdate {
    fn new(
        at: Option<String>,
        note: Option<String>,
        clear_note: bool,
        expected_updated_at: Option<String>,
        reason: Option<String>,
    ) -> Self {
        Self {
            at,
            note,
            clear_note,
            expected_updated_at,
            reason,
        }
    }
}

#[derive(Serialize)]
struct PurgePreview<'a> {
    confirmation_id: &'a str,
}

#[derive(Serialize)]
struct PurgeResult {
    purged: bool,
    id: String,
}
