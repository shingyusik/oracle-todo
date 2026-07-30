use health_engine::domain::{
    DietEntry, DietEntryRehydration, HealthRecordId, MealType, MediaReference, NewDietEntry,
    ValidationError, normalize_tags,
};
use serde_json::json;
use time::{OffsetDateTime, macros::datetime};

const DIET_ID: &str = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID: &str = "22222222-2222-4222-8222-222222222222";

#[test]
fn meal_types_and_tags_use_canonical_deterministic_contracts() {
    assert_eq!(
        normalize_tags(["WHEAT", " Coffee ", "ＳＴＲＡＳＳＥ", "Straße", ""]),
        vec!["coffee", "strasse", "wheat"],
    );
    assert_eq!(
        "late_night".parse::<MealType>().unwrap(),
        MealType::LateNight
    );
    assert_eq!(
        serde_json::to_value(MealType::LateNight).unwrap(),
        json!("late_night")
    );
    assert!(serde_json::from_value::<MealType>(json!("LATE_NIGHT")).is_err());
}

#[test]
fn new_diet_input_trims_content_normalizes_utc_and_owns_no_id() {
    let input = NewDietEntry::new(
        parse_timestamp("2026-07-30T21:30:00+09:00"),
        MealType::Dinner,
        "  Bibimbap  ",
        Some("  family dinner  "),
        [" Spicy ", "SPICY", "채소"],
        Some(MediaReference::new(MEDIA_ID).unwrap()),
    )
    .unwrap();

    assert_eq!(input.occurred_at(), datetime!(2026-07-30 12:30:00 UTC));
    assert_eq!(input.food_name(), "Bibimbap");
    assert_eq!(input.note(), Some("family dinner"));
    assert_eq!(input.tags(), ["spicy", "채소"]);
    assert_eq!(input.media_id().map(MediaReference::as_str), Some(MEDIA_ID));
    assert_eq!(
        serde_json::to_value(&input).unwrap(),
        json!({
            "occurred_at": "2026-07-30T12:30:00Z",
            "meal_type": "dinner",
            "food_name": "Bibimbap",
            "note": "family dinner",
            "tags": ["spicy", "채소"],
            "media_id": MEDIA_ID
        })
    );
}

#[test]
fn new_diet_json_cannot_bypass_required_fields_or_tag_bounds() {
    let blank_food = json!({
        "occurred_at": "2026-07-30T12:30:00Z",
        "meal_type": "lunch",
        "food_name": " ",
        "note": null,
        "tags": [],
        "media_id": null
    });
    assert!(serde_json::from_value::<NewDietEntry>(blank_food).is_err());

    let blank_note = json!({
        "occurred_at": "2026-07-30T12:30:00Z",
        "meal_type": "lunch",
        "food_name": "Rice",
        "note": " ",
        "tags": [],
        "media_id": null
    });
    assert!(serde_json::from_value::<NewDietEntry>(blank_note).is_err());

    let too_many_tags = (0..21).map(|index| format!("tag-{index}"));
    assert_eq!(
        NewDietEntry::new(
            datetime!(2026-07-30 12:30:00 UTC),
            MealType::Lunch,
            "Rice",
            None,
            too_many_tags,
            None,
        ),
        Err(ValidationError::TooManyTags { maximum: 20 })
    );
    assert_eq!(
        NewDietEntry::new(
            datetime!(2026-07-30 12:30:00 UTC),
            MealType::Lunch,
            "Rice",
            None,
            ["x".repeat(41)],
            None,
        ),
        Err(ValidationError::TagTooLong { maximum: 40 })
    );
}

#[test]
fn diet_limits_apply_to_raw_input_before_canonicalization() {
    let at = datetime!(2026-07-30 12:30:00 UTC);
    assert!(NewDietEntry::new(at, MealType::Lunch, "한".repeat(120), None, ["tag"], None,).is_ok());
    assert!(
        NewDietEntry::new(at, MealType::Lunch, "한".repeat(121), None, ["tag"], None,).is_err()
    );

    assert!(NewDietEntry::new(at, MealType::Lunch, "Rice", None, vec!["same"; 21], None,).is_err());
    assert!(
        NewDietEntry::new(
            at,
            MealType::Lunch,
            "Rice",
            None,
            [format!(" {} ", "x".repeat(40))],
            None,
        )
        .is_err()
    );
}

#[test]
fn omitted_diet_tags_deserialize_as_an_empty_list() {
    let input: NewDietEntry = serde_json::from_value(json!({
        "occurred_at": "2026-07-30T12:30:00Z",
        "meal_type": "lunch",
        "food_name": "Rice",
        "note": null,
        "media_id": null
    }))
    .unwrap();

    assert!(input.tags().is_empty());
    assert_eq!(serde_json::to_value(input).unwrap()["tags"], json!([]));
}

#[test]
fn media_references_require_canonical_uuid_v4_metadata_ids() {
    let id = HealthRecordId::parse(MEDIA_ID).unwrap();
    assert_eq!(id.as_str(), MEDIA_ID);
    assert_eq!(serde_json::to_value(&id).unwrap(), json!(MEDIA_ID));
    let media = serde_json::from_value::<MediaReference>(json!(MEDIA_ID)).unwrap();
    assert_eq!(media.as_str(), MEDIA_ID);
    assert_eq!(serde_json::to_value(media).unwrap(), json!(MEDIA_ID));

    assert!(MediaReference::new(format!(" {MEDIA_ID}")).is_err());
    assert!(serde_json::from_value::<MediaReference>(json!(" \n ")).is_err());
    assert!(MediaReference::new("../media/health/evil.webp").is_err());
    assert!(HealthRecordId::parse("11111111-1111-1111-8111-111111111111").is_err());
    assert!(HealthRecordId::parse("11111111111141118111111111111111").is_err());
    assert!(HealthRecordId::parse("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA").is_err());
}

#[test]
fn diet_rehydration_normalizes_timestamps_and_exposes_deleted_state() {
    let mut record = diet_record();
    record.deleted_at = Some(parse_timestamp("2026-07-31T10:00:00+09:00"));
    record.updated_at = parse_timestamp("2026-07-31T10:00:00+09:00");

    let entry = DietEntry::rehydrate(record).unwrap();

    assert_eq!(entry.id().as_str(), DIET_ID);
    assert_eq!(entry.occurred_at(), datetime!(2026-07-30 12:30:00 UTC));
    assert_eq!(entry.created_at(), datetime!(2026-07-30 12:31:00 UTC));
    assert_eq!(entry.updated_at(), datetime!(2026-07-31 01:00:00 UTC));
    assert_eq!(entry.deleted_at(), Some(datetime!(2026-07-31 01:00:00 UTC)));
    assert!(entry.is_deleted());
    assert_eq!(
        serde_json::to_value(&entry).unwrap(),
        json!({
            "id": DIET_ID,
            "occurred_at": "2026-07-30T12:30:00Z",
            "meal_type": "dinner",
            "food_name": "Bibimbap",
            "note": null,
            "tags": ["spicy", "채소"],
            "media_id": MEDIA_ID,
            "created_at": "2026-07-30T12:31:00Z",
            "updated_at": "2026-07-31T01:00:00Z",
            "deleted_at": "2026-07-31T01:00:00Z"
        })
    );
}

#[test]
fn diet_rehydration_rejects_impossible_lifecycle_order() {
    let mut updated_before_created = diet_record();
    updated_before_created.updated_at = datetime!(2026-07-30 12:30:59 UTC);
    assert_eq!(
        DietEntry::rehydrate(updated_before_created),
        Err(ValidationError::InvalidLifecycle)
    );

    let mut deletion_after_update = diet_record();
    deletion_after_update.deleted_at = Some(datetime!(2026-07-30 12:32:00 UTC));
    assert_eq!(
        DietEntry::rehydrate(deletion_after_update),
        Err(ValidationError::InvalidLifecycle)
    );
}

#[test]
fn diet_rejects_programmatic_timestamps_that_rfc3339_cannot_format() {
    let extreme = datetime!(-9999-01-01 0:00 UTC);
    assert!(NewDietEntry::new(extreme, MealType::Lunch, "Rice", None, ["plain"], None,).is_err());

    let mut record = diet_record();
    record.created_at = extreme;
    assert!(DietEntry::rehydrate(record).is_err());
}

#[test]
fn diet_rehydration_rejects_noncanonical_or_non_v4_identity() {
    for invalid in [
        "not-a-uuid",
        "11111111-1111-1111-8111-111111111111",
        "11111111111141118111111111111111",
        "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    ] {
        let mut record = diet_record();
        record.id = invalid.to_string();
        assert!(DietEntry::rehydrate(record).is_err());
    }
}

fn diet_record() -> DietEntryRehydration {
    DietEntryRehydration {
        id: DIET_ID.to_string(),
        occurred_at: parse_timestamp("2026-07-30T21:30:00+09:00"),
        meal_type: MealType::Dinner,
        food_name: " Bibimbap ".to_string(),
        note: None,
        tags: vec![
            "채소".to_string(),
            " SPICY ".to_string(),
            "spicy".to_string(),
        ],
        media_id: Some(MEDIA_ID.to_string()),
        created_at: parse_timestamp("2026-07-30T21:31:00+09:00"),
        updated_at: parse_timestamp("2026-07-30T21:31:00+09:00"),
        deleted_at: None,
    }
}

fn parse_timestamp(value: &str) -> OffsetDateTime {
    OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).unwrap()
}
