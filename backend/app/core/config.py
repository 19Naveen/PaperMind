"""Application settings. Read from environment / .env, documented in backend/.env.example."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = "postgresql+psycopg://papermind:papermind@localhost:5432/papermind"

    project_name: str = "PaperMind API"

    # Browser origins allowed to call the API, comma-separated in CORS_ORIGINS.
    # Must stay an explicit allowlist: the frontend sends cookies, and browsers reject
    # wildcard origins on credentialed requests (CLAUDE.md §5 forbids "*" regardless).
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

    # Signs auth cookies. The default is dev-only — production MUST set SESSION_SECRET.
    session_secret: SecretStr = SecretStr("dev-only-insecure-session-secret")

    # Object storage. Local filesystem now; S3/MinIO later (storage.py is the swap point).
    storage_dir: str = str(BACKEND_DIR / "storage")

    # LLM provider. "gemini" is the only real provider today; "fake" exists for tests.
    llm_provider: str = "gemini"
    llm_model: str = "gemini-1.5-flash-latest"
    # Stored as SecretStr so it never lands in a repr/log (CLAUDE.md §3.3); read through
    # the `gemini_api_key` property below, which llm.py uses.
    gemini_api_key_secret: SecretStr | None = Field(default=None, validation_alias="GEMINI_API_KEY")

    # Embedding provider. "sentence-transformers" is the offline default; "gemini" uses
    # the embedding API; "fake" is deterministic and for tests only.
    embedding_provider: str = "sentence-transformers"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dim: int = 384

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def gemini_api_key(self) -> str | None:
        return self.gemini_api_key_secret.get_secret_value() if self.gemini_api_key_secret else None

    @property
    def model_id(self) -> str:
        return f"{self.llm_provider}:{self.llm_model}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
