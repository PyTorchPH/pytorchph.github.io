//! What one mail revision contains, the rules it must satisfy, and its content hash.
//!
//! Module map:
//!   Content              recipients, subject, body, optional PDF text, routing roles
//!   is_valid_content     recipient list and text bounds
//!   └─ is_valid_address  one plain `local@domain` address
//!   content_hash         SHA-256 of the canonical JSON (what approvals and dispatch pin)
//!   is_editable_status   draft or ready: not yet released
//!   is_delivery_outcome  sent, uncertain or failed
//!   names_sent_message   a "sent" outcome must carry the provider's message id
use super::roles::has_no_duplicates;
use crate::{ApiResult, internal};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_RECIPIENTS: usize = 25;
const MAX_ADDRESS_LENGTH: usize = 320;
const MAX_SUBJECT_LENGTH: usize = 200;
const MAX_TEXT_LENGTH: usize = 20_000;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct Content {
    pub(super) recipients: Vec<String>,
    pub(super) subject: String,
    pub(super) body: String,
    pub(super) pdf_text: Option<String>,
    pub(super) required_roles: Vec<String>,
    pub(super) sender_role: String,
}

pub(super) fn is_valid_content(
    recipients: &[String],
    subject: &str,
    body: &str,
    pdf_text: Option<&str>,
) -> bool {
    !recipients.is_empty()
        && recipients.len() <= MAX_RECIPIENTS
        && recipients.iter().all(|address| is_valid_address(address))
        && has_no_duplicates(recipients)
        && !subject.trim().is_empty()
        && subject.len() <= MAX_SUBJECT_LENGTH
        && !body.trim().is_empty()
        && body.len() <= MAX_TEXT_LENGTH
        && pdf_text.is_none_or(|text| text.len() <= MAX_TEXT_LENGTH)
}

#[inline]
fn is_valid_address(address: &str) -> bool {
    address.len() <= MAX_ADDRESS_LENGTH
        && !address.is_empty()
        && !address
            .bytes()
            .any(|value| value.is_ascii_whitespace() || value.is_ascii_control())
        && address.split('@').count() == 2
        && address.split('@').all(|part| !part.is_empty())
}

pub(super) fn content_hash(content: &Content) -> ApiResult<String> {
    let json = serde_json::to_vec(content).map_err(internal)?;
    Ok(hex::encode(Sha256::digest(json)))
}

#[inline]
pub(super) fn is_editable_status(status: &str) -> bool {
    status == "draft" || status == "ready"
}

#[inline]
pub(super) fn is_delivery_outcome(status: &str) -> bool {
    matches!(status, "sent" | "uncertain" | "failed")
}

#[inline]
pub(super) fn names_sent_message(status: &str, external_message_id: Option<&str>) -> bool {
    status != "sent" || !external_message_id.unwrap_or("").is_empty()
}
