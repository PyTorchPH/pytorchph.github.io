//! Query-string parameters of leaderboard requests.
//!
//! Module map:
//!   query_param   one decoded value from an optional query string
//!   page          1-based page number (default 1)
//!   page_size     rows per page (default 25, at most MAX_PAGE_SIZE)
//!   view          both / verified / pending (default both)

const MAX_PAGE_SIZE: usize = 100;
const DEFAULT_PAGE_SIZE: usize = 25;

pub(super) fn query_param(query: Option<&str>, name: &str) -> Option<String> {
    url::form_urlencoded::parse(query.unwrap_or_default().as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

#[inline]
pub(super) fn page(query: Option<&str>) -> usize {
    query_param(query, "page")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1)
}

#[inline]
pub(super) fn page_size(query: Option<&str>) -> usize {
    query_param(query, "pageSize")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE)
}

#[inline]
pub(super) fn view(query: Option<&str>) -> String {
    query_param(query, "view")
        .filter(|value| matches!(value.as_str(), "both" | "verified" | "pending"))
        .unwrap_or_else(|| "both".into())
}
