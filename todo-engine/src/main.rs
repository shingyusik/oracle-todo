use todo_engine::application::error::TodoError;

fn main() {
    if let Err(error) = todo_engine::interfaces::cli::run() {
        eprintln!("{error:#}");
        let exit_code = TodoError::cli_exit_code_from_error(&error).unwrap_or(1);
        std::process::exit(exit_code);
    }
}
