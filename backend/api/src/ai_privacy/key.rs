//! Domain-separated HMACs: stable subject aliases and short-lived projection capabilities.
use crate::{ApiResult, bad, internal};
use hmac::{Hmac, Mac};
use sha2::Sha256;

pub(crate) struct PrivacyKey {
    bytes: [u8; 32],
    pub(crate) version: String,
}

impl PrivacyKey {
    pub(crate) fn from_env() -> Result<Option<Self>, &'static str> {
        match std::env::var("AI_PSEUDONYM_KEY_HEX") {
            Ok(value) if !value.is_empty() => Self::parse(
                &value,
                &std::env::var("AI_PSEUDONYM_KEY_VERSION").unwrap_or_else(|_| "k1".into()),
            )
            .map(Some),
            _ => Ok(None),
        }
    }

    pub(crate) fn parse(value: &str, version: &str) -> Result<Self, &'static str> {
        let decoded =
            hex::decode(value).map_err(|_| "AI privacy key must be 32 bytes encoded as hex")?;
        let bytes: [u8; 32] = decoded
            .try_into()
            .map_err(|_| "AI privacy key must be 32 bytes encoded as hex")?;
        if bytes.iter().all(|value| *value == 0)
            || version.is_empty()
            || version.len() > 16
            || !version
                .bytes()
                .all(|value| value.is_ascii_alphanumeric() || value == b'-')
        {
            return Err("Invalid AI privacy key or key version");
        }
        Ok(Self {
            bytes,
            version: version.into(),
        })
    }

    pub(crate) fn alias(&self, purpose: &str, entity: &str, id: &str) -> ApiResult<String> {
        Ok(format!(
            "p_{}_{}",
            self.version,
            self.sign(&["alias", purpose, entity, id])?
        ))
    }

    pub(crate) fn sign(&self, parts: &[&str]) -> ApiResult<String> {
        let message =
            serde_json::to_vec(&("pytorch-ph-ai-v1", &self.version, parts)).map_err(internal)?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.bytes).map_err(internal)?;
        mac.update(&message);
        Ok(hex::encode(mac.finalize().into_bytes()))
    }

    pub(crate) fn verify(&self, parts: &[&str], signature: &str) -> ApiResult<()> {
        let bytes = hex::decode(signature).map_err(|_| bad("Invalid AI projection capability"))?;
        let message =
            serde_json::to_vec(&("pytorch-ph-ai-v1", &self.version, parts)).map_err(internal)?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.bytes).map_err(internal)?;
        mac.update(&message);
        mac.verify_slice(&bytes)
            .map_err(|_| bad("Invalid AI projection capability"))
    }
}
