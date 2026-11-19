//! `raven maintenance retention show|set` and `raven maintenance purge`.
//! Uses the same retention core as the UI/API scheduler (including the backup).

use anyhow::Result;
use raven_api::Retention;
use raven_api::retention::{
    LastRun, RetentionError, RetentionPaths, RetentionPreview, RetentionStatus, RunReport,
    SettingsUpdate, Trigger,
};
use serde::Serialize;
use time::macros::offset;

use crate::cli::{
    MaintenanceCommand, OutputFormat, RetentionCommand, RetentionPurgeArgs, RetentionSetArgs,
};
use crate::config::RavenPaths;
use crate::errors::CliError;

pub fn retention(paths: &RavenPaths) -> Retention {
    Retention::builder(
        RetentionPaths {
            home: paths.home().to_path_buf(),
            todo_db: paths.todo_db(),
            ledger_db: paths.ledger_db(),
            health_db: paths.health_db(),
            health_media_dir: paths.health_media_dir(),
        },
        offset!(+9),
    )
    .build()
}

pub fn run(paths: &RavenPaths, command: MaintenanceCommand) -> Result<()> {
    let retention = retention(paths);
    match command {
        MaintenanceCommand::Retention {
            command: RetentionCommand::Show(args),
        } => show(&retention, args.format),
        MaintenanceCommand::Retention {
            command: RetentionCommand::Set(args),
        } => set(&retention, args),
        MaintenanceCommand::Purge(args) => purge(&retention, args),
    }
}

fn show(retention: &Retention, format: OutputFormat) -> Result<()> {
    let status = retention.status().map_err(cli_error)?;
    match format {
        OutputFormat::Json => print_json(&status),
        OutputFormat::Table => print_status(&status),
    }
    Ok(())
}

fn set(retention: &Retention, args: RetentionSetArgs) -> Result<()> {
    retention
        .update_settings(SettingsUpdate {
            enabled: args.enabled,
            retention_days: args.days,
            backup_keep: args.backup_keep,
        })
        .map_err(cli_error)?;
    show(retention, args.format)
}

fn purge(retention: &Retention, args: RetentionPurgeArgs) -> Result<()> {
    if args.dry_run {
        let preview = retention
            .preview(usize::from(args.limit))
            .map_err(cli_error)?;
        match args.format {
            OutputFormat::Json => print_json(&preview),
            OutputFormat::Table => print_preview(&preview),
        }
        return Ok(());
    }
    let report = retention.run(Trigger::Cli).map_err(cli_error)?;
    match report.skipped {
        Some("locked") => {
            return Err(CliError::new(
                "retention_in_progress",
                "A retention run is already in progress.",
                2,
                Some(false),
                true,
            )
            .into());
        }
        Some(_) => {
            return Err(CliError::new(
                "clock_regressed",
                "The system clock is earlier than the last retention run.",
                2,
                Some(false),
                false,
            )
            .into());
        }
        None => {}
    }
    match args.format {
        OutputFormat::Json => print_json(&report),
        OutputFormat::Table => print_report(&report),
    }
    match report.last_run.as_ref().map(|run| run.outcome.as_str()) {
        Some("partial" | "failed") => Err(CliError::new(
            "retention_failed",
            "Retention purge failed for at least one domain.",
            1,
            None,
            true,
        )
        .into()),
        Some("insufficient_disk") => Err(CliError::new(
            "insufficient_disk",
            "Not enough free disk space for the retention backup.",
            1,
            Some(false),
            true,
        )
        .into()),
        _ => Ok(()),
    }
}

fn cli_error(error: RetentionError) -> anyhow::Error {
    match error {
        RetentionError::Validation { field } => {
            let mut error = CliError::new(
                "validation_error",
                "Input validation failed.",
                2,
                Some(false),
                true,
            );
            let detail = match field {
                "retention_days" => "Use 7 through 3650 days.",
                "backup_keep" => "Keep 1 through 30 backups.",
                _ => "Invalid or missing value.",
            };
            error.fields.insert(field.to_owned(), detail.to_owned());
            error.into()
        }
        RetentionError::Storage => CliError::new(
            "storage_error",
            "Retention storage is unavailable.",
            1,
            None,
            true,
        )
        .into(),
    }
}

fn print_json(value: &impl Serialize) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).expect("retention output serializes")
    );
}

fn counts(map: &std::collections::BTreeMap<String, u64>) -> String {
    if map.is_empty() {
        return "-".to_owned();
    }
    map.iter()
        .map(|(key, count)| format!("{key}={count}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn print_status(status: &RetentionStatus) {
    println!("enabled: {}", status.settings.enabled);
    println!("retention_days: {}", status.settings.retention_days);
    println!("backup_keep: {}", status.settings.backup_keep);
    println!("env_override: {}", status.env_override.unwrap_or("none"));
    match &status.last_run {
        Some(run) => print_last_run(run),
        None => println!("last_run: none"),
    }
}

fn print_last_run(run: &LastRun) {
    println!(
        "last_run: {} trigger={} finished_at={} backup={}",
        run.outcome,
        run.trigger,
        run.finished_at,
        run.backup
            .as_ref()
            .map_or("none", |backup| backup.name.as_str())
    );
    for (domain, result) in &run.domains {
        println!(
            "  {domain}: {} purged {} skipped {}",
            result.status,
            counts(&result.purged),
            counts(&result.skipped)
        );
    }
    if run.media_cleanup_pending > 0 {
        println!("  media_cleanup_pending: {}", run.media_cleanup_pending);
    }
}

fn print_preview(preview: &RetentionPreview) {
    println!(
        "cutoff: {} retention_days: {}",
        preview.cutoff, preview.retention_days
    );
    for (domain, result) in &preview.domains {
        println!(
            "{domain}: {} due {} skipped {}",
            result.status,
            counts(&result.counts),
            counts(&result.skipped)
        );
        for item in &result.items {
            println!(
                "  {} {} {} {}",
                item.kind, item.archived_at, item.id, item.label
            );
        }
        if result.truncated {
            println!("  ...");
        }
    }
}

fn print_report(report: &RunReport) {
    if let Some(run) = &report.last_run {
        print_last_run(run);
    }
}
