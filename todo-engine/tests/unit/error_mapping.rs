use todo_engine::application::error::TodoError;

#[test]
fn cli_exit_codes_map_by_variant() {
    assert_eq!(TodoError::Policy("x".into()).cli_exit_code(), 2);
    assert_eq!(TodoError::Validation("x".into()).cli_exit_code(), 2);
    assert_eq!(TodoError::NotFound("x".into()).cli_exit_code(), 4);
    assert_eq!(TodoError::Storage("x".into()).cli_exit_code(), 1);
    assert_eq!(TodoError::Migration("x".into()).cli_exit_code(), 1);
    assert_eq!(TodoError::Internal("x".into()).cli_exit_code(), 1);
}

#[test]
fn http_status_codes_map_by_variant() {
    assert_eq!(TodoError::Policy("x".into()).http_status_code(), 400);
    assert_eq!(TodoError::Validation("x".into()).http_status_code(), 400);
    assert_eq!(TodoError::NotFound("x".into()).http_status_code(), 404);
    assert_eq!(TodoError::Storage("x".into()).http_status_code(), 500);
    assert_eq!(TodoError::Migration("x".into()).http_status_code(), 500);
    assert_eq!(TodoError::Internal("x".into()).http_status_code(), 500);
}

#[test]
fn downcast_maps_only_todo_errors() {
    let wrapped = anyhow::Error::new(TodoError::NotFound("x".into()));
    assert_eq!(TodoError::cli_exit_code_from_error(&wrapped), Some(4));
    assert_eq!(
        TodoError::cli_exit_code_from_error(&anyhow::anyhow!("plain")),
        None
    );
}
