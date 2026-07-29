fn main() {
    if let Err(error) = raven_cli::run() {
        eprintln!("{error:#}");
        std::process::exit(raven_cli::exit_code(&error));
    }
}
