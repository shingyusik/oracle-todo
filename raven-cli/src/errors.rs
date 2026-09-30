use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[error("{message}")]
pub struct CliError {
    pub code: String,
    pub message: String,
    pub fields: BTreeMap<String, String>,
    pub committed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_id: Option<String>,
    pub retryable: bool,
    #[serde(skip)]
    pub exit: i32,
}
impl CliError {
    pub fn new(
        code: &str,
        message: &str,
        exit: i32,
        committed: Option<bool>,
        retryable: bool,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            fields: BTreeMap::new(),
            committed,
            record_id: None,
            retryable,
            exit,
        }
    }
}
pub fn describe(error: &anyhow::Error) -> CliError {
    if let Some(error) = error.downcast_ref::<CliError>() {
        return error.clone();
    }
    if let Some(error) = error.downcast_ref::<crate::commands::HealthCheckError>() {
        return CliError::new("health_check_failed", error.0, 1, Some(false), false);
    }
    if error.downcast_ref::<clap::Error>().is_some() {
        return CliError::new(
            "invalid_arguments",
            "Invalid command arguments; consult command help.",
            crate::exit_code(error),
            Some(false),
            true,
        );
    }
    if let Some(error) = error.downcast_ref::<crate::commands::api::ApiCommandError>()
        && error.cli_exit_code() == 2
    {
        return validation("configuration");
    }
    if let Some(error) = error.downcast_ref::<crate::commands::ui::UiCommandError>() {
        return match error {
            crate::commands::ui::UiCommandError::Artifact => CliError::new(
                "ui_artifact_failed",
                "UI artifact is missing, unreadable, or invalid",
                1,
                Some(false),
                false,
            ),
            crate::commands::ui::UiCommandError::PublicOrigin => validation("configuration"),
        };
    }
    if let Some(crate::commands::import::ImportTodoError::DestinationExists(_)) =
        error.downcast_ref::<crate::commands::import::ImportTodoError>()
    {
        return CliError::new(
            "conflict",
            "Import destination already exists.",
            2,
            Some(false),
            false,
        );
    }
    if let Some(error) = error.downcast_ref::<health_engine::application::error::HealthError>() {
        use health_engine::application::error::HealthError::*;
        match error {
            CleanupPending { record_id, .. } => {
                let mut result = CliError::new(
                    "cleanup_pending",
                    "Mutation committed; media cleanup remains pending.",
                    1,
                    Some(true),
                    false,
                );
                result.record_id = Some(record_id.clone());
                return result;
            }
            Validation { field, message } => return validation_detail(field, message),
            NotFound(_) => {
                return CliError::new("not_found", "Record not found.", 4, Some(false), true);
            }
            Conflict(_) => {
                return CliError::new(
                    "conflict",
                    "Mutation conflicts with current state.",
                    2,
                    Some(false),
                    true,
                );
            }
            UnsupportedMedia | MediaTooLarge => return validation("record"),
            Cleanup { .. } => {
                return CliError::new(
                    "cleanup_failed",
                    "Mutation failed and media cleanup requires attention.",
                    1,
                    Some(false),
                    false,
                );
            }
            _ => {}
        }
    }
    if let Some(error) = error.downcast_ref::<ledger_engine::application::error::LedgerError>() {
        use ledger_engine::application::error::LedgerError::*;
        match error {
            Validation { field, message } => return validation_detail(field, message),
            NotFound(_) => {
                return CliError::new("not_found", "Record not found.", 4, Some(false), true);
            }
            Conflict(_) => {
                return CliError::new(
                    "conflict",
                    "Mutation conflicts with current state.",
                    2,
                    Some(false),
                    true,
                );
            }
            ConfirmationMismatch => {
                return CliError::new(
                    "confirmation_mismatch",
                    "Confirmation must match the record identifier.",
                    2,
                    Some(false),
                    true,
                );
            }
            _ => {}
        }
    }
    if let Some(error) = error.downcast_ref::<todo_engine::application::error::TodoError>() {
        let exit = error.cli_exit_code();
        if exit == 2 {
            let mut result = CliError::new(
                error.api_code(),
                "Mutation rejected by ToDo validation or policy.",
                exit,
                Some(false),
                true,
            );
            use todo_engine::application::error::TodoError;
            let constraint = match error {
                TodoError::GoalInvalidAnchor { .. } => Some((
                    "scheduled",
                    "Use the canonical start of the selected horizon period.",
                )),
                TodoError::GoalParentHorizonNotCoarser { .. } => Some((
                    "parent",
                    "Parent horizon must be strictly coarser than the child horizon.",
                )),
                TodoError::Policy(message) if message == "Project requires definition_of_done" => {
                    Some((
                        "definition_of_done",
                        "This field is required and must not be blank.",
                    ))
                }
                TodoError::Policy(message) if message == "Routine requires recurrence_rule" => {
                    Some((
                        "recurrence_rule",
                        "This field is required; use a supported RRULE.",
                    ))
                }
                TodoError::Validation(message)
                    if message == "expected_updated_at must be RFC 3339" =>
                {
                    Some((
                        "expected_updated_at",
                        "Must be an RFC3339 timestamp from the current record.",
                    ))
                }
                TodoError::Conflict(message) if message == "Item changed since it was read" => {
                    Some((
                        "expected_updated_at",
                        "Record changed; read it again and reconcile before updating.",
                    ))
                }
                _ => None,
            };
            if let Some((field, detail)) = constraint {
                result.fields.insert(field.into(), detail.into());
            }
            return result;
        }
        if exit == 4 {
            return CliError::new("not_found", "Record not found.", exit, Some(false), true);
        }
    }
    CliError::new(
        "internal_error",
        "Command failed; check Raven diagnostics before retrying a mutation.",
        crate::exit_code(error),
        None,
        false,
    )
}
fn validation(field: &str) -> CliError {
    let mut error = CliError::new(
        "validation_error",
        "Input validation failed.",
        2,
        Some(false),
        true,
    );
    error
        .fields
        .insert(field.into(), "Invalid or missing value.".into());
    error
}
fn validation_detail(field: &str, message: &str) -> CliError {
    use health_engine::domain::ValidationError;
    let mut error = validation(field);
    let (field, detail) = if message == ValidationError::InvalidBristolScale.to_string() {
        ("bristol", "Must be an integer from 1 through 7.")
    } else if message == ValidationError::InvalidSleepHours.to_string() {
        (
            "value",
            "Sleep hours must be greater than zero and no more than 24.",
        )
    } else if message == ValidationError::InvalidSymptomScore.to_string() {
        ("value", "Must be an integer from 1 through 10.")
    } else if message == ValidationError::InvalidMetricKey.to_string() {
        (
            "key",
            "Use 1..=64 ASCII snake_case characters starting with a letter.",
        )
    } else if message == ValidationError::InvalidRecordId.to_string() {
        ("id", "Use a canonical lowercase hyphenated UUID v4.")
    } else if message.starts_with("unsupported meal type:") {
        (
            "meal",
            "Allowed values: breakfast, lunch, dinner, snack, late_night.",
        )
    } else if message.starts_with("unsupported medication unit:") {
        (
            "unit",
            "Allowed values: tablet, capsule, packet, mg, g, ml, drop, dose.",
        )
    } else {
        let detail = match message {
            "must be RFC3339" | "timestamp must use RFC3339" => "Must be an RFC3339 timestamp.",
            "must be YYYY-MM-DD" | "date must be a valid YYYY-MM-DD calendar date" => {
                "Must be a valid YYYY-MM-DD calendar date."
            }
            "is required" | "field is required" => "This field is required.",
            "value must not be blank" | "actor must not be blank" => "Must not be blank.",
            "cannot be set and cleared together"
            | "value and clear flag cannot be used together" => {
                "Choose a value or its clear flag, not both."
            }
            "must be an integer from 1 through 10" => "Must be an integer from 1 through 10.",
            "kind must be expense or income" => "Allowed values: expense, income.",
            "type must be expense, income, transfer_out, transfer_in, adjustment_out, or adjustment_in" => {
                "Allowed values: expense, income, transfer_out, transfer_in, adjustment_out, adjustment_in."
            }
            "must be weight, sleep, lab, or symptom" => {
                "Allowed values: weight, sleep, lab, symptom."
            }
            "must be weight, sleep, lab, symptom, or overall_condition" => {
                "Allowed values: weight, sleep, lab, symptom, overall_condition."
            }
            _ if field == "json" => "Must match the documented strict JSON shape.",
            _ if field == "amount" || field == "opening_balance" => {
                "Use a decimal amount within the currency precision and supported range."
            }
            _ => "Invalid or missing value.",
        };
        (field, detail)
    };
    error.fields.clear();
    error.fields.insert(field.into(), detail.into());
    error
}

// Wrapper options must precede the domain command; data tokens never select an error mode.
pub fn json_requested(args: &[std::ffi::OsString]) -> bool {
    let mut args = args.iter().skip(1);
    while let Some(arg) = args.next() {
        let value = arg.to_str().unwrap_or_default();
        if !value.starts_with('-') || value == "--" {
            break;
        }
        if value == "--error-format" {
            return args.next().is_some_and(|value| value == "json");
        }
        if value == "--error-format=json" {
            return true;
        }
        if value == "--home" || value == "--request-key" || value == "--request-timeout-seconds" {
            args.next();
        }
    }
    false
}
