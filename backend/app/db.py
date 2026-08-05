"""Engine + session. One implementation; the only swap point is the DATABASE_URL."""

from __future__ import annotations

from collections.abc import Generator
from typing import Annotated, ClassVar

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    type_annotation_map: ClassVar[dict[type, object]] = {  # mypy plugin resolves this
        dict: JSONB,
        list: JSONB,
    }


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DB = Annotated[Session, Depends(get_db)]
