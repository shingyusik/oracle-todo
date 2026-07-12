# Goal Period Error Feedback Design

**Date:** 2026-07-12
**Status:** Awaiting user review
**Scope:** Return machine-readable Goal policy errors from the API and show user-facing feedback for failed inline period changes.

## Goal

Replace unhandled `todo-engine returned 400` errors with a clear modal that explains why an inline Goal period change was rejected.

## API Error Contract

All API error responses retain the existing `detail` field and add a stable `code` field.

```json
{
  "code": "goal_parent_horizon_not_coarser",
  "detail": "Goal parent horizon (month) must be strictly coarser than child horizon (year)"
}
```

`detail` remains suitable for logs and diagnostics. Frontend behavior must use `code`, not message text.

## Error Codes

| Code | Meaning |
| --- | --- |
| `goal_parent_horizon_not_coarser` | A Goal period is not finer than its Parent Goal period. |
| `goal_duplicate_period` | A Goal already exists with the same horizon, canonical period, and Parent. |
| `goal_invalid_anchor` | The scheduled value is not the canonical anchor for the selected horizon. |
| `validation_error` | Request data fails validation without a Goal-specific code. |
| `policy_error` | A policy rule fails without a Goal-specific code. |
| `not_found` | A referenced item does not exist. |
| `internal_error` | The service cannot complete the request. |

## Frontend Behavior

`patchItem` parses the JSON error response and throws an error object carrying `status`, `code`, and `detail`.

`GoalPeriodControl` catches a rejected inline period commit, leaves the persisted period unchanged, and opens a modal. Detail and creation controls do not PATCH during period selection and do not use this error path.

For `goal_parent_horizon_not_coarser` while selecting Year, the modal shows:

- Title: `Year로 변경할 수 없음`
- Body: `현재 Parent가 Month 기간입니다. Goal은 Parent보다 더 작은 기간만 사용할 수 있습니다.`
- Action: `확인`

Other known codes use concise Korean explanations. Unknown failures use `기간을 변경하지 못했습니다. 다시 시도해 주세요.`

Closing the modal returns focus to the period trigger.

## Verification

- Rust API tests assert `code` and `detail` for Goal nesting, duplicate-period, and anchor errors.
- Frontend tests assert JSON error parsing and the parent-horizon modal after an inline PATCH rejection.
- The modal keeps the prior period and restores focus to the trigger after dismissal.

## Boundaries

- No database schema change.
- No change to Goal nesting policy.
- No parsing of server message text in the frontend.
- No error modal for detail or creation drafts before their existing save or create requests.
