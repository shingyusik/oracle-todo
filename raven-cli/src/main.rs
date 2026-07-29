use clap::Parser;

#[derive(Parser)]
#[command(
    name = "raven",
    about = "Raven unified personal engine",
    arg_required_else_help = true
)]
struct Cli;

fn main() {
    Cli::parse();
}
