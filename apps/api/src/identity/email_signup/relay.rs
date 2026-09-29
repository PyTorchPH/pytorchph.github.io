//! Delivers verification codes through the organization's HTTPS mail relay.
//!
//! Module map (caller-first):
//!   RelayConfig::from_env     MAIL_RELAY_URL + MAIL_RELAY_TOKEN, both or neither
//!   └─ is_safe_relay_url      https, default port, no credentials, query or fragment
//!   RelayConfig::send_code    posts the code, then requires {"accepted": true}
//!   └─ read_bounded_body      reads at most 4 KiB of the relay's reply
use serde::Deserialize;
use std::env;

const MAX_ACK_BYTES: usize = 4096;

pub struct RelayConfig {
    url: url::Url,
    token: String,
}

#[derive(Deserialize)]
struct RelayAck {
    accepted: bool,
}

impl RelayConfig {
    pub fn from_env() -> Result<Option<Self>, Box<dyn std::error::Error>> {
        let (Ok(raw_url), Ok(token)) = (env::var("MAIL_RELAY_URL"), env::var("MAIL_RELAY_TOKEN"))
        else {
            if env::var_os("MAIL_RELAY_URL").is_some() || env::var_os("MAIL_RELAY_TOKEN").is_some()
            {
                return Err(
                    "MAIL_RELAY_URL and MAIL_RELAY_TOKEN must be configured together".into(),
                );
            }
            return Ok(None);
        };
        let url = url::Url::parse(&raw_url)?;
        if !is_safe_relay_url(&url) || token.is_empty() {
            return Err("Invalid HTTPS mail relay configuration".into());
        }
        Ok(Some(Self { url, token }))
    }

    /// Mental model: a relay transport error, a non-2xx status, an oversized or malformed
    /// reply, or an explicit refusal all count as "not delivered".
    pub(super) async fn send_code(
        &self,
        http: &reqwest::Client,
        to: &str,
        code: &str,
    ) -> Result<(), &'static str> {
        let response = http.post(self.url.clone()).bearer_auth(&self.token)
            .json(&serde_json::json!({
                "to": to,
                "subject": "PyTorch PH verification code",
                "text": format!("Your PyTorch PH verification code is {code}. It expires in 10 minutes. If you did not request this, ignore this email."),
            }))
            .send().await.map_err(|_| "relay_transport_failure")?;
        if !response.status().is_success() {
            tracing::warn!(event = "auth.mail_relay_rejected", status = %response.status(), "Mail relay returned non-success status");
            return Err("relay_http_status");
        }
        let body = read_bounded_body(response).await?;
        let ack: RelayAck = serde_json::from_slice(&body).map_err(|_| "relay_invalid_json")?;
        if !ack.accepted {
            return Err("relay_not_accepted");
        }
        Ok(())
    }
}

#[inline]
fn is_safe_relay_url(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.host().is_some()
        && !url.port().is_some_and(|port| port != 443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
}

async fn read_bounded_body(mut response: reqwest::Response) -> Result<Vec<u8>, &'static str> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "relay_body_failure")? {
        if body.len() + chunk.len() > MAX_ACK_BYTES {
            return Err("relay_body_too_large");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[cfg(test)]
mod relay_tests {
    use super::*;
    use axum::{Json, Router, http::HeaderMap, routing::post};

    #[tokio::test]
    async fn relay_requires_json_acceptance_and_sends_private_bearer_auth() {
        let router = Router::new().route(
            "/send",
            post(
                |headers: HeaderMap, Json(body): Json<serde_json::Value>| async move {
                    assert_eq!(
                        headers.get("authorization").unwrap(),
                        "Bearer private-test-token"
                    );
                    assert_eq!(body["to"], "member@example.test");
                    Json(serde_json::json!({"accepted": true}))
                },
            ),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/send", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let relay = RelayConfig {
            url: url.parse().unwrap(),
            token: "private-test-token".into(),
        };
        assert!(
            relay
                .send_code(&reqwest::Client::new(), "member@example.test", "12345678")
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn relay_rejects_negative_json_acknowledgement() {
        let router = Router::new().route(
            "/send",
            post(|| async { Json(serde_json::json!({"accepted": false})) }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/send", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let relay = RelayConfig {
            url: url.parse().unwrap(),
            token: "private-test-token".into(),
        };
        assert_eq!(
            relay
                .send_code(&reqwest::Client::new(), "member@example.test", "12345678")
                .await,
            Err("relay_not_accepted")
        );
    }
}
