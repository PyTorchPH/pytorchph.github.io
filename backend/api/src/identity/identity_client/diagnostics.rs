//! Dependency diagnostics never inspect URLs, headers, request bodies, or response content.
use reqwest::{Method, StatusCode};
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Operation {
    name: &'static str,
    expected: StatusCode,
}

impl Operation {
    pub(super) fn for_request(method: &Method, endpoint: &str) -> Option<Self> {
        let (name, expected) = match (method.as_str(), endpoint) {
            ("POST", "organization-mailbox") => ("mailbox_reservation", StatusCode::OK),
            ("POST", "verification-mail") => ("verification_delivery", StatusCode::ACCEPTED),
            ("PUT", "organization-photo") => ("write_photo", StatusCode::NO_CONTENT),
            ("DELETE", "organization-photo") => ("remove_photo", StatusCode::NO_CONTENT),
            _ => return None,
        };
        Some(Self { name, expected })
    }

    pub(super) fn record(
        self,
        request_id: Uuid,
        elapsed: Duration,
        result: &Result<reqwest::Response, reqwest::Error>,
    ) {
        match result {
            Ok(response) if response.status() == self.expected => {
                tracing::info!(
                    event = "identity.dependency_accepted",
                    component = "identity-client",
                    operation = self.name,
                    %request_id,
                    duration_ms = elapsed.as_millis() as u64,
                    status = response.status().as_u16(),
                    outcome = "accepted",
                    "Identity dependency accepted request"
                );
            }
            Ok(response) => {
                tracing::warn!(
                    event = "identity.dependency_failed",
                    component = "identity-client",
                    operation = self.name,
                    %request_id,
                    duration_ms = elapsed.as_millis() as u64,
                    status = response.status().as_u16(),
                    reason = "unexpected_status",
                    outcome = "failure",
                    "Identity dependency rejected request"
                );
            }
            Err(error) => {
                tracing::warn!(
                    event = "identity.dependency_failed",
                    component = "identity-client",
                    operation = self.name,
                    %request_id,
                    duration_ms = elapsed.as_millis() as u64,
                    reason = transport_failure(error),
                    outcome = "failure",
                    "Identity dependency transport failed"
                );
            }
        }
    }
}

fn transport_failure(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connect_failed"
    } else {
        "request_failed"
    }
}

#[cfg(test)]
mod tests;
