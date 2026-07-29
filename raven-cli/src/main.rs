fn main() {
    if let Err(error) = raven_cli::run() {
        if let Some(error) = error.downcast_ref::<clap::Error>() {
            let exit_code = error.exit_code();
            let _ = error.print();
            if exit_code != 0 {
                std::process::exit(exit_code);
            }
            return;
        }
        eprintln!("{error:#}");
        std::process::exit(raven_cli::exit_code(&error));
    }
}
