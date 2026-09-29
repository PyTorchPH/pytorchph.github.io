//! How a claim is labelled for officers without exposing who submitted it.
//!
//! Module map:
//!   member_label   "Member 1A2B3C4D" from the member id
//!   department     the officer department responsible for a claim kind
//!   └─ is_external_kind

const LABEL_ID_CHARS: usize = 8;

pub(crate) fn member_label(member_id: &str) -> String {
    let short: String = member_id.chars().take(LABEL_ID_CHARS).collect();
    format!("Member {}", short.to_uppercase())
}

// The officer department responsible for a claim follows from its kind.
pub(crate) fn department(kind: &str) -> &'static str {
    if is_external_kind(kind) {
        "external_relations"
    } else {
        "academics"
    }
}

#[inline]
fn is_external_kind(kind: &str) -> bool {
    matches!(kind, "external_competition" | "external_participation")
}
