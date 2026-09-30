fn main() {
    let args = std::env::args_os().collect::<Vec<_>>();
    let json = raven_cli::errors::json_requested(&args);
    if let Err(error) = raven_cli::run() {
        let exit = raven_cli::exit_code(&error);
        if let Some(clap_error) = error.downcast_ref::<clap::Error>() {
            if exit == 0 || !json {
                let _ = clap_error.print();
            } else {
                eprintln!(
                    "{}",
                    serde_json::to_string(&raven_cli::errors::describe(&error)).unwrap()
                );
            }
        } else if json {
            eprintln!(
                "{}",
                serde_json::to_string(&raven_cli::errors::describe(&error)).unwrap()
            );
        } else if ["internal_error", "cleanup_pending", "cleanup_failed"]
            .contains(&raven_cli::errors::describe(&error).code.as_str())
            && error.downcast_ref::<dotenvy::Error>().is_none()
        {
            eprintln!("{}", raven_cli::errors::describe(&error).message);
        } else if error.downcast_ref::<dotenvy::Error>().is_some() {
            eprintln!("{error}");
        } else {
            eprintln!("{error:#}");
        }
        if exit != 0 {
            std::process::exit(exit);
        }
    }
}
