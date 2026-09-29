//! Reading and bounding request fields.
//!
//! Module map:
//!   json_body          request bytes → JSON (an empty body is null)
//!   field              a required string field
//!   limited            non-blank and within a length
//!   bounded_strings    an optional list of trimmed strings with item and length caps
//!   └─ bounded_string
use crate::{ApiResult, bad};
use serde_json::Value;

pub(crate) fn json_body(bytes: &[u8]) -> ApiResult<Value> {
    // DELETE requests carry no body.
    if bytes.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(bytes).map_err(|_| bad("Invalid JSON body"))
}

pub(crate) fn field<'a>(body: &'a Value, name: &str) -> ApiResult<&'a str> {
    body.get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| bad("Invalid product action"))
}

#[inline]
pub(crate) fn limited(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max
}

pub(crate) fn bounded_strings(
    value: Option<&Value>,
    max_items: usize,
    max_length: usize,
) -> ApiResult<Vec<String>> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let items = value
        .as_array()
        .ok_or_else(|| bad("Invalid evidence list"))?;
    if items.len() > max_items {
        return Err(bad("Too many evidence values"));
    }
    items
        .iter()
        .map(|item| bounded_string(item, max_length))
        .collect()
}

fn bounded_string(item: &Value, max_length: usize) -> ApiResult<String> {
    let text = item
        .as_str()
        .ok_or_else(|| bad("Invalid evidence value"))?
        .trim();
    if text.len() > max_length {
        return Err(bad("Evidence value is too long"));
    }
    Ok(text.to_owned())
}
