use std::fs;

use health_engine::application::error::HealthError;
use health_engine::application::media::{DEFAULT_MAX_MEDIA_BYTES, MediaStore};
use health_engine::infrastructure::media::LocalMediaStore;
use uuid::{Uuid, Variant, Version};

const PNG: &[u8] = &[
    0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 10, b'I', b'D', b'A', b'T',
    0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, b'I', b'E', b'N',
    b'D', 0xae, 0x42, 0x60, 0x82,
];
const JPEG: &[u8] = &[
    0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff,
    0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9,
];
const WEBP: &[u8] = &[
    b'R', b'I', b'F', b'F', 14, 0, 0, 0, b'W', b'E', b'B', b'P', b'V', b'P', b'8', b'L', 1, 0, 0,
    0, 0, 0,
];
const MULTI_CHUNK_WEBP: &[u8] = &[
    b'R', b'I', b'F', b'F', 32, 0, 0, 0, b'W', b'E', b'B', b'P', b'V', b'P', b'8', b'X', 10, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, b'V', b'P', b'8', b'L', 1, 0, 0, 0, 0, 0,
];

#[test]
fn accepts_only_complete_jpeg_png_and_webp_with_matching_mime() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalMediaStore::new(directory.path()).unwrap();

    for (mime_type, bytes, extension) in [
        ("image/jpeg", JPEG, "jpg"),
        ("image/png", PNG, "png"),
        ("image/webp", WEBP, "webp"),
    ] {
        let stored = store
            .finalize(store.stage(mime_type, bytes).unwrap())
            .unwrap();
        let id = Uuid::parse_str(stored.id()).unwrap();
        assert_eq!(id.get_version(), Some(Version::Random));
        assert_eq!(id.get_variant(), Variant::RFC4122);
        assert_eq!(
            stored.relative_path().extension().unwrap(),
            extension,
            "{mime_type}"
        );
        assert_eq!(
            fs::read(directory.path().join(stored.relative_path())).unwrap(),
            bytes
        );
    }

    for (mime_type, bytes) in [
        ("text/plain", b"not-image".as_slice()),
        ("image/jpeg", PNG),
        ("image/png", JPEG),
        ("image/webp", PNG),
        ("image/gif", b"GIF89a"),
        ("image/png", &PNG[..16]),
        ("image/jpeg", &JPEG[..JPEG.len() - 2]),
        ("image/webp", &WEBP[..12]),
    ] {
        assert!(
            matches!(
                store.stage(mime_type, bytes),
                Err(HealthError::UnsupportedMedia)
            ),
            "accepted {mime_type} with {} bytes",
            bytes.len()
        );
    }
}

#[test]
fn accepts_bounded_multi_chunk_webp_containers() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalMediaStore::new(directory.path()).unwrap();

    let stored = store
        .finalize(store.stage("image/webp", MULTI_CHUNK_WEBP).unwrap())
        .unwrap();

    assert_eq!(
        fs::read(directory.path().join(stored.relative_path())).unwrap(),
        MULTI_CHUNK_WEBP
    );
}

#[test]
fn enforces_exact_size_boundary_and_rejects_zero_or_overflowing_limits() {
    let exact_directory = tempfile::tempdir().unwrap();
    let exact = LocalMediaStore::with_limit(exact_directory.path(), PNG.len() as u64).unwrap();
    assert!(exact.stage("image/png", PNG).is_ok());

    let small_directory = tempfile::tempdir().unwrap();
    let small =
        LocalMediaStore::with_limit(small_directory.path(), (PNG.len() - 1) as u64).unwrap();
    assert!(matches!(
        small.stage("image/png", PNG),
        Err(HealthError::MediaTooLarge)
    ));
    assert_eq!(fs::read_dir(small_directory.path()).unwrap().count(), 0);

    let invalid_directory = tempfile::tempdir().unwrap();
    assert!(matches!(
        LocalMediaStore::with_limit(invalid_directory.path(), 0),
        Err(HealthError::Validation {
            field: "media.max_bytes",
            ..
        })
    ));
    assert!(matches!(
        LocalMediaStore::with_limit(invalid_directory.path(), u64::MAX),
        Err(HealthError::Validation {
            field: "media.max_bytes",
            ..
        })
    ));
    assert_eq!(
        LocalMediaStore::new(invalid_directory.path())
            .unwrap()
            .max_bytes(),
        DEFAULT_MAX_MEDIA_BYTES
    );
}

#[test]
fn finalize_is_atomic_no_clobber_and_cleans_the_temporary_file_on_collision() {
    let directory = tempfile::tempdir().unwrap();
    let outside = directory.path().join("outside");
    fs::write(&outside, b"protected").unwrap();
    let root = directory.path().join("media");
    let store = LocalMediaStore::new(&root).unwrap();
    let staged = store.stage("image/png", PNG).unwrap();
    let target = root.join(staged.relative_path());
    symlink_file(&outside, &target);

    assert!(matches!(
        store.finalize(staged),
        Err(HealthError::Conflict(_))
    ));
    assert_eq!(fs::read(&outside).unwrap(), b"protected");
    let names = fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    assert_eq!(names, vec![target.file_name().unwrap()]);
}

#[test]
fn rejects_symlink_roots_traversal_and_symlink_removal_targets() {
    let directory = tempfile::tempdir().unwrap();
    let real_root = directory.path().join("real");
    fs::create_dir(&real_root).unwrap();
    let linked_root = directory.path().join("linked");
    symlink_dir(&real_root, &linked_root);
    assert!(matches!(
        LocalMediaStore::new(&linked_root),
        Err(HealthError::Storage(_))
    ));

    let store = LocalMediaStore::new(&real_root).unwrap();
    for path in [
        std::path::Path::new("../outside.png"),
        std::path::Path::new("/tmp/outside.png"),
        std::path::Path::new("nested/file.png"),
        std::path::Path::new("not-a-uuid.png"),
    ] {
        assert!(matches!(
            store.remove(path),
            Err(HealthError::Validation {
                field: "media.relative_path",
                ..
            })
        ));
    }

    let outside = directory.path().join("outside");
    fs::write(&outside, b"protected").unwrap();
    let id = Uuid::new_v4();
    let linked_file = real_root.join(format!("{id}.png"));
    symlink_file(&outside, &linked_file);
    assert!(matches!(
        store.remove(linked_file.file_name().unwrap().as_ref()),
        Err(HealthError::Storage(_))
    ));
    assert_eq!(fs::read(&outside).unwrap(), b"protected");
}

#[cfg(unix)]
fn symlink_file(original: &std::path::Path, link: &std::path::Path) {
    std::os::unix::fs::symlink(original, link).unwrap();
}

#[cfg(windows)]
fn symlink_file(original: &std::path::Path, link: &std::path::Path) {
    std::os::windows::fs::symlink_file(original, link).unwrap();
}

#[cfg(unix)]
fn symlink_dir(original: &std::path::Path, link: &std::path::Path) {
    std::os::unix::fs::symlink(original, link).unwrap();
}

#[cfg(windows)]
fn symlink_dir(original: &std::path::Path, link: &std::path::Path) {
    std::os::windows::fs::symlink_dir(original, link).unwrap();
}
