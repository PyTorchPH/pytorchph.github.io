//! Staged private identity client. No route or startup path uses it until the migration cutover.
#![allow(dead_code)]

use reqwest::{Certificate, Client, Identity, Method, StatusCode, Url};
use serde::Deserialize;
use std::{
    error::Error,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use url::Host;
use uuid::Uuid;

#[derive(Clone)]
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

#[derive(Deserialize)]
struct ConsentReply {
    granted: bool,
}

#[derive(Debug)]
pub(crate) enum IdentityError {
    InvalidConfiguration,
    Unavailable,
}

impl IdentityClient {
    pub(crate) async fn organization_photo(
        &self,
        member_id: Uuid,
        viewer_id: Uuid,
    ) -> Result<Option<Vec<u8>>, IdentityError> {
        let response = self
            .photo_request(
                Method::GET,
                member_id,
                viewer_id,
                "organization-photo",
                None,
                None,
            )
            .await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if response.status() != StatusCode::OK {
            return Err(IdentityError::Unavailable);
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        if bytes.is_empty() || bytes.len() > 65_536 {
            return Err(IdentityError::Unavailable);
        }
        Ok(Some(bytes.to_vec()))
    }

    pub(crate) async fn write_organization_photo(
        &self,
        member_id: Uuid,
        bytes: Vec<u8>,
        media_type: &str,
    ) -> Result<(), IdentityError> {
        let response = self
            .photo_request(
                Method::PUT,
                member_id,
                member_id,
                "organization-photo",
                Some(bytes),
                Some(media_type),
            )
            .await?;
        if response.status() == StatusCode::NO_CONTENT {
            Ok(())
        } else {
            Err(IdentityError::Unavailable)
        }
    }

    pub(crate) async fn delete_organization_photo(
        &self,
        member_id: Uuid,
    ) -> Result<(), IdentityError> {
        let response = self
            .photo_request(
                Method::DELETE,
                member_id,
                member_id,
                "organization-photo",
                None,
                None,
            )
            .await?;
        if response.status() == StatusCode::NO_CONTENT {
            Ok(())
        } else {
            Err(IdentityError::Unavailable)
        }
    }

    pub(crate) async fn purge_organization_photo_data(
        &self,
        member_id: Uuid,
    ) -> Result<(), IdentityError> {
        let response = self
            .photo_request(
                Method::DELETE,
                member_id,
                member_id,
                "organization-photo-data",
                None,
                None,
            )
            .await?;
        if response.status() == StatusCode::NO_CONTENT {
            Ok(())
        } else {
            Err(IdentityError::Unavailable)
        }
    }

    pub(crate) async fn organization_photo_consent(
        &self,
        member_id: Uuid,
        granted: Option<bool>,
    ) -> Result<bool, IdentityError> {
        let body = granted.map(|value| {
            serde_json::json!({"granted":value})
                .to_string()
                .into_bytes()
        });
        let response = self
            .photo_request(
                if granted.is_some() {
                    Method::PUT
                } else {
                    Method::GET
                },
                member_id,
                member_id,
                "organization-photo-consent",
                body,
                granted.map(|_| "application/json"),
            )
            .await?;
        if response.status() != StatusCode::OK {
            return Err(IdentityError::Unavailable);
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        if bytes.len() > 4096 {
            return Err(IdentityError::Unavailable);
        }
        serde_json::from_slice::<ConsentReply>(&bytes)
            .map(|value| value.granted)
            .map_err(|_| IdentityError::Unavailable)
    }

    async fn photo_request(
        &self,
        method: Method,
        member_id: Uuid,
        viewer_id: Uuid,
        endpoint: &str,
        body: Option<Vec<u8>>,
        media_type: Option<&str>,
    ) -> Result<reqwest::Response, IdentityError> {
        let url = self
            .base
            .join(&format!("v1/identities/{member_id}/{endpoint}"))
            .map_err(|_| IdentityError::InvalidConfiguration)?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| IdentityError::Unavailable)?
            .as_secs();
        let mut request = self
            .http
            .request(method, url)
            .header("x-request-id", Uuid::new_v4().to_string())
            .header("x-viewer-id", viewer_id.to_string())
            .header("x-name-purpose", NamePurpose::OrganizationChart.code())
            .header("x-request-timestamp", timestamp.to_string());
        if let Some(media_type) = media_type {
            request = request.header("content-type", media_type);
        }
        if let Some(body) = body {
            request = request.body(body);
        }
        request.send().await.map_err(|_| IdentityError::Unavailable)
    }

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

    /// Only the website API may call this after authenticating the member's session.
    pub(crate) async fn organization_name_consent(
        &self,
        member_id: Uuid,
        granted: Option<bool>,
    ) -> Result<bool, IdentityError> {
        let url = self
            .base
            .join(&format!("v1/identities/{member_id}/consent"))
            .map_err(|_| IdentityError::InvalidConfiguration)?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| IdentityError::Unavailable)?
            .as_secs();
        let request = match granted {
            Some(value) => self
                .http
                .put(url)
                .json(&serde_json::json!({"granted":value})),
            None => self.http.get(url),
        };
        let response = request
            .header("x-request-id", Uuid::new_v4().to_string())
            .header("x-viewer-id", member_id.to_string())
            .header("x-name-purpose", NamePurpose::OrganizationChart.code())
            .header("x-request-timestamp", timestamp.to_string())
            .send()
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        if response.status() != StatusCode::OK {
            return Err(IdentityError::Unavailable);
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| IdentityError::Unavailable)?;
        if bytes.len() > 4096 {
            return Err(IdentityError::Unavailable);
        }
        let reply: ConsentReply =
            serde_json::from_slice(&bytes).map_err(|_| IdentityError::Unavailable)?;
        Ok(reply.granted)
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
