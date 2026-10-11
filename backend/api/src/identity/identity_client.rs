//! Staged private identity client. No route or startup path uses it until the migration cutover.
#![allow(dead_code)]

use reqwest::{Certificate, Client, Identity, StatusCode, Url};
use serde::Deserialize;
use std::{
    error::Error,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use url::Host;
use uuid::Uuid;

pub(crate) struct IdentityClient {
    http: Client,
    base: Url,
}

#[derive(Clone, Copy)]
pub(crate) enum NamePurpose {
    PublicProfile,
    OrganizationChart,
}

impl NamePurpose {
    fn code(self) -> &'static str {
        match self {
            Self::PublicProfile => "public_profile",
            Self::OrganizationChart => "organization_chart",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NameReply {
    display_name: String,
}

#[derive(Debug)]
pub(crate) enum IdentityError {
    InvalidConfiguration,
    Unavailable,
}

impl IdentityClient {
    /// PEM material must come from secret files outside the repository and never reach the browser.
    pub(crate) fn from_pem(
        base_url: &str,
        client_cert_pem: &[u8],
        client_key_pem: &[u8],
        server_ca_pem: &[u8],
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let base = Url::parse(base_url)?;
        let private_host = match base.host() {
            Some(Host::Ipv4(ip)) => ip.is_private() || ip.is_loopback(),
            Some(Host::Ipv6(ip)) => ip.is_unique_local() || ip.is_loopback(),
            _ => false,
        };
        if base.scheme() != "https"
            || !private_host
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
            || base.path() != "/"
        {
            return Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "private identity URL required",
            )));
        }
        let mut combined_pem = Vec::with_capacity(client_cert_pem.len() + client_key_pem.len() + 1);
        combined_pem.extend_from_slice(client_cert_pem);
        combined_pem.push(b'\n');
        combined_pem.extend_from_slice(client_key_pem);
        let identity = Identity::from_pem(&combined_pem)?;
        let server_ca = Certificate::from_pem(server_ca_pem)?;
        let http = Client::builder()
            .https_only(true)
            .tls_certs_only([server_ca])
            .identity(identity)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()?;
        Ok(Self { http, base })
    }

    /// The website authenticates the viewer before calling this method; no bulk API exists.
    pub(crate) async fn display_name(
        &self,
        member_id: Uuid,
        viewer_id: Uuid,
        purpose: NamePurpose,
    ) -> Result<Option<String>, IdentityError> {
        let url = self
            .base
            .join(&format!("v1/identities/{member_id}/display-name"))
            .map_err(|_| IdentityError::InvalidConfiguration)?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| IdentityError::Unavailable)?
            .as_secs();
        let mut response = self
            .http
            .get(url)
            .header("x-request-id", Uuid::new_v4().to_string())
            .header("x-viewer-id", viewer_id.to_string())
            .header("x-name-purpose", purpose.code())
            .header("x-request-timestamp", timestamp.to_string())
            .send()
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        match response.status() {
            StatusCode::OK => {
                let mut body = Vec::new();
                while let Some(chunk) = response
                    .chunk()
                    .await
                    .map_err(|_| IdentityError::Unavailable)?
                {
                    if body.len().saturating_add(chunk.len()) > 4096 {
                        return Err(IdentityError::Unavailable);
                    }
                    body.extend_from_slice(&chunk);
                }
                let reply: NameReply =
                    serde_json::from_slice(&body).map_err(|_| IdentityError::Unavailable)?;
                Ok(Some(reply.display_name))
            }
            StatusCode::NOT_FOUND => Ok(None),
            _ => Err(IdentityError::Unavailable),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::IdentityClient;

    #[test]
    fn rejects_public_or_credential_bearing_urls_before_loading_keys() {
        for url in [
            "http://127.0.0.1:8888/",
            "https://user:pass@127.0.0.1/",
            "https://localhost/",
            "https://47.129.167.4/",
        ] {
            assert!(IdentityClient::from_pem(url, b"", b"", b"").is_err());
        }
    }
}
