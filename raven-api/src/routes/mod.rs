use axum::extract::Request;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::ApiError;

pub mod dashboard;
pub mod health;
pub mod ledger;
pub mod todo;

const MAX_QUERY_BYTES: usize = 8 * 1024;

pub async fn limit_query(request: Request, next: Next) -> Response {
    if request
        .uri()
        .query()
        .is_some_and(|query| query.len() > MAX_QUERY_BYTES)
    {
        return ApiError::uri_too_long().into_response();
    }
    next.run(request).await
}
