//! Required mailbox reservation and verification mail with the configured relay as fallback.
use super::verification_unavailable;
use crate::{ApiResult, AppState, identity::email_signup::relay::RelayConfig};
use std::future::Future;
use uuid::Uuid;

// Check required infrastructure before looking up whether an address is registered.
pub(super) fn ensure_configured(state: &AppState) -> ApiResult<()> {
    if state.identity_client.is_none() {
        dependency_failure("identity_configuration", "identity_client_missing");
        return Err(verification_unavailable());
    }
    Ok(())
}

pub(super) async fn reserve_organization_mailbox(
    state: &AppState,
    member_id: Uuid,
    display_name: &str,
) -> ApiResult<String> {
    ensure_configured(state)?;
    let client = state
        .identity_client
        .as_deref()
        .ok_or_else(verification_unavailable)?;
    client
        .provision_mailbox(member_id, display_name)
        .await
        .map(|mailbox| mailbox.address)
        .map_err(|_| {
            dependency_failure("mailbox_reservation", "identity_mailbox_failure");
            verification_unavailable()
        })
}

// Mental model: try private identity delivery, then the configured relay; only acceptance succeeds.
pub(super) async fn deliver_verification(
    state: &AppState,
    relay: Option<&RelayConfig>,
    member_id: Uuid,
    email: &str,
    code: &str,
    organization_email: &str,
    verification_url: &str,
) -> ApiResult<()> {
    let primary = async {
        let client = state
            .identity_client
            .as_deref()
            .ok_or("identity_client_missing")?;
        client
            .send_verification_mail(member_id, email, code, organization_email, verification_url)
            .await
            .map_err(|_| "identity_mail_failure")
    };
    let fallback = async {
        match relay {
            Some(relay) => Some(
                relay
                    .send_verification(
                        &state.http,
                        email,
                        code,
                        organization_email,
                        verification_url,
                    )
                    .await,
            ),
            None => None,
        }
    };
    deliver_with_fallback(primary, fallback)
        .await
        .map_err(|error| {
            dependency_failure("verification_delivery", error);
            verification_unavailable()
        })
}

async fn deliver_with_fallback(
    primary: impl Future<Output = Result<(), &'static str>>,
    fallback: impl Future<Output = Option<Result<(), &'static str>>>,
) -> Result<(), &'static str> {
    let primary_error = match primary.await {
        Ok(()) => return Ok(()),
        Err(error) => error,
    };
    let Some(result) = fallback.await else {
        return Err(primary_error);
    };
    tracing::warn!(
        event = "auth.verification_delivery_fallback",
        component = "auth",
        operation = "signup_start",
        outcome = if result.is_ok() { "success" } else { "failure" },
        primary_error,
        transport = "configured_mail_relay",
        "Private verification delivery failed; attempted configured relay"
    );
    result
}

fn dependency_failure(stage: &'static str, error: &'static str) {
    tracing::error!(
        event = "auth.signup_dependency_unavailable",
        component = "auth",
        operation = "signup_start",
        outcome = "failure",
        stage,
        error,
        "Required registration service is unavailable"
    );
}

#[cfg(test)]
mod tests;
