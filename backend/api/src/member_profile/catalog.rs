//! The profile answer options compiled into the binary; database rows store only their codes.
//! (Schools live in the searchable directory, see crate::schools.)
//!
//! Module map (caller-first):
//!   options / has_option / option_label   the answer lists (gender, region, interest, …)
use serde_json::Value;
use std::sync::OnceLock;

pub(crate) const UNLISTED_SCHOOL: &str = "unlisted";

static OPTIONS: OnceLock<Value> = OnceLock::new();

pub(crate) fn options() -> &'static Value {
    OPTIONS.get_or_init(|| {
        serde_json::from_str(include_str!("../../seeds/reference/profile-options.json"))
            .expect("profile options catalog is valid JSON")
    })
}

/// True when `code` is one of the choices in the named list (e.g. "regions").
pub(crate) fn has_option(list: &str, code: &str) -> bool {
    option_label(list, code).is_some()
}

pub(crate) fn option_label(list: &str, code: &str) -> Option<&'static str> {
    options()
        .get(list)?
        .as_array()?
        .iter()
        .find(|item| item.get("code").and_then(Value::as_str) == Some(code))
        .and_then(|item| item.get("label"))
        .and_then(Value::as_str)
}
