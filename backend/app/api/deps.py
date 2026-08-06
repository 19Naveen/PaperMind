"""Shared request-scoped FastAPI dependencies."""

from __future__ import annotations

from collections.abc import Generator
from typing import Annotated

from fastapi import Cookie, Depends
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.core.errors import ApiError, Code
from app.core.security import COOKIE_NAME, read_session_cookie
from app.models import User


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DB = Annotated[Session, Depends(get_db)]


def current_user(
    db: DB,
    session_cookie: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
) -> User:
    """Deny anonymous access to authenticated routes."""
    user_id = read_session_cookie(session_cookie) if session_cookie else None
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise ApiError(Code.NOT_AUTHENTICATED, "not authenticated", status=401)
    return user


CurrentUser = Annotated[User, Depends(current_user)]
