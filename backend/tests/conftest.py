"""Test bootstrap. Env is configured BEFORE importing app modules so the engine,
providers, and Vector column width bind to the test database and fake providers."""

from __future__ import annotations

import os
import tempfile

# --- bind to the test database + fake providers before any app module import -----
os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://papermind:papermind@localhost:5433/papermind_test"
)
os.environ.setdefault("EMBEDDING_DIM", "8")
os.environ.setdefault("LLM_PROVIDER", "fake")
os.environ.setdefault("EMBEDDING_PROVIDER", "fake")
os.environ.setdefault("STORAGE_DIR", tempfile.mkdtemp(prefix="papermind-test-"))

import pytest
from sqlalchemy import text

from app import models  # noqa: F401
from app.core.db import SessionLocal, engine
from app.services.llm import FakeEmbedder, FakeLLM, set_providers
from app.models import install_triggers


@pytest.fixture(scope="session", autouse=True)
def _prepare_database():
    _create_database_if_missing()
    from app.core.db import Base

    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    # Drop and rebuild cleanly — the tests own this database.
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    install_triggers(db)
    db.close()
    yield


def _create_database_if_missing() -> None:
    from urllib.parse import unquote, urlparse

    import psycopg

    url = urlparse(os.environ["DATABASE_URL"])
    user, password = unquote(url.username or "papermind"), unquote(url.password or "papermind")
    host, port = url.hostname or "localhost", url.port or 5432
    target = url.path.lstrip("/")

    conninfo = f"host={host} port={port} user={user} password={password}"
    with psycopg.connect(f"{conninfo} dbname=postgres") as conn:
        conn.autocommit = True
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (target,)).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{target}"')
    with psycopg.connect(f"{conninfo} dbname={target}") as conn:
        conn.autocommit = True
        conn.execute("CREATE EXTENSION IF NOT EXISTS vector")


@pytest.fixture(autouse=True)
def _clean_tables():
    from app.models import Base

    tables = ", ".join(Base.metadata.tables.keys())
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture
def providers():
    """A fake provider set that tests can script. Reset per test."""
    script: dict[str, dict] = {}
    set_providers(llm=FakeLLM(script), embedder=FakeEmbedder(dim=8))
    return script


@pytest.fixture
def db():
    db = SessionLocal()
    yield db
    db.close()


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
