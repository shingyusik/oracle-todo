use oracle_todo::application::error::TodoError;

#[test]
fn policy_errors_map_to_exit_code_two() {
    assert_eq!(TodoError::Policy("x".to_string()).cli_exit_code(), 2);
}

#[test]
fn not_found_errors_map_to_http_404() {
    assert_eq!(
        TodoError::NotFound("item_1".to_string()).http_status_code(),
        404
    );
}
