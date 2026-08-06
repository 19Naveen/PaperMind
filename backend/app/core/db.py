"""Engine + session. One implementation; the only swap point is the DATABASE_URL."""

from __future__ import annotations

from typing import ClassVar
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    type_annotation_map: ClassVar[dict[type, object]] = {  # mypy plugin resolves this
        dict: JSONB,
        list: JSONB,
    }

