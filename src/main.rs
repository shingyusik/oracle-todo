use oracle_todo::application::error::TodoError;

fn main() {
    if let Err(error) = oracle_todo::interfaces::cli::run() {
        eprintln!("{error:#}");
        let exit_code = TodoError::cli_exit_code_from_error(&error).unwrap_or(1);
        std::process::exit(exit_code);
    }
}
