use oracle_todo::application::error::TodoError;

fn main() {
    if let Err(error) = oracle_todo::interfaces::cli::run() {
        eprintln!("{error:#}");
        let exit_code = error
            .downcast_ref::<TodoError>()
            .map(TodoError::cli_exit_code)
            .unwrap_or(1);
        std::process::exit(exit_code);
    }
}
