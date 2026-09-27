"""Application settings + config path resolution.

Values flow from env vars (loaded via pydantic-settings) but every field has a sensible
default so the static, offline path works without any configuration.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_CONFIG_DIR = PROJECT_ROOT / "config"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="RESUME_",
        extra="ignore",
    )

    llm_provider: str = "openai-compatible"
    llm_model: str | None = None
    llm_api_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-4-6"
    openai_model: str = "gpt-4o-mini"
    google_model: str = "gemini-3.1-pro-preview"
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    google_api_key: str | None = Field(
        default=None,
        validation_alias="GOOGLE_API_KEY",
    )
    gh_user: str | None = None
    github_source: str = "website"
    config_dir: Path = DEFAULT_CONFIG_DIR
    # Per-project measurable-impact metrics the synthesizer grounds bullets on.
    metrics_path: Path = PROJECT_ROOT / "metrics.csv"

    @field_validator("config_dir", mode="before")
    @classmethod
    def _coerce_config_dir(cls, v):
        # Empty env values land here as "" which Path turns into Path('.') silently;
        # treat blank as "use the default".
        if v is None or (isinstance(v, str) and not v.strip()):
            return DEFAULT_CONFIG_DIR
        return v

    @property
    def roles_path(self) -> Path:
        return self.config_dir / "roles.json"

    @property
    def regex_patterns_path(self) -> Path:
        return self.config_dir / "regex_patterns.json"

    @property
    def templates_dir(self) -> Path:
        return self.config_dir / "templates"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
