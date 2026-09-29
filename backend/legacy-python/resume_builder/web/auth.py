"""Local web-auth helpers for the CareerLens prototype.

This module intentionally keeps website identity separate from social scraping
sessions. OAuth providers identify the user and supply an email for pre-filling
Facebook/LinkedIn login. Facebook/LinkedIn still require a visible first login,
then their Playwright storage state is reused by the existing scraper.
"""

from __future__ import annotations

import json
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from ..sources.social.auth import SessionStore


IDENTITY_PROVIDERS = ("github", "google", "microsoft")
SOCIAL_VENDORS = ("facebook", "linkedin")


class WebAuthSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    careerlens_base_url: str = Field(
        default="http://127.0.0.1:8010",
        alias="CAREERLENS_BASE_URL",
    )
    github_client_id: str = Field(default="", alias="GITHUB_CLIENT_ID")
    github_client_secret: str = Field(default="", alias="GITHUB_CLIENT_SECRET")
    google_client_id: str = Field(default="", alias="GOOGLE_CLIENT_ID")
    google_client_secret: str = Field(default="", alias="GOOGLE_CLIENT_SECRET")
    microsoft_client_id: str = Field(default="", alias="MICROSOFT_CLIENT_ID")
    microsoft_client_secret: str = Field(default="", alias="MICROSOFT_CLIENT_SECRET")
    microsoft_tenant: str = Field(default="common", alias="MICROSOFT_TENANT")


@dataclass(frozen=True)
class OAuthProvider:
    name: str
    auth_url: str
    token_url: str
    userinfo_url: str
    scopes: tuple[str, ...]
    id_key: str
    name_key: str
    email_key: str
    emails_url: str | None = None


_PROVIDERS: dict[str, OAuthProvider] = {
    "github": OAuthProvider(
        name="github",
        auth_url="https://github.com/login/oauth/authorize",
        token_url="https://github.com/login/oauth/access_token",
        userinfo_url="https://api.github.com/user",
        scopes=("read:user", "user:email"),
        id_key="id",
        name_key="name",
        email_key="email",
        emails_url="https://api.github.com/user/emails",
    ),
    "google": OAuthProvider(
        name="google",
        auth_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        userinfo_url="https://openidconnect.googleapis.com/v1/userinfo",
        scopes=("openid", "email", "profile"),
        id_key="sub",
        name_key="name",
        email_key="email",
    ),
    "microsoft": OAuthProvider(
        name="microsoft",
        auth_url="https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
        token_url="https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        userinfo_url="https://graph.microsoft.com/v1.0/me",
        scopes=("openid", "email", "profile", "User.Read"),
        id_key="id",
        name_key="displayName",
        email_key="mail",
    ),
}


def default_auth_dir() -> Path:
    base = os.environ.get("RESUME_BUILDER_CACHE")
    root = Path(base) if base else Path.home() / ".cache" / "resume-builder" / "social"
    path = root / "web-auth"
    path.mkdir(parents=True, exist_ok=True)
    return path


class IdentityStore:
    def __init__(self, base_dir: Path | None = None) -> None:
        self._dir = base_dir or default_auth_dir()
        self._dir.mkdir(parents=True, exist_ok=True)
        self._profiles_path = self._dir / "identity_profiles.json"
        self._states_path = self._dir / "oauth_states.json"

    def profiles(self) -> dict[str, dict[str, Any]]:
        return self._read_json(self._profiles_path)

    def save_profile(self, provider: str, profile: dict[str, Any]) -> None:
        profiles = self.profiles()
        profiles[provider] = profile
        self._write_json(self._profiles_path, profiles)

    def clear_profile(self, provider: str) -> bool:
        profiles = self.profiles()
        existed = provider in profiles
        profiles.pop(provider, None)
        self._write_json(self._profiles_path, profiles)
        return existed

    def create_state(self, provider: str) -> str:
        states = self._read_json(self._states_path)
        state = secrets.token_urlsafe(24)
        states[state] = {"provider": provider, "created_at": time.time()}
        self._write_json(self._states_path, states)
        return state

    def pop_state(self, state: str) -> str | None:
        states = self._read_json(self._states_path)
        item = states.pop(state, None)
        self._write_json(self._states_path, states)
        if not item:
            return None
        return str(item.get("provider") or "")

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    @staticmethod
    def _write_json(path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def provider_setup(provider: str) -> tuple[OAuthProvider, str, str, str]:
    cfg = _provider(provider)
    settings = WebAuthSettings()
    prefix = provider.upper()
    client_id = str(getattr(settings, f"{provider}_client_id")).strip()
    client_secret = str(getattr(settings, f"{provider}_client_secret")).strip()
    base_url = settings.careerlens_base_url.rstrip("/")
    missing = [
        name
        for name, value in (
            (f"{prefix}_CLIENT_ID", client_id),
            (f"{prefix}_CLIENT_SECRET", client_secret),
        )
        if not value
    ]
    if missing:
        raise OAuthSetupError(
            f"Missing OAuth setup for {provider}: {', '.join(missing)}"
        )
    return cfg, client_id, client_secret, base_url


def provider_configuration_status() -> dict[str, dict[str, Any]]:
    settings = WebAuthSettings()
    base_url = settings.careerlens_base_url.rstrip("/")
    status: dict[str, dict[str, Any]] = {}
    for provider in IDENTITY_PROVIDERS:
        prefix = provider.upper()
        missing = [
            name
            for name in (f"{prefix}_CLIENT_ID", f"{prefix}_CLIENT_SECRET")
            if not str(getattr(settings, name.lower())).strip()
        ]
        status[provider] = {
            "configured": not missing,
            "missing": missing,
            "redirect_uri": f"{base_url}/auth/{provider}/callback",
        }
    return status


def build_authorize_url(provider: str, store: IdentityStore | None = None) -> str:
    store = store or IdentityStore()
    cfg, client_id, _, base_url = provider_setup(provider)
    state = store.create_state(provider)
    tenant = WebAuthSettings().microsoft_tenant.strip() or "common"
    auth_url = cfg.auth_url.format(tenant=tenant)
    redirect_uri = f"{base_url}/auth/{provider}/callback"
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(cfg.scopes),
        "state": state,
    }
    return f"{auth_url}?{urlencode(params)}"


def complete_oauth_callback(
    provider: str,
    code: str,
    state: str,
    *,
    store: IdentityStore | None = None,
) -> dict[str, Any]:
    store = store or IdentityStore()
    cfg, client_id, client_secret, base_url = provider_setup(provider)
    state_provider = store.pop_state(state)
    if state_provider != provider:
        raise OAuthStateError("Invalid or expired OAuth state.")

    tenant = WebAuthSettings().microsoft_tenant.strip() or "common"
    token_url = cfg.token_url.format(tenant=tenant)
    redirect_uri = f"{base_url}/auth/{provider}/callback"
    token_resp = requests.post(
        token_url,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
        headers={"Accept": "application/json"},
        timeout=20,
    )
    token_resp.raise_for_status()
    token = token_resp.json().get("access_token")
    if not token:
        raise OAuthExchangeError("OAuth token response did not include access_token.")

    profile_resp = requests.get(
        cfg.userinfo_url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=20,
    )
    profile_resp.raise_for_status()
    raw = profile_resp.json()
    if provider == "github" and not raw.get(cfg.email_key) and cfg.emails_url:
        raw["email"] = _fetch_github_primary_email(token, cfg.emails_url)
    profile = normalize_profile(provider, raw)
    store.save_profile(provider, profile)
    return profile


def normalize_profile(provider: str, raw: dict[str, Any]) -> dict[str, Any]:
    cfg = _provider(provider)
    email = raw.get(cfg.email_key) or raw.get("userPrincipalName") or ""
    display_name = raw.get(cfg.name_key) or raw.get("login") or email or provider
    subject_id = raw.get(cfg.id_key) or raw.get("sub") or raw.get("login") or email
    return {
        "provider": provider,
        "subject_id": str(subject_id or ""),
        "email": str(email or ""),
        "display_name": str(display_name or ""),
        "connected_at": int(time.time()),
    }


def auth_status(
    *,
    identity_store: IdentityStore | None = None,
    session_store: SessionStore | None = None,
) -> dict[str, Any]:
    identity_store = identity_store or IdentityStore()
    session_store = session_store or SessionStore()
    profiles = identity_store.profiles()
    identity = {
        provider: {
            "connected": provider in profiles,
            "profile": profiles.get(provider),
        }
        for provider in IDENTITY_PROVIDERS
    }
    social = {
        vendor: {
            "connected": bool(
                session_store.load_storage_state(vendor) or session_store.load(vendor)
            ),
            "has_storage_state": session_store.load_storage_state(vendor) is not None,
            "has_cookies": bool(session_store.load(vendor)),
        }
        for vendor in SOCIAL_VENDORS
    }
    return {"identity": identity, "social": social}


def preferred_identity_email(store: IdentityStore | None = None) -> str | None:
    profiles = (store or IdentityStore()).profiles()
    for provider in IDENTITY_PROVIDERS:
        email = (profiles.get(provider) or {}).get("email")
        if email:
            return str(email)
    return None


def clear_social_session(vendor: str, store: SessionStore | None = None) -> bool:
    store = store or SessionStore()
    existed = bool(store.load(vendor) or store.load_storage_state(vendor))
    store.clear(vendor)
    storage_state = store.storage_state_path(vendor)
    if storage_state.exists():
        try:
            storage_state.unlink()
        except OSError:
            pass
    return existed


class OAuthSetupError(RuntimeError):
    pass


class OAuthStateError(RuntimeError):
    pass


class OAuthExchangeError(RuntimeError):
    pass


def _provider(provider: str) -> OAuthProvider:
    cfg = _PROVIDERS.get(provider)
    if cfg is None:
        raise KeyError(f"Unknown provider: {provider}")
    return cfg


def _fetch_github_primary_email(token: str, emails_url: str) -> str:
    response = requests.get(
        emails_url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=20,
    )
    response.raise_for_status()
    emails = response.json()
    if not isinstance(emails, list):
        return ""
    verified = [
        item
        for item in emails
        if isinstance(item, dict) and item.get("email") and item.get("verified")
    ]
    primary = next((item for item in verified if item.get("primary")), None)
    selected = primary or (verified[0] if verified else None)
    return str((selected or {}).get("email") or "")
