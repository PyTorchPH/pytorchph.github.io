//! Field rules shared by review and appeal requests.
//!
//! Module map:
//!   trimmed_text      a string field, trimmed, or "" when missing
//!   is_valid_reason   a decision reason of 4 to 1200 characters
use serde_json::Value;

const MIN_REASON_CHARS: usize = 4;
const MAX_REASON_CHARS: usize = 1200;

#[inline]
pub(crate) fn trimmed_text<'a>(input: &'a Value, name: &str) -> &'a str {
    input
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
}

#[inline]
pub(crate) fn is_valid_reason(reason: &str) -> bool {
    (MIN_REASON_CHARS..=MAX_REASON_CHARS).contains(&reason.chars().count())
}
