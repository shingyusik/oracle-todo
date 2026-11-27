//! `raven google-calendar ...`: the same runtime as the UI/API routes and scheduler.
//! JSON output equals the API's response bodies.

use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use anyhow::Result;
use axum::Router;
use axum::http::Uri;
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use raven_api::GoogleCalendar;
use raven_api::google_calendar::{
    CALLBACK_PATH, CalendarList, GoogleCalendarError, GoogleCalendarStatus, SettingsUpdate,
    SyncOptions, SyncReport, Trigger, parse_callback_query,
};
use serde::Serialize;
use time::macros::offset;

use crate::cli::{
    GoogleCalendarChoiceCommand, GoogleCalendarCommand, GoogleClientCommand, GoogleConnectArgs,
    GoogleSetArgs, GoogleSyncArgs, OutputFormat,
};
use crate::config::RavenPaths;
use crate::errors::CliError;

pub fn runtime(paths: &RavenPaths) -> Result<GoogleCalendar> {
    GoogleCalendar::builder(paths.home(), paths.todo_db(), offset!(+9)).build()
}

pub fn run(paths: &RavenPaths, command: GoogleCalendarCommand) -> Result<()> {
    let calendar = runtime(paths)?;
    let tokio = tokio::runtime::Runtime::new()?;
    let result = tokio.block_on(execute(&calendar, command));
    tokio.shutdown_background();
    result
}

async fn execute(calendar: &GoogleCalendar, command: GoogleCalendarCommand) -> Result<()> {
    match command {
        GoogleCalendarCommand::Client {
            command: GoogleClientCommand::Set { file },
        } => {
            let client_id = calendar.set_oauth_client(&file).map_err(cli_error)?;
            print_compact(&ClientView {
                configured: true,
                client_id: Some(client_id),
            });
        }
        GoogleCalendarCommand::Client {
            command: GoogleClientCommand::Show(args),
        } => {
            let client = calendar.oauth_client().map_err(cli_error)?;
            let view = ClientView {
                configured: client.is_some(),
                client_id: client.map(|client| client.client_id),
            };
            match args.format {
                OutputFormat::Json => print_pretty(&view),
                OutputFormat::Table => {
                    println!("configured: {}", view.configured);
                    println!("client_id: {}", view.client_id.as_deref().unwrap_or("-"));
                }
            }
        }
        GoogleCalendarCommand::Connect(args) => {
            let status = connect(calendar, &args, |url| {
                eprintln!("Open this URL to connect Google Calendar:\n{url}");
                if !args.no_open
                    && let Err(error) = open_browser(url)
                {
                    tracing::warn!(event = "browser_open_failed", %error, "browser could not be opened");
                }
            })
            .await?;
            print_compact(&status);
        }
        GoogleCalendarCommand::Status(args) => {
            let status = calendar.status().map_err(cli_error)?;
            match args.format {
                OutputFormat::Json => print_pretty(&status),
                OutputFormat::Table => print_status(&status),
            }
        }
        GoogleCalendarCommand::Calendars(args) => {
            let list = calendar.list_calendars().await.map_err(cli_error)?;
            match args.format {
                OutputFormat::Json => print_pretty(&list),
                OutputFormat::Table => print_calendars(&list),
            }
        }
        GoogleCalendarCommand::Calendar {
            command: GoogleCalendarChoiceCommand::Select { calendar_id },
        } => print_compact(
            &calendar
                .select_calendar(&calendar_id)
                .await
                .map_err(cli_error)?,
        ),
        GoogleCalendarCommand::Calendar {
            command: GoogleCalendarChoiceCommand::Create { summary },
        } => print_compact(
            &calendar
                .create_calendar(&summary)
                .await
                .map_err(cli_error)?,
        ),
        GoogleCalendarCommand::Set(args) => set(calendar, args)?,
        GoogleCalendarCommand::Sync(args) => sync(calendar, args).await?,
        GoogleCalendarCommand::Disconnect(args) => print_compact(
            &calendar
                .disconnect(args.forget_links)
                .await
                .map_err(cli_error)?,
        ),
    }
    Ok(())
}

#[derive(Serialize)]
struct ClientView {
    configured: bool,
    client_id: Option<String>,
}

fn set(calendar: &GoogleCalendar, args: GoogleSetArgs) -> Result<()> {
    let status = calendar
        .update_settings(SettingsUpdate {
            enabled: args.enabled,
            poll_interval_secs: args.poll_interval_secs,
            default_duration_minutes: args.default_duration_minutes,
            sync_note: args.sync_note,
        })
        .map_err(cli_error)?;
    print_compact(&status);
    Ok(())
}

async fn sync(calendar: &GoogleCalendar, args: GoogleSyncArgs) -> Result<()> {
    let report = calendar
        .sync(
            Trigger::Cli,
            SyncOptions {
                dry_run: args.dry_run,
                allow_mass_delete: args.allow_mass_delete,
            },
        )
        .await
        .map_err(cli_error)?;
    match args.format {
        OutputFormat::Json => print_pretty(&report),
        OutputFormat::Table => print_report(&report),
    }
    outcome_error(&report)
}

/// A recorded run that needs attention exits non-zero after printing its report.
fn outcome_error(report: &SyncReport) -> Result<()> {
    let outcome = report
        .last_sync
        .as_ref()
        .map(|run| run.outcome.as_str())
        .unwrap_or("ok");
    if report.dry_run {
        return Ok(());
    }
    match outcome {
        "partial" | "failed" => Err(CliError::new(
            "google_calendar_sync_failed",
            "Google Calendar sync did not complete.",
            1,
            None,
            true,
        )
        .into()),
        "guard_tripped" => Err(CliError::new(
            "google_calendar_guard_tripped",
            "Sync stopped before mass deletion; rerun with --allow-mass-delete to apply.",
            2,
            Some(false),
            false,
        )
        .into()),
        "reauth_required" => Err(cli_error(GoogleCalendarError::ReauthRequired)),
        _ => Ok(()),
    }
}

/// Runs a temporary loopback listener on 127.0.0.1:0 for Google's redirect, calls
/// `show_url` with the consent URL and waits up to `--timeout-secs`.
pub async fn connect(
    calendar: &GoogleCalendar,
    args: &GoogleConnectArgs,
    show_url: impl FnOnce(&str),
) -> Result<GoogleCalendarStatus> {
    let listener =
        tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).await?;
    let addr = listener.local_addr()?;
    let redirect_uri = format!("http://{addr}{CALLBACK_PATH}");
    let start = calendar.begin_connect(&redirect_uri).map_err(cli_error)?;
    let (sender, mut receiver) =
        tokio::sync::mpsc::channel::<Result<GoogleCalendarStatus, GoogleCalendarError>>(1);
    let handler_calendar = calendar.clone();
    let app = Router::new().route(
        CALLBACK_PATH,
        get(move |uri: Uri| {
            let calendar = handler_calendar.clone();
            let sender = sender.clone();
            async move {
                let result = match parse_callback_query(uri.query().unwrap_or_default()) {
                    Ok((state, code)) => calendar.complete_connect(&state, &code).await,
                    Err(error) => Err(error),
                };
                let page = if result.is_ok() {
                    "Google Calendar is connected. You can close this window."
                } else {
                    "Google Calendar could not be connected. Return to the terminal."
                };
                let _ = sender.send(result).await;
                (
                    [
                        (axum::http::header::CACHE_CONTROL, "no-store"),
                        (axum::http::header::REFERRER_POLICY, "no-referrer"),
                    ],
                    Html(format!(
                        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Raven</title></head><body><p>{page}</p></body></html>"
                    )),
                )
                    .into_response()
            }
        }),
    );
    let server = tokio::spawn(async move { axum::serve(listener, app).await });
    show_url(&start.authorization_url);
    let outcome =
        tokio::time::timeout(Duration::from_secs(args.timeout_secs), receiver.recv()).await;
    server.abort();
    match outcome {
        Ok(Some(result)) => result.map_err(cli_error),
        Ok(None) => Err(anyhow::anyhow!("connect listener stopped")),
        Err(_) => Err(CliError::new(
            "google_calendar_connect_timeout",
            "Timed out waiting for Google's redirect.",
            1,
            Some(false),
            true,
        )
        .into()),
    }
}

pub fn cli_error(error: GoogleCalendarError) -> anyhow::Error {
    let (code, message, exit, retryable) = match &error {
        GoogleCalendarError::NotConfigured => (
            "google_calendar_not_configured",
            "Google access is not set up; run `raven google-calendar client set --file <path>`.",
            2,
            false,
        ),
        GoogleCalendarError::NotConnected => (
            "google_calendar_not_connected",
            "Google Calendar is not connected; run `raven google-calendar connect`.",
            2,
            false,
        ),
        GoogleCalendarError::ReauthRequired => (
            "google_calendar_reauth_required",
            "Google access expired or was revoked; run `raven google-calendar connect`.",
            2,
            false,
        ),
        GoogleCalendarError::SyncInProgress => (
            "google_calendar_sync_in_progress",
            "A Google Calendar sync is already in progress.",
            2,
            true,
        ),
        GoogleCalendarError::CalendarNotSelected => (
            "google_calendar_calendar_not_selected",
            "No Google calendar is selected; run `raven google-calendar calendar select|create`.",
            2,
            false,
        ),
        GoogleCalendarError::Upstream(_) => (
            "upstream_unavailable",
            "Google Calendar is unavailable; try again later.",
            1,
            true,
        ),
        GoogleCalendarError::Validation { field } => {
            let mut result = CliError::new(
                "validation_error",
                "Input validation failed.",
                2,
                Some(false),
                true,
            );
            let detail = match *field {
                "poll_interval_secs" => "Use 60 through 3600 seconds.",
                "default_duration_minutes" => "Use 1 through 1440 minutes.",
                "select" => "Not a writable calendar of the connected account.",
                "summary" => "Use 1 through 255 characters.",
                _ => "Invalid or missing value.",
            };
            result.fields.insert((*field).to_owned(), detail.to_owned());
            return result.into();
        }
        GoogleCalendarError::Storage(_) => (
            "storage_error",
            "Google Calendar storage is unavailable.",
            1,
            true,
        ),
        GoogleCalendarError::TodoUnavailable => {
            ("storage_error", "The ToDo store is unavailable.", 1, true)
        }
    };
    CliError::new(code, message, exit, Some(false), retryable).into()
}

fn print_compact(value: &impl Serialize) {
    println!(
        "{}",
        serde_json::to_string(value).expect("google calendar output serializes")
    );
}

fn print_pretty(value: &impl Serialize) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).expect("google calendar output serializes")
    );
}

fn print_status(status: &GoogleCalendarStatus) {
    println!("configured: {}", status.configured);
    println!("connection: {}", status.connection);
    match &status.calendar {
        Some(calendar) => println!(
            "calendar: {} ({})",
            calendar.summary.as_deref().unwrap_or("-"),
            calendar.id
        ),
        None => println!("calendar: none"),
    }
    println!("enabled: {}", status.settings.enabled);
    println!("poll_interval_secs: {}", status.settings.poll_interval_secs);
    println!(
        "default_duration_minutes: {}",
        status.settings.default_duration_minutes
    );
    println!("sync_note: {}", status.settings.sync_note);
    println!("env_override: {}", status.env_override.unwrap_or("none"));
    println!("first_sync_pending: {}", status.first_sync_pending);
    println!(
        "links: total={} error={}",
        status.links.total, status.links.error
    );
    match &status.last_sync {
        Some(run) => print_run(run),
        None => println!("last_sync: none"),
    }
}

fn print_run(run: &raven_api::google_calendar::storage::LastSync) {
    let counts = serde_json::to_value(run.counts).unwrap_or_default();
    let counts = counts
        .as_object()
        .map(|counts| {
            counts
                .iter()
                .map(|(key, value)| format!("{key}={value}"))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();
    println!(
        "last_sync: {} trigger={} finished_at={}{}",
        run.outcome,
        run.trigger,
        run.finished_at,
        run.error_kind
            .as_deref()
            .map(|kind| format!(" error_kind={kind}"))
            .unwrap_or_default()
    );
    println!("  {counts}");
}

fn print_report(report: &SyncReport) {
    if report.dry_run {
        println!("dry_run: true");
    }
    match &report.last_sync {
        Some(run) => print_run(run),
        None => println!("last_sync: none"),
    }
}

fn print_calendars(list: &CalendarList) {
    for calendar in &list.calendars {
        println!(
            "{}{}\t{}\t{}",
            calendar.id,
            if calendar.primary { " (primary)" } else { "" },
            calendar.access_role,
            calendar.summary
        );
    }
}

fn open_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };
    let mut child = command.spawn()?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

#[cfg(test)]
mod tests;
