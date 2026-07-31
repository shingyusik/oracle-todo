use anyhow::Result;
use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
    UpdateAccount, UpdateAccountCategory, UpdateCurrency, UpdateEntry, UpdateTransactionCategory,
};
use ledger_engine::application::doctor::DoctorOptions;
use ledger_engine::application::error::{LedgerError, LedgerResult};
use ledger_engine::application::export::ExportOptions;
use ledger_engine::application::ports::{AuditEvent, EntryQuery, Page};
use ledger_engine::application::queries::{AccountBalanceView, EntryView, TransferView};
use ledger_engine::application::reports::{
    CurrencySummary, LedgerBriefing, LedgerComparison, LedgerSummary, ReportRange,
};
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::transfers::{TransferCommand, TransferOperationKey};
use ledger_engine::domain::{
    Account, AccountCategory, Currency, EntryType, LedgerEntry, Money, TransactionCategory,
    TransactionCategoryKind,
};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::{Date, OffsetDateTime, UtcOffset, macros::format_description};

use crate::cli::{
    AccountCategoryCommand, AccountCategoryCreateArgs, AccountCategoryUpdateArgs, AccountCommand,
    AccountCreateArgs, AccountUpdateArgs, AuditArgs, CategoryCommand, CategoryCreateArgs,
    CategoryKindArg, CategoryUpdateArgs, CompareArgs, CurrencyCommand, CurrencyCreateArgs,
    CurrencyUpdateArgs, DoctorArgs, EntryAddArgs, EntryIdentityArgs, EntryListArgs, EntryShowArgs,
    EntryTypeArg, EntryUpdateArgs, ExportArgs, LedgerCommand, LedgerEntryCommand, OutputFormat,
    PageReadArgs, PurgeArgs, ReportArgs, ReportBy, ReportRangeArgs, TransferArgs, TransferShowArgs,
};
use crate::config::RavenPaths;

type Service = LedgerService<SqliteLedgerRepository>;

const DEFAULT_ACTOR: &str = "raven-cli";
const DEFAULT_SOURCE: &str = "raven-cli";

pub fn run(paths: &RavenPaths, command: LedgerCommand) -> Result<()> {
    let repository = SqliteLedgerRepository::open(paths.ledger_db()).map_err(anyhow::Error::new)?;
    let mut service = LedgerService::new(repository);
    execute(&mut service, command).map_err(anyhow::Error::new)
}

fn execute(service: &mut Service, command: LedgerCommand) -> LedgerResult<()> {
    match command {
        LedgerCommand::Entry { command } => entry(service, command),
        LedgerCommand::Transfer(args) => transfer(service, args),
        LedgerCommand::TransferShow(args) => transfer_show(service, args),
        LedgerCommand::Account { command } => account(service, command),
        LedgerCommand::AccountCategory { command } => account_category(service, command),
        LedgerCommand::Category { command } => category(service, command),
        LedgerCommand::Currency { command } => currency(service, command),
        LedgerCommand::Reports(args) => reports(service, args),
        LedgerCommand::Balances(args) => balances(service, args),
        LedgerCommand::Briefing(args) => briefing(service, args),
        LedgerCommand::Compare(args) => compare(service, args),
        LedgerCommand::Audit(args) => audit(service, args),
        LedgerCommand::Doctor(args) => doctor(service, args),
        LedgerCommand::Export(args) => export(service, args),
    }
}

fn entry(service: &mut Service, command: LedgerEntryCommand) -> LedgerResult<()> {
    match command {
        LedgerEntryCommand::Add(args) => add_entry(service, args),
        LedgerEntryCommand::Update(args) => update_entry(service, args),
        LedgerEntryCommand::List(args) => list_entries(service, args),
        LedgerEntryCommand::Show(args) => show_entry(service, args),
        LedgerEntryCommand::Archive(args) => archive_entry(service, args),
        LedgerEntryCommand::Restore(args) => restore_entry(service, args),
        LedgerEntryCommand::Purge(args) => purge_entry(service, args),
    }
}

fn add_entry(service: &mut Service, args: EntryAddArgs) -> LedgerResult<()> {
    let input = entry_add_input(args)?;
    let date = parse_date(&input.date, "date")?;
    let precision = service.resolve_active_currency_precision(&input.currency)?;
    let amount = parse_money(&input.amount, precision, "amount")?;
    let entry_type = parse_entry_type(&input.entry_type)?;
    let created = service.create_entry(CreateEntry {
        date: date.to_string(),
        written_at: parse_written_at(input.written_at.as_deref(), date)?,
        content: input.content,
        category: input.category,
        account: input.account,
        entry_type,
        amount,
        currency: input.currency,
        transfer_group: None,
        source: input.source.unwrap_or_else(|| DEFAULT_SOURCE.to_string()),
        notes: input.notes,
        actor: input.actor.unwrap_or_else(|| DEFAULT_ACTOR.to_string()),
    })?;
    let view = service.get_entry(created.id())?;
    print_json(&EntryOutput::from(&view))
}

fn update_entry(service: &mut Service, args: EntryUpdateArgs) -> LedgerResult<()> {
    let id = args.id.clone();
    let input = entry_update_input(args)?;
    let amount = match input.amount.as_deref() {
        Some(value) => {
            let precision = match input.currency.as_deref() {
                Some(reference) => service.resolve_active_currency_precision(reference)?,
                None => service.entry_currency_precision(&id)?,
            };
            Some(parse_money(value, precision, "amount")?)
        }
        None => None,
    };
    let updated = service.update_entry(
        &id,
        UpdateEntry {
            date: input
                .date
                .as_deref()
                .map(|value| parse_date(value, "date").map(|date| date.to_string()))
                .transpose()?,
            written_at: input
                .written_at
                .as_deref()
                .map(parse_timestamp)
                .transpose()?,
            content: input.content,
            category: optional_clear(input.category, input.clear_category, "category")?,
            account: input.account,
            entry_type: input
                .entry_type
                .as_deref()
                .map(parse_entry_type)
                .transpose()?,
            amount,
            currency: input.currency,
            transfer_group: None,
            source: input.source,
            notes: optional_clear(input.notes, input.clear_notes, "notes")?,
            actor: input.actor.unwrap_or_else(|| DEFAULT_ACTOR.to_string()),
            reason: input.reason,
        },
    )?;
    let view = service.get_entry(updated.id())?;
    print_json(&EntryOutput::from(&view))
}

fn list_entries(service: &Service, args: EntryListArgs) -> LedgerResult<()> {
    let page = service.query_entries(EntryQuery {
        date_from: args
            .from
            .as_deref()
            .map(|value| parse_date(value, "from"))
            .transpose()?,
        date_to: args
            .to
            .as_deref()
            .map(|value| parse_date(value, "to"))
            .transpose()?,
        entry_type: args.entry_type.map(EntryType::from),
        account: args.account,
        category: args.category,
        currency: args.currency,
        content: args.content,
        include_archived: args.include_archived,
        offset: args.offset,
        limit: args.limit,
    })?;
    let output = PageOutput {
        items: page.items.iter().map(EntryOutput::from).collect(),
        next: page.next.map(PageCursor::from),
    };
    match args.format {
        OutputFormat::Json => print_json(&output),
        OutputFormat::Table => {
            println!(
                "ID\tDATE\tTYPE\tAMOUNT_MINOR\tCURRENCY\tACCOUNT\tCATEGORY\tCONTENT\tARCHIVED"
            );
            for entry in &output.items {
                println!(
                    "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                    table_cell(&entry.id),
                    table_cell(&entry.date),
                    entry.entry_type,
                    entry.amount_minor,
                    table_option(entry.currency_code.as_deref()),
                    table_option(entry.account_name.as_deref()),
                    table_option(entry.category_name.as_deref()),
                    table_cell(&entry.content),
                    entry.deleted_at.is_some()
                );
            }
            Ok(())
        }
    }
}

fn show_entry(service: &Service, args: EntryShowArgs) -> LedgerResult<()> {
    let view = service.get_entry(&args.id)?;
    let output = EntryOutput::from(&view);
    match args.format {
        OutputFormat::Json => print_json(&output),
        OutputFormat::Table => {
            println!("FIELD\tVALUE");
            print_entry_table(&output);
            Ok(())
        }
    }
}

fn archive_entry(service: &mut Service, args: EntryIdentityArgs) -> LedgerResult<()> {
    let entry = service.archive_entry(&args.id)?;
    let view = service
        .entry_including_archived(entry.id())?
        .ok_or_else(|| LedgerError::NotFound(format!("ledger entry {}", entry.id())))?;
    print_json(&EntryOutput::from(&view))
}

fn restore_entry(service: &mut Service, args: EntryIdentityArgs) -> LedgerResult<()> {
    let entry = service.restore_entry(&args.id)?;
    let view = service
        .entry_including_archived(entry.id())?
        .ok_or_else(|| LedgerError::NotFound(format!("ledger entry {}", entry.id())))?;
    print_json(&EntryOutput::from(&view))
}

fn purge_entry(service: &mut Service, args: PurgeArgs) -> LedgerResult<()> {
    let preview = service.purge_entry_preview(&args.id)?;
    let Some(confirmation) = args.confirm else {
        print_json(&PurgePreviewOutput {
            confirmation_id: preview.confirmation_id,
            transfer_group_id: preview.transfer_group_id,
            entry_ids: preview.entry_ids,
        })?;
        return Err(LedgerError::ConfirmationMismatch);
    };
    service.purge_entry(&args.id, &confirmation)?;
    print_json(&PurgeResult {
        purged: true,
        id: args.id,
    })
}

fn transfer(service: &mut Service, args: TransferArgs) -> LedgerResult<()> {
    let input = transfer_input(args)?;
    let operation_key = TransferOperationKey::parse(&input.operation_key)?;
    let date = parse_date(&input.date, "date")?;
    let precision = service.resolve_active_currency_precision(&input.currency)?;
    let result = service.transfer(TransferCommand {
        operation_key,
        date: date.to_string(),
        written_at: parse_written_at(input.written_at.as_deref(), date)?,
        content: input.content,
        from_account: input.from_account,
        to_account: input.to_account,
        amount: parse_money(&input.amount, precision, "amount")?,
        currency: input.currency,
        source: input.source.unwrap_or_else(|| DEFAULT_SOURCE.to_string()),
        notes: input.notes,
        actor: input.actor.unwrap_or_else(|| DEFAULT_ACTOR.to_string()),
    })?;
    print_json(&result)
}

fn transfer_show(service: &Service, args: TransferShowArgs) -> LedgerResult<()> {
    let view = service.show_transfer(&args.id)?;
    let output = TransferOutput::from(&view);
    match args.format {
        OutputFormat::Json => print_json(&output),
        OutputFormat::Table => {
            println!("GROUP\tFROM\tTO\tAMOUNT_MINOR\tCURRENCY\tOUT_ENTRY\tIN_ENTRY");
            println!(
                "{}\t{}\t{}\t{}\t{}\t{}\t{}",
                table_cell(&output.transfer_group_id),
                table_option(output.from_account_name.as_deref()),
                table_option(output.to_account_name.as_deref()),
                output.amount_minor,
                table_option(output.currency_code.as_deref()),
                table_cell(&output.out_entry.id),
                table_cell(&output.in_entry.id)
            );
            Ok(())
        }
    }
}

fn currency(service: &mut Service, command: CurrencyCommand) -> LedgerResult<()> {
    match command {
        CurrencyCommand::Create(args) => {
            let input = currency_create_input(args)?;
            let currency = service.create_currency(CreateCurrency {
                code: input.code,
                name: input.name,
                symbol: input.symbol,
                decimal_places: input.decimal_places,
                actor: input.actor.unwrap_or_else(|| DEFAULT_ACTOR.to_string()),
            })?;
            print_json(&CurrencyOutput::from(&currency))
        }
        CurrencyCommand::Update(args) => {
            let id = args.id.clone();
            let input = currency_update_input(args)?;
            let currency = service.update_currency(
                &id,
                UpdateCurrency {
                    code: input.code,
                    name: input.name,
                    symbol: input.symbol,
                    decimal_places: input.decimal_places,
                    active: input.active,
                    actor: input.actor.unwrap_or_else(|| DEFAULT_ACTOR.to_string()),
                    reason: input.reason,
                },
            )?;
            print_json(&CurrencyOutput::from(&currency))
        }
        CurrencyCommand::List(args) => list_currencies(service, args),
        CurrencyCommand::Purge(args) => {
            let Some(confirmation) = args.confirm.as_deref() else {
                let preview = service.purge_currency_preview(&args.id)?;
                return print_master_purge_preview(preview.confirmation_id, preview.record_type);
            };
            service.purge_currency(&args.id, confirmation)?;
            print_json(&PurgeResult {
                purged: true,
                id: args.id,
            })
        }
    }
}

fn account_category(service: &mut Service, command: AccountCategoryCommand) -> LedgerResult<()> {
    match command {
        AccountCategoryCommand::Create(args) => {
            let input = account_category_create_input(args)?;
            let category = service.create_account_category(CreateAccountCategory {
                name: input.name,
                parent: input.parent,
                liability: input.liability,
                actor: input.actor.unwrap_or_else(|| DEFAULT_ACTOR.to_string()),
            })?;
            print_json(&AccountCategoryOutput::from(&category))
        }
        AccountCategoryCommand::Update(args) => {
            let id = args.id.clone();
            let input = account_category_update_input(args)?;
            let category = service.update_account_category(
                &id,
                UpdateAccountCategory {
                    name: input.name,
                    parent: optional_clear(input.parent, input.clear_parent, "parent")?,
                    liability: input.liability,
                    active: input.active,
                    actor: input.actor.unwrap_or_else(|| DEFAULT_ACTOR.to_string()),
                    reason: input.reason,
                },
            )?;
            print_json(&AccountCategoryOutput::from(&category))
        }
        AccountCategoryCommand::List(args) => list_account_categories(service, args),
        AccountCategoryCommand::Purge(args) => {
            let Some(confirmation) = args.confirm.as_deref() else {
                let preview = service.purge_account_category_preview(&args.id)?;
                return print_master_purge_preview(preview.confirmation_id, preview.record_type);
            };
            service.purge_account_category(&args.id, confirmation)?;
            print_json(&PurgeResult {
                purged: true,
                id: args.id,
            })
        }
    }
}

fn account(service: &mut Service, command: AccountCommand) -> LedgerResult<()> {
    match command {
        AccountCommand::Create(args) => {
            let input = account_create_input(args)?;
            let precision = service.resolve_active_currency_precision(&input.currency)?;
            let account = service.create_account(CreateAccount {
                name: input.name,
                category: input.category,
                currency: input.currency,
                opening_balance: parse_money(&input.opening_balance, precision, "opening_balance")?,
                actor: input.actor.unwrap_or_else(|| DEFAULT_ACTOR.to_string()),
            })?;
            print_json(&AccountOutput::from(&account))
        }
        AccountCommand::Update(args) => {
            let id = args.id.clone();
            let input = account_update_input(args)?;
            let opening_balance = match input.opening_balance.as_deref() {
                Some(value) => {
                    let precision = match input.currency.as_deref() {
                        Some(reference) => service.resolve_active_currency_precision(reference)?,
                        None => service.account_currency_precision(&id)?,
                    };
                    Some(parse_money(value, precision, "opening_balance")?)
                }
                None => None,
            };
            let account = service.update_account(
                &id,
                UpdateAccount {
                    name: input.name,
                    category: input.category,
                    currency: input.currency,
                    opening_balance,
                    active: input.active,
                    actor: input.actor.unwrap_or_else(|| DEFAULT_ACTOR.to_string()),
                    reason: input.reason,
                },
            )?;
            print_json(&AccountOutput::from(&account))
        }
        AccountCommand::List(args) => list_accounts(service, args),
        AccountCommand::Purge(args) => {
            let Some(confirmation) = args.confirm.as_deref() else {
                let preview = service.purge_account_preview(&args.id)?;
                return print_master_purge_preview(preview.confirmation_id, preview.record_type);
            };
            service.purge_account(&args.id, confirmation)?;
            print_json(&PurgeResult {
                purged: true,
                id: args.id,
            })
        }
    }
}

fn category(service: &mut Service, command: CategoryCommand) -> LedgerResult<()> {
    match command {
        CategoryCommand::Create(args) => {
            let input = category_create_input(args)?;
            let category = service.create_category(CreateTransactionCategory {
                name: input.name,
                parent: input.parent,
                kind: parse_category_kind(&input.kind)?,
                actor: input.actor.unwrap_or_else(|| DEFAULT_ACTOR.to_string()),
            })?;
            print_json(&CategoryOutput::from(&category))
        }
        CategoryCommand::Update(args) => {
            let id = args.id.clone();
            let input = category_update_input(args)?;
            let category = service.update_category(
                &id,
                UpdateTransactionCategory {
                    name: input.name,
                    parent: optional_clear(input.parent, input.clear_parent, "parent")?,
                    kind: input.kind.as_deref().map(parse_category_kind).transpose()?,
                    active: input.active,
                    actor: input.actor.unwrap_or_else(|| DEFAULT_ACTOR.to_string()),
                    reason: input.reason,
                },
            )?;
            print_json(&CategoryOutput::from(&category))
        }
        CategoryCommand::List(args) => list_categories(service, args),
        CategoryCommand::Purge(args) => {
            let Some(confirmation) = args.confirm.as_deref() else {
                let preview = service.purge_category_preview(&args.id)?;
                return print_master_purge_preview(preview.confirmation_id, preview.record_type);
            };
            service.purge_category(&args.id, confirmation)?;
            print_json(&PurgeResult {
                purged: true,
                id: args.id,
            })
        }
    }
}

fn list_currencies(service: &Service, args: PageReadArgs) -> LedgerResult<()> {
    let page = service.currencies_page(page(&args))?;
    let output = PageOutput {
        items: page.items.iter().map(CurrencyOutput::from).collect(),
        next: page.next.map(PageCursor::from),
    };
    match args.format {
        OutputFormat::Json => print_json(&output),
        OutputFormat::Table => {
            println!("ID\tCODE\tNAME\tSYMBOL\tDECIMAL_PLACES\tACTIVE");
            for value in output.items {
                println!(
                    "{}\t{}\t{}\t{}\t{}\t{}",
                    table_cell(&value.id),
                    table_cell(&value.code),
                    table_cell(&value.name),
                    table_cell(&value.symbol),
                    value.decimal_places,
                    value.active
                );
            }
            Ok(())
        }
    }
}

fn list_account_categories(service: &Service, args: PageReadArgs) -> LedgerResult<()> {
    let page = service.account_categories_page(page(&args))?;
    let output = PageOutput {
        items: page.items.iter().map(AccountCategoryOutput::from).collect(),
        next: page.next.map(PageCursor::from),
    };
    match args.format {
        OutputFormat::Json => print_json(&output),
        OutputFormat::Table => {
            println!("ID\tNAME\tPARENT_ID\tLIABILITY\tACTIVE");
            for value in output.items {
                println!(
                    "{}\t{}\t{}\t{}\t{}",
                    table_cell(&value.id),
                    table_cell(&value.name),
                    table_option(value.parent_id.as_deref()),
                    value.liability,
                    value.active
                );
            }
            Ok(())
        }
    }
}

fn list_accounts(service: &Service, args: PageReadArgs) -> LedgerResult<()> {
    let page = service.accounts_page(page(&args))?;
    let output = PageOutput {
        items: page.items.iter().map(AccountOutput::from).collect(),
        next: page.next.map(PageCursor::from),
    };
    match args.format {
        OutputFormat::Json => print_json(&output),
        OutputFormat::Table => {
            println!("ID\tNAME\tACCOUNT_CATEGORY_ID\tCURRENCY_ID\tOPENING_BALANCE_MINOR\tACTIVE");
            for value in output.items {
                println!(
                    "{}\t{}\t{}\t{}\t{}\t{}",
                    table_cell(&value.id),
                    table_cell(&value.name),
                    table_cell(&value.account_category_id),
                    table_cell(&value.currency_id),
                    value.opening_balance_minor,
                    value.active
                );
            }
            Ok(())
        }
    }
}

fn list_categories(service: &Service, args: PageReadArgs) -> LedgerResult<()> {
    let page = service.transaction_categories_page(page(&args))?;
    let output = PageOutput {
        items: page.items.iter().map(CategoryOutput::from).collect(),
        next: page.next.map(PageCursor::from),
    };
    match args.format {
        OutputFormat::Json => print_json(&output),
        OutputFormat::Table => {
            println!("ID\tNAME\tPARENT_ID\tKIND\tACTIVE");
            for value in output.items {
                println!(
                    "{}\t{}\t{}\t{}\t{}",
                    table_cell(&value.id),
                    table_cell(&value.name),
                    table_option(value.parent_id.as_deref()),
                    value.kind,
                    value.active
                );
            }
            Ok(())
        }
    }
}

fn reports(service: &Service, args: ReportArgs) -> LedgerResult<()> {
    let range = report_range(&args.range)?;
    match args.by {
        ReportBy::Summary => {
            let report = service.summary(range)?;
            match args.range.format {
                OutputFormat::Json => print_json(&SummaryOutput::from(report)),
                OutputFormat::Table => {
                    println!("CURRENCY\tINCOME_MINOR\tEXPENSE_MINOR\tNET_CHANGE_MINOR\tENTRIES");
                    for row in report.currencies {
                        println!(
                            "{}\t{}\t{}\t{}\t{}",
                            table_cell(&row.currency_code),
                            row.income_minor,
                            row.expense_minor,
                            row.net_change_minor,
                            row.entry_count
                        );
                    }
                    Ok(())
                }
            }
        }
        ReportBy::Account => {
            let report = service.account_breakdown(range)?;
            print_report_rows(report, args.range.format)
        }
        ReportBy::Category => {
            let report = service.category_breakdown(range)?;
            print_report_rows(report, args.range.format)
        }
    }
}

fn print_report_rows(
    report: Vec<ledger_engine::application::reports::BreakdownRow>,
    format: OutputFormat,
) -> LedgerResult<()> {
    match format {
        OutputFormat::Json => print_json(&report),
        OutputFormat::Table => {
            println!("NAME\tCURRENCY\tINCOME_MINOR\tEXPENSE_MINOR\tNET_CHANGE_MINOR\tENTRIES");
            for row in report {
                println!(
                    "{}\t{}\t{}\t{}\t{}\t{}",
                    table_cell(&row.name),
                    table_cell(&row.currency_code),
                    row.income_minor,
                    row.expense_minor,
                    row.net_change_minor,
                    row.entry_count
                );
            }
            Ok(())
        }
    }
}

fn balances(service: &Service, args: PageReadArgs) -> LedgerResult<()> {
    let page = service.account_balances_page(page(&args))?;
    let output = PageOutput {
        items: page.items.iter().map(BalanceOutput::from).collect(),
        next: page.next.map(PageCursor::from),
    };
    match args.format {
        OutputFormat::Json => print_json(&output),
        OutputFormat::Table => {
            println!("ACCOUNT_ID\tACCOUNT\tCURRENCY\tCURRENT_BALANCE_MINOR");
            for row in output.items {
                println!(
                    "{}\t{}\t{}\t{}",
                    table_cell(&row.account_id),
                    table_cell(&row.account_name),
                    table_cell(&row.currency_code),
                    row.current_balance_minor
                );
            }
            Ok(())
        }
    }
}

fn briefing(service: &Service, args: ReportRangeArgs) -> LedgerResult<()> {
    let report = service.briefing(report_range(&args)?)?;
    match args.format {
        OutputFormat::Json => print_json(&BriefingOutput::from(report)),
        OutputFormat::Table => {
            println!("FROM\tTO\tCURRENCY\tINCOME_MINOR\tEXPENSE_MINOR\tNET_CHANGE_MINOR\tENTRIES");
            if report.summary.currencies.is_empty() {
                println!(
                    "{}\t{}\t-\t0\t0\t0\t0",
                    report.summary.range.start, report.summary.range.end
                );
            } else {
                for row in &report.summary.currencies {
                    println!(
                        "{}\t{}\t{}\t{}\t{}\t{}\t{}",
                        report.summary.range.start,
                        report.summary.range.end,
                        table_cell(&row.currency_code),
                        row.income_minor,
                        row.expense_minor,
                        row.net_change_minor,
                        row.entry_count
                    );
                }
            }
            Ok(())
        }
    }
}

fn compare(service: &Service, args: CompareArgs) -> LedgerResult<()> {
    let current = explicit_range(
        &args.current_from,
        &args.current_to,
        "current_from",
        "current_to",
    )?;
    let previous = explicit_range(
        &args.previous_from,
        &args.previous_to,
        "previous_from",
        "previous_to",
    )?;
    let report = service.compare(current, previous)?;
    match args.format {
        OutputFormat::Json => print_json(&ComparisonOutput::from(report)),
        OutputFormat::Table => {
            println!(
                "RANGE\tFROM\tTO\tCURRENCY\tINCOME_MINOR\tEXPENSE_MINOR\tNET_CHANGE_MINOR\tENTRIES"
            );
            print_comparison_rows("current", &report.current);
            print_comparison_rows("previous", &report.previous);
            Ok(())
        }
    }
}

fn print_comparison_rows(label: &str, summary: &LedgerSummary) {
    if summary.currencies.is_empty() {
        println!(
            "{}\t{}\t{}\t-\t0\t0\t0\t0",
            label, summary.range.start, summary.range.end
        );
        return;
    }
    for row in &summary.currencies {
        println!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            label,
            summary.range.start,
            summary.range.end,
            table_cell(&row.currency_code),
            row.income_minor,
            row.expense_minor,
            row.net_change_minor,
            row.entry_count
        );
    }
}

fn audit(service: &Service, args: AuditArgs) -> LedgerResult<()> {
    let record_type = required_reference(&args.record_type, "record_type")?;
    let record_id = required_reference(&args.record_id, "record_id")?;
    let page = service.audit_page(
        record_type,
        record_id,
        Page {
            offset: args.offset,
            limit: args.limit,
        },
    )?;
    let output = PageOutput {
        items: page.items.into_iter().map(AuditEventOutput::from).collect(),
        next: page.next.map(PageCursor::from),
    };
    match args.format {
        OutputFormat::Json => print_json(&output),
        OutputFormat::Table => {
            println!(
                "ID\tOCCURRED_AT\tACTOR\tACTION\tRECORD_TYPE\tRECORD_ID\tBEFORE_JSON\tAFTER_JSON\tREASON"
            );
            for event in output.items {
                let before = compact_json_option(event.before.as_ref())?;
                let after = compact_json_option(event.after.as_ref())?;
                println!(
                    "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                    table_cell(&event.id),
                    table_cell(&event.occurred_at),
                    table_cell(&event.actor),
                    table_cell(&event.action),
                    table_cell(&event.record_type),
                    table_cell(&event.record_id),
                    table_cell(&before),
                    table_cell(&after),
                    table_option(event.reason.as_deref())
                );
            }
            Ok(())
        }
    }
}

fn doctor(service: &Service, args: DoctorArgs) -> LedgerResult<()> {
    let defaults = DoctorOptions::default();
    let report = service.doctor_with_options(DoctorOptions {
        max_records: args.max_records.unwrap_or(defaults.max_records),
        max_bytes: args.max_bytes.unwrap_or(defaults.max_bytes),
    })?;
    match args.format {
        OutputFormat::Json => print_json(&report),
        OutputFormat::Table => {
            println!(
                "healthy={} scanned_records={} scanned_bytes={} issues={}",
                report.healthy,
                report.scanned_records,
                report.scanned_bytes,
                report.issues.len()
            );
            for issue in report.issues {
                println!(
                    "{:?}\t{}\t{}\t{}\t{}",
                    issue.severity,
                    table_cell(&issue.code),
                    table_cell(&issue.record_type),
                    table_option(issue.record_id.as_deref()),
                    table_cell(&issue.message)
                );
            }
            Ok(())
        }
    }
}

fn export(service: &Service, args: ExportArgs) -> LedgerResult<()> {
    let defaults = ExportOptions::default();
    let export = service.export(ExportOptions {
        include_archived: args.include_archived,
        max_records: args.max_records.unwrap_or(defaults.max_records),
        max_bytes: args.max_bytes.unwrap_or(defaults.max_bytes),
    })?;
    match args.format {
        OutputFormat::Json => print_json_document(&export),
        OutputFormat::Table => {
            println!(
                "schema_version={} restore_capable={} currencies={} account_categories={} \
                 accounts={} transaction_categories={} entries={} audit_events={} \
                 transfer_operations={}",
                export.schema_version,
                export.restore_capable,
                export.currencies.len(),
                export.account_categories.len(),
                export.accounts.len(),
                export.transaction_categories.len(),
                export.entries.len(),
                export.audit_events.len(),
                export.transfer_operations.len()
            );
            Ok(())
        }
    }
}

fn report_range(args: &ReportRangeArgs) -> LedgerResult<ReportRange> {
    ReportRange::new(parse_date(&args.from, "from")?, parse_date(&args.to, "to")?)
}

fn explicit_range(
    from: &str,
    to: &str,
    from_field: &'static str,
    to_field: &'static str,
) -> LedgerResult<ReportRange> {
    ReportRange::new(parse_date(from, from_field)?, parse_date(to, to_field)?)
}

fn print_master_purge_preview(
    confirmation_id: String,
    record_type: &'static str,
) -> LedgerResult<()> {
    print_json(&MasterPurgePreviewOutput {
        confirmation_id,
        record_type,
    })?;
    Err(LedgerError::ConfirmationMismatch)
}

fn page(args: &PageReadArgs) -> Page {
    Page {
        offset: args.offset,
        limit: args.limit,
    }
}

fn parse_money(value: &str, precision: u8, field: &'static str) -> LedgerResult<Money> {
    Money::parse(value, precision).map_err(|error| LedgerError::Validation {
        field,
        message: error.to_string(),
    })
}

fn parse_date(value: &str, field: &'static str) -> LedgerResult<Date> {
    Date::parse(value.trim(), format_description!("[year]-[month]-[day]")).map_err(|_| {
        LedgerError::Validation {
            field,
            message: "date must be a valid YYYY-MM-DD calendar date".to_string(),
        }
    })
}

fn parse_timestamp(value: &str) -> LedgerResult<OffsetDateTime> {
    OffsetDateTime::parse(value.trim(), &Rfc3339)
        .map(|value| value.to_offset(UtcOffset::UTC))
        .map_err(|_| validation("written_at", "timestamp must use RFC3339"))
}

fn parse_written_at(value: Option<&str>, date: Date) -> LedgerResult<OffsetDateTime> {
    match value {
        Some(value) => parse_timestamp(value),
        None => Ok(date
            .with_hms(0, 0, 0)
            .map_err(|_| validation("date", "date is outside the supported range"))?
            .assume_utc()),
    }
}

fn parse_entry_type(value: &str) -> LedgerResult<EntryType> {
    match value {
        "expense" => Ok(EntryType::Expense),
        "income" => Ok(EntryType::Income),
        "transfer_out" => Ok(EntryType::TransferOut),
        "transfer_in" => Ok(EntryType::TransferIn),
        "adjustment_out" => Ok(EntryType::AdjustmentOut),
        "adjustment_in" => Ok(EntryType::AdjustmentIn),
        _ => Err(validation(
            "entry_type",
            "type must be expense, income, transfer_out, transfer_in, adjustment_out, or adjustment_in",
        )),
    }
}

fn parse_category_kind(value: &str) -> LedgerResult<TransactionCategoryKind> {
    match value {
        "expense" => Ok(TransactionCategoryKind::Expense),
        "income" => Ok(TransactionCategoryKind::Income),
        _ => Err(validation("kind", "kind must be expense or income")),
    }
}

fn optional_clear<T>(
    value: Option<T>,
    clear: bool,
    field: &'static str,
) -> LedgerResult<Option<Option<T>>> {
    if value.is_some() && clear {
        return Err(validation(
            field,
            "value and clear flag cannot be used together",
        ));
    }
    Ok(if clear { Some(None) } else { value.map(Some) })
}

fn required(value: Option<String>, field: &'static str) -> LedgerResult<String> {
    value.ok_or_else(|| validation(field, "field is required"))
}

fn required_reference<'value>(
    value: &'value str,
    field: &'static str,
) -> LedgerResult<&'value str> {
    let value = value.trim();
    if value.is_empty() {
        return Err(validation(field, "value must not be blank"));
    }
    Ok(value)
}

fn validation(field: &'static str, message: impl Into<String>) -> LedgerError {
    LedgerError::Validation {
        field,
        message: message.into(),
    }
}

fn json_input<T: for<'de> Deserialize<'de>>(value: &str) -> LedgerResult<T> {
    serde_json::from_str(value).map_err(|error| validation("json", error.to_string()))
}

fn reject_mixed_json(json: &Option<String>, has_flags: bool) -> LedgerResult<()> {
    if json.is_some() && has_flags {
        return Err(validation(
            "json",
            "--json cannot be combined with mutation field flags",
        ));
    }
    Ok(())
}

fn print_json(value: &impl Serialize) -> LedgerResult<()> {
    let output =
        serde_json::to_string(value).map_err(|error| LedgerError::Storage(error.to_string()))?;
    println!("{output}");
    Ok(())
}

fn print_json_document(value: &impl Serialize) -> LedgerResult<()> {
    use std::io::Write;

    let output =
        serde_json::to_vec(value).map_err(|error| LedgerError::Storage(error.to_string()))?;
    std::io::stdout()
        .write_all(&output)
        .map_err(|error| LedgerError::Storage(error.to_string()))
}

fn compact_json_option(value: Option<&serde_json::Value>) -> LedgerResult<String> {
    value
        .map(serde_json::to_string)
        .transpose()
        .map(|value| value.unwrap_or_else(|| "-".to_string()))
        .map_err(|error| LedgerError::Storage(error.to_string()))
}

fn display_option(value: Option<&str>) -> &str {
    value.unwrap_or("-")
}

fn table_option(value: Option<&str>) -> String {
    table_cell(display_option(value))
}

fn table_cell(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '\\' => output.push_str(r"\\"),
            '\t' => output.push_str(r"\t"),
            '\n' => output.push_str(r"\n"),
            '\r' => output.push_str(r"\r"),
            character if character.is_control() => {
                std::fmt::Write::write_fmt(
                    &mut output,
                    format_args!(r"\u{{{:04x}}}", u32::from(character)),
                )
                .expect("writing to a string cannot fail");
            }
            character => output.push(character),
        }
    }
    output
}

fn format_timestamp(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .expect("validated timestamp must format as RFC3339")
}

fn print_entry_table(entry: &EntryOutput) {
    println!("id\t{}", table_cell(&entry.id));
    println!("date\t{}", table_cell(&entry.date));
    println!("type\t{}", entry.entry_type);
    println!("amount_minor\t{}", entry.amount_minor);
    println!("currency\t{}", table_option(entry.currency_code.as_deref()));
    println!("account\t{}", table_option(entry.account_name.as_deref()));
    println!("category\t{}", table_option(entry.category_name.as_deref()));
    println!("content\t{}", table_cell(&entry.content));
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EntryAddInput {
    date: String,
    written_at: Option<String>,
    #[serde(alias = "type")]
    entry_type: String,
    amount: String,
    currency: String,
    account: String,
    category: Option<String>,
    content: String,
    source: Option<String>,
    notes: Option<String>,
    actor: Option<String>,
}

fn entry_add_input(args: EntryAddArgs) -> LedgerResult<EntryAddInput> {
    reject_mixed_json(
        &args.json,
        args.date.is_some()
            || args.written_at.is_some()
            || args.entry_type.is_some()
            || args.amount.is_some()
            || args.currency.is_some()
            || args.account.is_some()
            || args.category.is_some()
            || args.content.is_some()
            || args.source.is_some()
            || args.notes.is_some()
            || args.actor.is_some(),
    )?;
    if let Some(json) = args.json {
        return json_input(&json);
    }
    Ok(EntryAddInput {
        date: required(args.date, "date")?,
        written_at: args.written_at,
        entry_type: args
            .entry_type
            .map(|value| EntryType::from(value).as_str().to_string())
            .ok_or_else(|| validation("entry_type", "field is required"))?,
        amount: required(args.amount, "amount")?,
        currency: required(args.currency, "currency")?,
        account: required(args.account, "account")?,
        category: args.category,
        content: required(args.content, "content")?,
        source: args.source,
        notes: args.notes,
        actor: args.actor,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EntryUpdateInput {
    date: Option<String>,
    written_at: Option<String>,
    #[serde(alias = "type")]
    entry_type: Option<String>,
    amount: Option<String>,
    currency: Option<String>,
    account: Option<String>,
    category: Option<String>,
    #[serde(default)]
    clear_category: bool,
    content: Option<String>,
    source: Option<String>,
    notes: Option<String>,
    #[serde(default)]
    clear_notes: bool,
    actor: Option<String>,
    reason: Option<String>,
}

fn entry_update_input(args: EntryUpdateArgs) -> LedgerResult<EntryUpdateInput> {
    reject_mixed_json(
        &args.json,
        args.date.is_some()
            || args.written_at.is_some()
            || args.entry_type.is_some()
            || args.amount.is_some()
            || args.currency.is_some()
            || args.account.is_some()
            || args.category.is_some()
            || args.clear_category
            || args.content.is_some()
            || args.source.is_some()
            || args.notes.is_some()
            || args.clear_notes
            || args.actor.is_some()
            || args.reason.is_some(),
    )?;
    if let Some(json) = args.json {
        return json_input(&json);
    }
    Ok(EntryUpdateInput {
        date: args.date,
        written_at: args.written_at,
        entry_type: args
            .entry_type
            .map(|value| EntryType::from(value).as_str().to_string()),
        amount: args.amount,
        currency: args.currency,
        account: args.account,
        category: args.category,
        clear_category: args.clear_category,
        content: args.content,
        source: args.source,
        notes: args.notes,
        clear_notes: args.clear_notes,
        actor: args.actor,
        reason: args.reason,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TransferInput {
    #[serde(alias = "idempotency_key")]
    operation_key: String,
    date: String,
    written_at: Option<String>,
    amount: String,
    currency: String,
    from_account: String,
    to_account: String,
    content: String,
    source: Option<String>,
    notes: Option<String>,
    actor: Option<String>,
}

fn transfer_input(args: TransferArgs) -> LedgerResult<TransferInput> {
    reject_mixed_json(
        &args.json,
        args.operation_key.is_some()
            || args.date.is_some()
            || args.written_at.is_some()
            || args.amount.is_some()
            || args.currency.is_some()
            || args.from_account.is_some()
            || args.to_account.is_some()
            || args.content.is_some()
            || args.source.is_some()
            || args.notes.is_some()
            || args.actor.is_some(),
    )?;
    if let Some(json) = args.json {
        return json_input(&json);
    }
    Ok(TransferInput {
        operation_key: required(args.operation_key, "operation_key")?,
        date: required(args.date, "date")?,
        written_at: args.written_at,
        amount: required(args.amount, "amount")?,
        currency: required(args.currency, "currency")?,
        from_account: required(args.from_account, "from_account")?,
        to_account: required(args.to_account, "to_account")?,
        content: required(args.content, "content")?,
        source: args.source,
        notes: args.notes,
        actor: args.actor,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CurrencyCreateInput {
    code: String,
    name: String,
    symbol: String,
    decimal_places: u8,
    actor: Option<String>,
}

fn currency_create_input(args: CurrencyCreateArgs) -> LedgerResult<CurrencyCreateInput> {
    reject_mixed_json(
        &args.json,
        args.code.is_some()
            || args.name.is_some()
            || args.symbol.is_some()
            || args.decimal_places.is_some()
            || args.actor.is_some(),
    )?;
    if let Some(json) = args.json {
        return json_input(&json);
    }
    Ok(CurrencyCreateInput {
        code: required(args.code, "code")?,
        name: required(args.name, "name")?,
        symbol: required(args.symbol, "symbol")?,
        decimal_places: args
            .decimal_places
            .ok_or_else(|| validation("decimal_places", "field is required"))?,
        actor: args.actor,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CurrencyUpdateInput {
    code: Option<String>,
    name: Option<String>,
    symbol: Option<String>,
    decimal_places: Option<u8>,
    active: Option<bool>,
    actor: Option<String>,
    reason: Option<String>,
}

fn currency_update_input(args: CurrencyUpdateArgs) -> LedgerResult<CurrencyUpdateInput> {
    reject_mixed_json(
        &args.json,
        args.code.is_some()
            || args.name.is_some()
            || args.symbol.is_some()
            || args.decimal_places.is_some()
            || args.active.is_some()
            || args.actor.is_some()
            || args.reason.is_some(),
    )?;
    if let Some(json) = args.json {
        return json_input(&json);
    }
    Ok(CurrencyUpdateInput {
        code: args.code,
        name: args.name,
        symbol: args.symbol,
        decimal_places: args.decimal_places,
        active: args.active,
        actor: args.actor,
        reason: args.reason,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountCategoryCreateInput {
    name: String,
    parent: Option<String>,
    #[serde(default)]
    liability: bool,
    actor: Option<String>,
}

fn account_category_create_input(
    args: AccountCategoryCreateArgs,
) -> LedgerResult<AccountCategoryCreateInput> {
    reject_mixed_json(
        &args.json,
        args.name.is_some() || args.parent.is_some() || args.liability || args.actor.is_some(),
    )?;
    if let Some(json) = args.json {
        return json_input(&json);
    }
    Ok(AccountCategoryCreateInput {
        name: required(args.name, "name")?,
        parent: args.parent,
        liability: args.liability,
        actor: args.actor,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountCategoryUpdateInput {
    name: Option<String>,
    parent: Option<String>,
    #[serde(default)]
    clear_parent: bool,
    liability: Option<bool>,
    active: Option<bool>,
    actor: Option<String>,
    reason: Option<String>,
}

fn account_category_update_input(
    args: AccountCategoryUpdateArgs,
) -> LedgerResult<AccountCategoryUpdateInput> {
    reject_mixed_json(
        &args.json,
        args.name.is_some()
            || args.parent.is_some()
            || args.clear_parent
            || args.liability.is_some()
            || args.active.is_some()
            || args.actor.is_some()
            || args.reason.is_some(),
    )?;
    if let Some(json) = args.json {
        return json_input(&json);
    }
    Ok(AccountCategoryUpdateInput {
        name: args.name,
        parent: args.parent,
        clear_parent: args.clear_parent,
        liability: args.liability,
        active: args.active,
        actor: args.actor,
        reason: args.reason,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountCreateInput {
    name: String,
    category: String,
    currency: String,
    opening_balance: String,
    actor: Option<String>,
}

fn account_create_input(args: AccountCreateArgs) -> LedgerResult<AccountCreateInput> {
    reject_mixed_json(
        &args.json,
        args.name.is_some()
            || args.category.is_some()
            || args.currency.is_some()
            || args.opening_balance.is_some()
            || args.actor.is_some(),
    )?;
    if let Some(json) = args.json {
        return json_input(&json);
    }
    Ok(AccountCreateInput {
        name: required(args.name, "name")?,
        category: required(args.category, "category")?,
        currency: required(args.currency, "currency")?,
        opening_balance: required(args.opening_balance, "opening_balance")?,
        actor: args.actor,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountUpdateInput {
    name: Option<String>,
    category: Option<String>,
    currency: Option<String>,
    opening_balance: Option<String>,
    active: Option<bool>,
    actor: Option<String>,
    reason: Option<String>,
}

fn account_update_input(args: AccountUpdateArgs) -> LedgerResult<AccountUpdateInput> {
    reject_mixed_json(
        &args.json,
        args.name.is_some()
            || args.category.is_some()
            || args.currency.is_some()
            || args.opening_balance.is_some()
            || args.active.is_some()
            || args.actor.is_some()
            || args.reason.is_some(),
    )?;
    if let Some(json) = args.json {
        return json_input(&json);
    }
    Ok(AccountUpdateInput {
        name: args.name,
        category: args.category,
        currency: args.currency,
        opening_balance: args.opening_balance,
        active: args.active,
        actor: args.actor,
        reason: args.reason,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CategoryCreateInput {
    name: String,
    parent: Option<String>,
    kind: String,
    actor: Option<String>,
}

fn category_create_input(args: CategoryCreateArgs) -> LedgerResult<CategoryCreateInput> {
    reject_mixed_json(
        &args.json,
        args.name.is_some() || args.parent.is_some() || args.kind.is_some() || args.actor.is_some(),
    )?;
    if let Some(json) = args.json {
        return json_input(&json);
    }
    Ok(CategoryCreateInput {
        name: required(args.name, "name")?,
        parent: args.parent,
        kind: args
            .kind
            .map(kind_name)
            .ok_or_else(|| validation("kind", "field is required"))?
            .to_string(),
        actor: args.actor,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CategoryUpdateInput {
    name: Option<String>,
    parent: Option<String>,
    #[serde(default)]
    clear_parent: bool,
    kind: Option<String>,
    active: Option<bool>,
    actor: Option<String>,
    reason: Option<String>,
}

fn category_update_input(args: CategoryUpdateArgs) -> LedgerResult<CategoryUpdateInput> {
    reject_mixed_json(
        &args.json,
        args.name.is_some()
            || args.parent.is_some()
            || args.clear_parent
            || args.kind.is_some()
            || args.active.is_some()
            || args.actor.is_some()
            || args.reason.is_some(),
    )?;
    if let Some(json) = args.json {
        return json_input(&json);
    }
    Ok(CategoryUpdateInput {
        name: args.name,
        parent: args.parent,
        clear_parent: args.clear_parent,
        kind: args.kind.map(kind_name).map(str::to_string),
        active: args.active,
        actor: args.actor,
        reason: args.reason,
    })
}

fn kind_name(value: CategoryKindArg) -> &'static str {
    match value {
        CategoryKindArg::Expense => "expense",
        CategoryKindArg::Income => "income",
    }
}

impl From<EntryTypeArg> for EntryType {
    fn from(value: EntryTypeArg) -> Self {
        match value {
            EntryTypeArg::Expense => Self::Expense,
            EntryTypeArg::Income => Self::Income,
            EntryTypeArg::TransferOut => Self::TransferOut,
            EntryTypeArg::TransferIn => Self::TransferIn,
            EntryTypeArg::AdjustmentOut => Self::AdjustmentOut,
            EntryTypeArg::AdjustmentIn => Self::AdjustmentIn,
        }
    }
}

#[derive(Debug, Serialize)]
struct PageOutput<T> {
    items: Vec<T>,
    next: Option<PageCursor>,
}

#[derive(Debug, Serialize)]
struct PageCursor {
    offset: u32,
    limit: u16,
}

impl From<Page> for PageCursor {
    fn from(value: Page) -> Self {
        Self {
            offset: value.offset,
            limit: value.limit,
        }
    }
}

#[derive(Debug, Serialize)]
struct EntryOutput {
    id: String,
    date: String,
    written_at: String,
    content: String,
    transaction_category_id: Option<String>,
    category_name: Option<String>,
    account_id: String,
    account_name: Option<String>,
    entry_type: &'static str,
    amount_minor: i64,
    currency_id: String,
    currency_code: Option<String>,
    transfer_group_id: Option<String>,
    source: String,
    notes: Option<String>,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
}

impl From<&EntryView> for EntryOutput {
    fn from(value: &EntryView) -> Self {
        Self::new(
            &value.entry,
            value.account_name.clone(),
            value.category_name.clone(),
            value.currency_code.clone(),
        )
    }
}

impl EntryOutput {
    fn new(
        value: &LedgerEntry,
        account_name: Option<String>,
        category_name: Option<String>,
        currency_code: Option<String>,
    ) -> Self {
        Self {
            id: value.id().to_string(),
            date: value.date().to_string(),
            written_at: format_timestamp(value.written_at()),
            content: value.content().to_string(),
            transaction_category_id: value.transaction_category_id().map(str::to_string),
            category_name,
            account_id: value.account_id().to_string(),
            account_name,
            entry_type: value.entry_type().as_str(),
            amount_minor: value.amount().minor_units(),
            currency_id: value.currency_id().to_string(),
            currency_code,
            transfer_group_id: value.transfer_group_id().map(str::to_string),
            source: value.source().to_string(),
            notes: value.notes().map(str::to_string),
            created_at: format_timestamp(value.created_at()),
            updated_at: format_timestamp(value.updated_at()),
            deleted_at: value.deleted_at().map(format_timestamp),
        }
    }
}

#[derive(Debug, Serialize)]
struct CurrencyOutput {
    id: String,
    code: String,
    name: String,
    symbol: String,
    decimal_places: u8,
    active: bool,
}

impl From<&Currency> for CurrencyOutput {
    fn from(value: &Currency) -> Self {
        Self {
            id: value.id().to_string(),
            code: value.code().to_string(),
            name: value.name().to_string(),
            symbol: value.symbol().to_string(),
            decimal_places: value.decimal_places(),
            active: value.is_active(),
        }
    }
}

#[derive(Debug, Serialize)]
struct AccountCategoryOutput {
    id: String,
    name: String,
    parent_id: Option<String>,
    liability: bool,
    active: bool,
}

impl From<&AccountCategory> for AccountCategoryOutput {
    fn from(value: &AccountCategory) -> Self {
        Self {
            id: value.id().to_string(),
            name: value.name().to_string(),
            parent_id: value.parent_id().map(str::to_string),
            liability: value.is_liability(),
            active: value.is_active(),
        }
    }
}

#[derive(Debug, Serialize)]
struct AccountOutput {
    id: String,
    name: String,
    account_category_id: String,
    currency_id: String,
    opening_balance_minor: i64,
    active: bool,
}

impl From<&Account> for AccountOutput {
    fn from(value: &Account) -> Self {
        Self {
            id: value.id().to_string(),
            name: value.name().to_string(),
            account_category_id: value.category_id().to_string(),
            currency_id: value.currency_id().to_string(),
            opening_balance_minor: value.opening_balance().minor_units(),
            active: value.is_active(),
        }
    }
}

#[derive(Debug, Serialize)]
struct CategoryOutput {
    id: String,
    name: String,
    parent_id: Option<String>,
    kind: &'static str,
    active: bool,
}

impl From<&TransactionCategory> for CategoryOutput {
    fn from(value: &TransactionCategory) -> Self {
        Self {
            id: value.id().to_string(),
            name: value.name().to_string(),
            parent_id: value.parent_id().map(str::to_string),
            kind: match value.kind() {
                TransactionCategoryKind::Expense => "expense",
                TransactionCategoryKind::Income => "income",
            },
            active: value.is_active(),
        }
    }
}

#[derive(Debug, Serialize)]
struct TransferOutput {
    transfer_group_id: String,
    out_entry: EntryOutput,
    in_entry: EntryOutput,
    amount_minor: i64,
    currency_code: Option<String>,
    from_account_name: Option<String>,
    to_account_name: Option<String>,
}

impl From<&TransferView> for TransferOutput {
    fn from(value: &TransferView) -> Self {
        Self {
            transfer_group_id: value.transfer_group_id.clone(),
            out_entry: EntryOutput::from(&value.out_entry),
            in_entry: EntryOutput::from(&value.in_entry),
            amount_minor: value.amount_minor,
            currency_code: value.currency_code.clone(),
            from_account_name: value.from_account_name.clone(),
            to_account_name: value.to_account_name.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
struct BalanceOutput {
    account_id: String,
    account_name: String,
    currency_id: String,
    currency_code: String,
    opening_balance_minor: i64,
    current_balance_minor: i64,
}

impl From<&AccountBalanceView> for BalanceOutput {
    fn from(value: &AccountBalanceView) -> Self {
        Self {
            account_id: value.account.id().to_string(),
            account_name: value.account.name().to_string(),
            currency_id: value.account.currency_id().to_string(),
            currency_code: value.currency_code.clone(),
            opening_balance_minor: value.account.opening_balance().minor_units(),
            current_balance_minor: value.current_balance_minor,
        }
    }
}

#[derive(Debug, Serialize)]
struct ReportRangeOutput {
    start: String,
    end: String,
}

impl From<ReportRange> for ReportRangeOutput {
    fn from(value: ReportRange) -> Self {
        Self {
            start: value.start.to_string(),
            end: value.end.to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
struct CurrencySummaryOutput {
    currency_id: String,
    currency_code: String,
    income_minor: i64,
    expense_minor: i64,
    net_change_minor: i64,
    entry_count: u64,
}

impl From<CurrencySummary> for CurrencySummaryOutput {
    fn from(value: CurrencySummary) -> Self {
        Self {
            currency_id: value.currency_id,
            currency_code: value.currency_code,
            income_minor: value.income_minor,
            expense_minor: value.expense_minor,
            net_change_minor: value.net_change_minor,
            entry_count: value.entry_count,
        }
    }
}

#[derive(Debug, Serialize)]
struct SummaryOutput {
    range: ReportRangeOutput,
    currencies: Vec<CurrencySummaryOutput>,
}

impl From<LedgerSummary> for SummaryOutput {
    fn from(value: LedgerSummary) -> Self {
        Self {
            range: value.range.into(),
            currencies: value
                .currencies
                .into_iter()
                .map(CurrencySummaryOutput::from)
                .collect(),
        }
    }
}

#[derive(Debug, Serialize)]
struct ComparisonOutput {
    current: SummaryOutput,
    previous: SummaryOutput,
}

impl From<LedgerComparison> for ComparisonOutput {
    fn from(value: LedgerComparison) -> Self {
        Self {
            current: value.current.into(),
            previous: value.previous.into(),
        }
    }
}

#[derive(Debug, Serialize)]
struct BriefingOutput {
    summary: SummaryOutput,
    markdown: String,
}

impl From<LedgerBriefing> for BriefingOutput {
    fn from(value: LedgerBriefing) -> Self {
        Self {
            summary: value.summary.into(),
            markdown: value.markdown,
        }
    }
}

#[derive(Debug, Serialize)]
struct AuditEventOutput {
    id: String,
    occurred_at: String,
    actor: String,
    action: String,
    record_type: String,
    record_id: String,
    before: Option<serde_json::Value>,
    after: Option<serde_json::Value>,
    reason: Option<String>,
}

impl From<AuditEvent> for AuditEventOutput {
    fn from(value: AuditEvent) -> Self {
        Self {
            id: value.id,
            occurred_at: format_timestamp(value.occurred_at),
            actor: value.actor,
            action: value.action,
            record_type: value.record_type,
            record_id: value.record_id,
            before: value.before,
            after: value.after,
            reason: value.reason,
        }
    }
}

#[derive(Debug, Serialize)]
struct PurgePreviewOutput {
    confirmation_id: String,
    transfer_group_id: Option<String>,
    entry_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
struct MasterPurgePreviewOutput {
    confirmation_id: String,
    record_type: &'static str,
}

#[derive(Debug, Serialize)]
struct PurgeResult {
    purged: bool,
    id: String,
}
