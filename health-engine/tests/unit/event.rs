use health_engine::domain::{
    BowelAttributes, HealthCategory, HealthEvent, HealthEventDetails, HealthEventRehydration,
    LabAttributes, MedicationAttributes, MedicationUnit, NewHealthEvent, SleepAttributes,
    SleepValue, SymptomAttributes, ValidationError, WeightAttributes, WeightValue,
};
use serde_json::json;
use time::{OffsetDateTime, macros::datetime};

#[test]
fn category_and_medication_unit_json_values_are_exact() {
    let categories = [
        (HealthCategory::Weight, "weight"),
        (HealthCategory::Bowel, "bowel"),
        (HealthCategory::Sleep, "sleep"),
        (HealthCategory::Lab, "lab"),
        (HealthCategory::Symptom, "symptom"),
        (HealthCategory::Medication, "medication"),
    ];
    for (category, expected) in categories {
        assert_eq!(serde_json::to_value(category).unwrap(), json!(expected));
    }

    let units = [
        (MedicationUnit::Tablet, "tablet"),
        (MedicationUnit::Capsule, "capsule"),
        (MedicationUnit::Packet, "packet"),
        (MedicationUnit::Mg, "mg"),
        (MedicationUnit::G, "g"),
        (MedicationUnit::Ml, "ml"),
        (MedicationUnit::Drop, "drop"),
        (MedicationUnit::Dose, "dose"),
    ];
    for (unit, expected) in units {
        assert_eq!(serde_json::to_value(unit).unwrap(), json!(expected));
        assert_eq!(expected.parse::<MedicationUnit>().unwrap(), unit);
    }
    assert!(serde_json::from_value::<MedicationUnit>(json!("teaspoon")).is_err());
}

#[test]
fn bowel_sleep_weight_and_score_boundaries_are_closed_and_finite() {
    assert!(BowelAttributes::new(1, false).is_ok());
    assert!(BowelAttributes::new(7, true).is_ok());
    assert!(BowelAttributes::new(0, false).is_err());
    assert!(BowelAttributes::new(8, false).is_err());

    assert!(SleepValue::hours(f64::MIN_POSITIVE).is_ok());
    assert!(SleepValue::hours(24.0).is_ok());
    assert!(SleepValue::hours(0.0).is_err());
    assert!(SleepValue::hours(24.1).is_err());

    assert!(WeightValue::new(f64::MIN_POSITIVE).is_ok());
    assert!(WeightValue::new(0.0).is_err());

    assert!(SymptomAttributes::new("condition", "Condition", 1, None).is_ok());
    assert!(SymptomAttributes::new("condition", "Condition", 10, None).is_ok());
    assert!(SymptomAttributes::new("condition", "Condition", 0, None).is_err());
    assert!(SymptomAttributes::new("condition", "Condition", 11, None).is_err());

    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(SleepValue::hours(invalid).is_err());
        assert!(WeightValue::new(invalid).is_err());
        assert!(LabAttributes::new("crp", "CRP", invalid, "mg/L").is_err());
        assert!(MedicationAttributes::new("Medicine", invalid, MedicationUnit::Tablet).is_err());
    }
}

#[test]
fn category_attributes_trim_names_keys_units_and_have_exact_json() {
    let bowel = BowelAttributes::new(4, false).unwrap();
    assert_eq!(bowel.bristol_scale(), 4);
    assert!(!bowel.blood_visible());
    assert_eq!(
        serde_json::to_value(&bowel).unwrap(),
        json!({"bristol_scale": 4, "blood_visible": false})
    );

    let weight = WeightAttributes::new(" body_weight ", " Body weight ", 68.2, " kg ").unwrap();
    assert_eq!(weight.metric_key(), "body_weight");
    assert_eq!(weight.name(), "Body weight");
    assert_eq!(weight.value().get(), 68.2);
    assert_eq!(weight.unit(), "kg");
    assert_eq!(
        serde_json::to_value(&weight).unwrap(),
        json!({
            "metric_key": "body_weight",
            "name": "Body weight",
            "value": 68.2,
            "unit": "kg"
        })
    );

    let lab = LabAttributes::new(" crp ", " C-reactive protein ", -0.2, " mg/L ").unwrap();
    assert_eq!(lab.metric_key(), "crp");
    assert_eq!(lab.name(), "C-reactive protein");
    assert_eq!(lab.value(), -0.2);
    assert_eq!(lab.unit(), "mg/L");
    assert_eq!(
        serde_json::to_value(&lab).unwrap(),
        json!({
            "metric_key": "crp",
            "name": "C-reactive protein",
            "value": -0.2,
            "unit": "mg/L"
        })
    );

    let symptom = SymptomAttributes::new(
        " overall_condition ",
        " Overall condition ",
        8,
        Some(" okay "),
    )
    .unwrap();
    assert_eq!(symptom.metric_key(), "overall_condition");
    assert_eq!(symptom.name(), "Overall condition");
    assert_eq!(symptom.score(), 8);
    assert_eq!(symptom.condition_note(), Some("okay"));
    assert_eq!(
        serde_json::to_value(&symptom).unwrap(),
        json!({
            "metric_key": "overall_condition",
            "name": "Overall condition",
            "score": 8,
            "condition_note": "okay"
        })
    );

    let medication = MedicationAttributes::new(" Medicine ", 1.5, MedicationUnit::Tablet).unwrap();
    assert_eq!(medication.medication_name(), "Medicine");
    assert_eq!(medication.dose(), 1.5);
    assert_eq!(medication.unit(), MedicationUnit::Tablet);
    assert_eq!(
        serde_json::to_value(&medication).unwrap(),
        json!({
            "medication_name": "Medicine",
            "dose": 1.5,
            "unit": "tablet"
        })
    );
}

#[test]
fn category_attribute_deserialization_cannot_bypass_validation() {
    assert!(
        serde_json::from_value::<BowelAttributes>(
            json!({"bristol_scale": 8, "blood_visible": false})
        )
        .is_err()
    );
    assert!(serde_json::from_value::<SleepValue>(json!(25.0)).is_err());
    assert!(serde_json::from_value::<WeightValue>(json!(0.0)).is_err());
    assert!(
        serde_json::from_value::<MedicationAttributes>(
            json!({"medication_name": " ", "dose": 1.0, "unit": "tablet"})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<LabAttributes>(
            json!({"metric_key": "", "name": "CRP", "value": 1.0, "unit": "mg/L"})
        )
        .is_err()
    );
}

#[test]
fn new_health_event_has_no_caller_owned_identity_or_lifecycle() {
    let sleep = SleepAttributes::new(
        " sleep_duration ",
        " Sleep ",
        SleepValue::hours(7.5).unwrap(),
    )
    .unwrap();
    assert_eq!(sleep.metric_key(), "sleep_duration");
    assert_eq!(sleep.name(), "Sleep");
    assert_eq!(sleep.hours().get(), 7.5);
    let details = HealthEventDetails::Sleep(sleep);
    assert_eq!(details.category(), HealthCategory::Sleep);
    let input = NewHealthEvent::new(
        parse_timestamp("2026-07-30T23:00:00+09:00"),
        details,
        Some("  restful  "),
    )
    .unwrap();

    assert_eq!(input.occurred_at(), datetime!(2026-07-30 14:00:00 UTC));
    assert_eq!(input.category(), HealthCategory::Sleep);
    assert_eq!(input.metric_key(), "sleep_duration");
    assert_eq!(input.name(), "Sleep");
    assert_eq!(input.value_num(), Some(7.5));
    assert_eq!(input.unit(), Some("hours"));
    assert_eq!(input.note(), Some("restful"));
    assert_eq!(
        serde_json::to_value(&input).unwrap(),
        json!({
            "occurred_at": "2026-07-30T14:00:00Z",
            "category": "sleep",
            "metric_key": "sleep_duration",
            "name": "Sleep",
            "value_num": 7.5,
            "unit": "hours",
            "note": "restful",
            "attributes": {
                "metric_key": "sleep_duration",
                "name": "Sleep",
                "hours": 7.5
            }
        })
    );
}

#[test]
fn new_health_event_json_revalidates_core_and_attributes() {
    let mismatched = json!({
        "occurred_at": "2026-07-30T14:00:00Z",
        "category": "sleep",
        "metric_key": "sleep_duration",
        "name": "Sleep",
        "value_num": 25.0,
        "unit": "hours",
        "note": null,
        "attributes": {
            "metric_key": "sleep_duration",
            "name": "Sleep",
            "hours": 25.0
        }
    });
    assert!(serde_json::from_value::<NewHealthEvent>(mismatched).is_err());

    let wrong_category_attributes = json!({
        "occurred_at": "2026-07-30T14:00:00Z",
        "category": "bowel",
        "metric_key": "bowel",
        "name": "Bowel",
        "value_num": 4.0,
        "unit": null,
        "note": null,
        "attributes": {
            "medication_name": "Medicine",
            "dose": 1.0,
            "unit": "tablet"
        }
    });
    assert!(serde_json::from_value::<NewHealthEvent>(wrong_category_attributes).is_err());
}

#[test]
fn event_rehydration_normalizes_utc_and_serializes_lifecycle_exactly() {
    let mut record = sleep_event_record();
    record.deleted_at = Some(parse_timestamp("2026-07-31T09:00:00+09:00"));
    record.updated_at = parse_timestamp("2026-07-31T09:00:00+09:00");
    let event = HealthEvent::rehydrate(record).unwrap();

    assert_eq!(event.id(), "event-1");
    assert_eq!(event.occurred_at(), datetime!(2026-07-30 14:00:00 UTC));
    assert_eq!(event.created_at(), datetime!(2026-07-30 14:01:00 UTC));
    assert_eq!(event.updated_at(), datetime!(2026-07-31 00:00:00 UTC));
    assert_eq!(event.deleted_at(), Some(datetime!(2026-07-31 00:00:00 UTC)));
    assert!(event.is_deleted());
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!({
            "id": "event-1",
            "occurred_at": "2026-07-30T14:00:00Z",
            "category": "sleep",
            "metric_key": "sleep_duration",
            "name": "Sleep",
            "value_num": 7.5,
            "unit": "hours",
            "note": null,
            "attributes": {
                "metric_key": "sleep_duration",
                "name": "Sleep",
                "hours": 7.5
            },
            "created_at": "2026-07-30T14:01:00Z",
            "updated_at": "2026-07-31T00:00:00Z",
            "deleted_at": "2026-07-31T00:00:00Z"
        })
    );
}

#[test]
fn event_rehydration_rejects_attribute_mismatch_and_lifecycle_inversion() {
    let mut mismatch = sleep_event_record();
    mismatch.value_num = Some(8.0);
    assert_eq!(
        HealthEvent::rehydrate(mismatch),
        Err(ValidationError::AttributesMismatch)
    );

    let mut inverted = sleep_event_record();
    inverted.updated_at = datetime!(2026-07-30 14:00:59 UTC);
    assert_eq!(
        HealthEvent::rehydrate(inverted),
        Err(ValidationError::InvalidLifecycle)
    );
}

fn sleep_event_record() -> HealthEventRehydration {
    HealthEventRehydration {
        id: " event-1 ".to_string(),
        occurred_at: parse_timestamp("2026-07-30T23:00:00+09:00"),
        category: HealthCategory::Sleep,
        metric_key: " sleep_duration ".to_string(),
        name: " Sleep ".to_string(),
        value_num: Some(7.5),
        unit: Some(" hours ".to_string()),
        note: None,
        attributes: json!({
            "metric_key": "sleep_duration",
            "name": "Sleep",
            "hours": 7.5
        }),
        created_at: parse_timestamp("2026-07-30T23:01:00+09:00"),
        updated_at: parse_timestamp("2026-07-30T23:01:00+09:00"),
        deleted_at: None,
    }
}

fn parse_timestamp(value: &str) -> OffsetDateTime {
    OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).unwrap()
}
