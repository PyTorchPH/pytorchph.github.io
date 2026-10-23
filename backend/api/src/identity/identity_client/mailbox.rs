//! Strict wire contract shared with identity-auth's OrganizationMailbox serialization.
use super::IdentityError;
use serde::Deserialize;
use uuid::Uuid;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OrganizationMailbox {
    member_id: Uuid,
    local_part: String,
    pub(crate) address: String,
    status: MailboxStatus,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum MailboxStatus {
    PendingCredentials,
    Active,
    Disabled,
}

pub(super) fn decode_reply(
    bytes: &[u8],
    expected_member_id: Uuid,
) -> Result<OrganizationMailbox, IdentityError> {
    let mailbox: OrganizationMailbox = serde_json::from_slice(bytes).map_err(|_| {
        invalid_reply("invalid_shape");
        IdentityError::Unavailable
    })?;
    if !belongs_to_requested_member(&mailbox, expected_member_id) {
        invalid_reply("invalid_mailbox_binding");
        return Err(IdentityError::Unavailable);
    }
    tracing::debug!(
        event = "identity.mailbox_reply_validated",
        component = "identity-client",
        operation = "mailbox_reservation",
        outcome = "success",
        mailbox_status = ?mailbox.status,
        "Identity mailbox reply passed contract validation"
    );
    Ok(mailbox)
}

fn belongs_to_requested_member(mailbox: &OrganizationMailbox, expected_member_id: Uuid) -> bool {
    mailbox.member_id == expected_member_id
        && (2..=64).contains(&mailbox.local_part.len())
        && mailbox.local_part.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
        && mailbox.address == format!("{}@pytorch.ph", mailbox.local_part)
        && mailbox.address.len() <= 75
}

fn invalid_reply(reason: &'static str) {
    tracing::warn!(
        event = "identity.mailbox_reply_invalid",
        component = "identity-client",
        operation = "mailbox_reservation",
        outcome = "failure",
        reason,
        "Identity mailbox reply failed contract validation"
    );
}

#[cfg(test)]
mod tests;
