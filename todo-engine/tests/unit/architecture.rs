use std::fs;
use std::path::Path;

/// The domain layer must stay pure: no references to outer layers or I/O crates.
#[test]
fn domain_has_no_outward_dependencies() {
    let forbidden = [
        "crate::application",
        "crate::infrastructure",
        "crate::interfaces",
        "rusqlite",
        "axum",
    ];
    let domain = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/domain");
    let mut checked = 0;
    for entry in fs::read_dir(&domain).expect("read src/domain") {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let source = fs::read_to_string(&path).unwrap();
        for needle in forbidden {
            assert!(
                !source.contains(needle),
                "{} must not reference `{needle}` (domain stays pure)",
                path.display()
            );
        }
        checked += 1;
    }
    assert!(
        checked >= 2,
        "expected to scan domain modules, found {checked}"
    );
}
