"""Application settings. Read from environment / .env, documented in backend/.env.example."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = "postgresql+psycopg://papermind:papermind@localhost:5432/papermind"

    project_name: str = "PaperMind API"

    # Object storage. Local filesystem now; S3/MinIO later (storage.py is the swap point).
    storage_dir: str = str(BACKEND_DIR / "storage")

    # LLM provider. "gemini" is the only real provider today; "fake" exists for tests.
    llm_provider: str = "gemini"
    llm_model: str = "gemini-1.5-flash-latest"
    gemini_api_key: str | None = None

    # Embedding provider. "sentence-transformers" is the offline default; "gemini" uses
    # the embedding API; "fake" is deterministic and for tests only.
    embedding_provider: str = "sentence-transformers"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dim: int = 384

    @property
    def model_id(self) -> str:
        return f"{self.llm_provider}:{self.llm_model}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
