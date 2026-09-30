use std::str::FromStr;

use anyhow::Result;
use health_engine::application::commands::{
    CreateDietEntry, CreateHealthEvent, DailyMetricInput, DietMediaUpdate, MediaUpload,
    UpdateDietEntry, UpdateHealthEvent,
};
use health_engine::application::error::{HealthError, HealthResult};
use health_engine::application::ports::{EventClass, EventQuery, Page};
use health_engine::application::service::HealthService;
use health_engine::domain::{
    BowelAttributes, HealthCategory, HealthEvent, HealthEventDetails, LabAttributes, MealType,
    MedicationAttributes, MedicationUnit, SleepAttributes, SleepValue, SymptomAttributes,
    WeightAttributes,
};
use health_engine::infrastructure::media::{LocalMediaStore, read_bounded_regular_file};
use health_engine::infrastructure::sqlite::{HealthStorageHealth, SqliteHealthRepository};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::cli::{
    BowelAddArgs, BowelCommand, BowelUpdateArgs, DietAddArgs, DietCommand, DietUpdateArgs,
    HealthAuditArgs, HealthCommand, HealthEventCategoryArg, HealthIdentityArgs,
    HealthIdentityReadArgs, HealthPageArgs, MedicationAddArgs, MedicationCommand,
    MedicationUpdateArgs, MetricCommand, MetricDailyUpsertArgs, MetricListArgs, OutputFormat,
    ReportRangeArgs,
};
use crate::config::RavenPaths;

type Service = HealthService<SqliteHealthRepository, LocalMediaStore>;

const ACTOR: &str = "raven-cli";
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

macro_rules! table_row {
    ($($value:expr),+ $(,)?) => {
        print_table_row(&[$(($value).to_string()),+])
    };
}

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
        HealthCommand::Reports(_) | HealthCommand::Audit(_) => false,
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
        SqliteHealthRepository::open_read_only(paths.health_db())?,
        LocalMediaStore::open_existing(paths.health_media_dir())?,
    ))
}

fn execute(service: &mut Service, command: HealthCommand) -> HealthResult<()> {
    match command {
        HealthCommand::Diet { command } => diet(service, command),
        HealthCommand::Bowel { command } => bowel(service, command),
        HealthCommand::Medication { command } => medication(service, command),
        HealthCommand::Metric { command } => metric(service, command),
        HealthCommand::Reports(args) => reports(service, args),
        HealthCommand::Audit(args) => audit(service, args),
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
            let (entries, next) =
                read_page(args.offset, args.limit, |page| service.list_diet(page))?;
            print_diet_list(&entries, next, args.format)
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
            reason: None,
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
        MetricCommand::DailyUpsert(MetricDailyUpsertArgs { json }) => {
            let inputs = strict_json::<Vec<MetricInput>>(&json)?;
            let mut commands = Vec::with_capacity(inputs.len());
            for input in inputs {
                commands.push(DailyMetricInput {
                    occurred_at: parse_timestamp(&input.at, "at")?,
                    details: metric_details(&input)?,
                    note: None,
                    actor: ACTOR.to_string(),
                    expected_updated_at: parse_optional_timestamp(
                        input.expected_updated_at.as_deref(),
                        "expected_updated_at",
                    )?,
                });
            }
            print_json(&service.upsert_daily_metrics(commands)?)
        }
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
    }
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
    let (records, next) = read_page(args.page.offset, args.page.limit, |page| {
        let mut query = EventQuery::new(page).with_class(EventClass::Metric);
        if let Some(category) = args.category {
            query = query.with_category(category.into());
        }
        if let Some(key) = &args.key {
            query = query.with_metric_key(key)?;
        }
        service.list_events(query)
    })?;
    print_event_list(&records, next, args.page.format)
}

fn list_events(
    service: &Service,
    category: HealthCategory,
    key: Option<&str>,
    args: HealthPageArgs,
) -> HealthResult<()> {
    let (records, next) = read_page(args.offset, args.limit, |page| {
        let mut query = EventQuery::new(page).with_category(category);
        if let Some(key) = key {
            query = query.with_metric_key(key)?;
        }
        service.list_events(query)
    })?;
    print_event_list(&records, next, args.format)
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

fn reports(service: &Service, args: ReportRangeArgs) -> HealthResult<()> {
    let parse = |value: &str, field| {
        time::Date::parse(
            value,
            time::macros::format_description!("[year]-[month]-[day]"),
        )
        .map_err(|_| HealthError::Validation {
            field,
            message: "must be YYYY-MM-DD".to_string(),
        })
    };
    let report = service.reports(health_engine::application::reports::HealthReportRange {
        from: parse(&args.from, "from")?,
        to: parse(&args.to, "to")?,
    })?;
    match args.format {
        OutputFormat::Json => print_json(&report),
        OutputFormat::Table => {
            table_row!("SECTION", "CURRENT", "PREVIOUS");
            table_row!(
                "diet",
                optional_display(report.diet_count.current),
                optional_display(report.diet_count.previous)
            );
            table_row!(
                "bowel",
                optional_display(report.bowel.current_count),
                optional_display(report.bowel.previous_count)
            );
            table_row!(
                "medication",
                optional_display(report.medication_count.current),
                optional_display(report.medication_count.previous)
            );
            println!("{}", report.reaction_disclaimer);
            Ok(())
        }
    }
}

fn optional_display<T: std::fmt::Display>(value: Option<T>) -> String {
    value.map(|value| value.to_string()).unwrap_or_default()
}

fn audit(service: &Service, args: HealthAuditArgs) -> HealthResult<()> {
    let (events, next) = read_page(args.offset, args.limit, |page| {
        service.audit_for(&args.record_type, &args.record_id, page)
    })?;
    let rows: Vec<_> = events
        .iter()
        .map(|event| {
            Ok(serde_json::json!({
                "id": event.id(), "request_id": event.request_id(),
                "occurred_at": format_timestamp(event.occurred_at())?,
                "actor": event.actor(), "action": event.action(),
                "record_type": event.record_type(), "record_id": event.record_id(),
                "before": event.before(), "after": event.after(), "reason": event.reason(),
            }))
        })
        .collect::<HealthResult<Vec<_>>>()?;
    match args.format {
        OutputFormat::Json => print_json(&serde_json::json!({"items": rows, "next": next})),
        OutputFormat::Table => {
            table_row!("AT", "ACTION", "ACTOR", "REASON");
            for event in events {
                table_row!(
                    event.occurred_at(),
                    event.action(),
                    event.actor(),
                    event.reason().unwrap_or_default()
                );
            }
            Ok(())
        }
    }
}

fn metric_details(input: &MetricInput) -> HealthResult<HealthEventDetails> {
    let category = parse_metric_category(&input.category)?;
    validate_metric_add_fields(category, input)?;
    let name = input.name.clone().unwrap_or_else(|| {
        match category {
            HealthMetricCategory::Weight => "Body weight",
            HealthMetricCategory::Sleep => "Sleep duration",
            HealthMetricCategory::Lab if input.key.as_deref() == Some("crp") => "CRP",
            HealthMetricCategory::Lab => "Fecal calprotectin",
            HealthMetricCategory::OverallCondition => "Overall condition",
        }
        .into()
    });
    let value = required(input.value, "value")?;
    Ok(match category {
        HealthMetricCategory::Weight => HealthEventDetails::Weight(WeightAttributes::new(
            input
                .key
                .clone()
                .unwrap_or_else(|| "body_weight".to_string()),
            name,
            value,
            input.unit.clone().unwrap_or_else(|| "kg".into()),
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
        HealthMetricCategory::OverallCondition => {
            HealthEventDetails::Symptom(SymptomAttributes::overall_condition(
                name,
                strict_score(value)?,
                input.condition_note.as_deref(),
            )?)
        }
    })
}

fn validate_metric_add_fields(
    category: HealthMetricCategory,
    input: &MetricInput,
) -> HealthResult<()> {
    match category {
        HealthMetricCategory::Weight => {
            reject_present(input.condition_note.as_ref(), "condition_note", "weight")
        }
        HealthMetricCategory::Sleep => {
            reject_present(input.unit.as_ref(), "unit", "sleep")?;
            reject_present(input.condition_note.as_ref(), "condition_note", "sleep")
        }
        HealthMetricCategory::Lab => {
            reject_present(input.condition_note.as_ref(), "condition_note", "lab")
        }
        HealthMetricCategory::OverallCondition => {
            reject_present(input.key.as_ref(), "key", "overall_condition")?;
            reject_present(input.unit.as_ref(), "unit", "overall_condition")
        }
    }
}

fn reject_present<T>(value: Option<&T>, field: &'static str, category: &str) -> HealthResult<()> {
    if value.is_some() {
        return validation(field, format!("is not supported for {category}"));
    }
    Ok(())
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
        reason: None,
    })
}

fn read_upload(input: ImageInput) -> HealthResult<MediaUpload> {
    let bytes = read_bounded_regular_file(&input.path, MAX_IMAGE_BYTES)?;
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

// A one-row probe preserves the service's maximum page limit without loading all records.
fn read_page<T>(
    offset: u32,
    limit: u16,
    mut read: impl FnMut(Page) -> HealthResult<Vec<T>>,
) -> HealthResult<(Vec<T>, Option<u32>)> {
    let records = read(page(offset, limit)?)?;
    let next_offset = offset.checked_add(records.len() as u32);
    let next = if records.len() == usize::from(limit) {
        if let Some(next_offset) = next_offset {
            (!read(page(next_offset, 1)?)?.is_empty()).then_some(next_offset)
        } else {
            None
        }
    } else {
        None
    };
    Ok((records, next))
}

fn print_diet_list(
    records: &[health_engine::domain::DietEntry],
    next: Option<u32>,
    format: OutputFormat,
) -> HealthResult<()> {
    match format {
        OutputFormat::Json => print_json(&serde_json::json!({"items": records, "next": next})),
        OutputFormat::Table => {
            table_row!("ID", "OCCURRED_AT", "MEAL", "FOOD", "TAGS", "ARCHIVED");
            for record in records {
                table_row!(
                    record.id().as_str(),
                    format_timestamp(record.occurred_at())?,
                    record.meal_type(),
                    record.food_name(),
                    record.tags().join(","),
                    record.is_deleted(),
                );
            }
            Ok(())
        }
    }
}

fn print_event_list(
    records: &[HealthEvent],
    next: Option<u32>,
    format: OutputFormat,
) -> HealthResult<()> {
    match format {
        OutputFormat::Json => print_json(&serde_json::json!({"items": records, "next": next})),
        OutputFormat::Table => {
            table_row!(
                "ID",
                "OCCURRED_AT",
                "CATEGORY",
                "KEY",
                "NAME",
                "VALUE",
                "UNIT",
                "ARCHIVED"
            );
            for record in records {
                table_row!(
                    record.id().as_str(),
                    format_timestamp(record.occurred_at())?,
                    category_name(record.category()),
                    record.metric_key().as_str(),
                    record.name(),
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
    table_row!("FIELD", "VALUE");
    table_row!("id", record.id().as_str());
    table_row!("occurred_at", format_timestamp(record.occurred_at())?);
    table_row!("meal_type", record.meal_type());
    table_row!("food_name", record.food_name());
    table_row!("note", record.note().unwrap_or_default());
    table_row!("tags", record.tags().join(","));
    table_row!("archived", record.is_deleted());
    Ok(())
}

fn event_table(record: &HealthEvent) -> HealthResult<()> {
    table_row!("FIELD", "VALUE");
    table_row!("id", record.id().as_str());
    table_row!("occurred_at", format_timestamp(record.occurred_at())?);
    table_row!("category", category_name(record.category()));
    table_row!("metric_key", record.metric_key().as_str());
    table_row!("name", record.name());
    table_row!(
        "value",
        record
            .value_num()
            .map(|value| value.to_string())
            .unwrap_or_default()
    );
    table_row!("unit", record.unit().unwrap_or_default());
    table_row!("note", record.note().unwrap_or_default());
    table_row!("archived", record.is_deleted());
    Ok(())
}

fn print_table_row(values: &[String]) {
    println!(
        "{}",
        values
            .iter()
            .map(|value| cell(value))
            .collect::<Vec<_>>()
            .join("\t")
    );
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
    OverallCondition,
}

fn parse_metric_category(value: &str) -> HealthResult<HealthMetricCategory> {
    match value {
        "weight" => Ok(HealthMetricCategory::Weight),
        "sleep" => Ok(HealthMetricCategory::Sleep),
        "lab" => Ok(HealthMetricCategory::Lab),
        "overall_condition" => Ok(HealthMetricCategory::OverallCondition),
        _ => validation(
            "category",
            "must be weight, sleep, lab, or overall_condition",
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
}

impl BowelUpdateInput {
    fn common(&self) -> CommonUpdate {
        CommonUpdate::new(
            self.at.clone(),
            self.note.clone(),
            self.clear_note,
            self.expected_updated_at.clone(),
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
}

impl MedicationUpdateInput {
    fn common(&self) -> CommonUpdate {
        CommonUpdate::new(
            self.at.clone(),
            self.note.clone(),
            self.clear_note,
            self.expected_updated_at.clone(),
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
    expected_updated_at: Option<String>,
}

struct CommonUpdate {
    at: Option<String>,
    note: Option<String>,
    clear_note: bool,
    expected_updated_at: Option<String>,
}

impl CommonUpdate {
    fn new(
        at: Option<String>,
        note: Option<String>,
        clear_note: bool,
        expected_updated_at: Option<String>,
    ) -> Self {
        Self {
            at,
            note,
            clear_note,
            expected_updated_at,
        }
    }
}
