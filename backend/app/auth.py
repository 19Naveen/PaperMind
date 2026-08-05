"""Identity: password hashing, signed session cookies, and the deny-by-default
`current_user` dependency other routers depend on (CLAUDE.md §5).

Standard library only. `hashlib.scrypt` for passwords, HMAC-SHA256 for the cookie
signature: a signed cookie carrying the user id is enough for one service, and a JWT
would add a dependency plus a key-rotation story this app does not have yet.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import uuid
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response
from sqlalchemy import select

import app.schemas as s
from app.config import get_settings
from app.db import DB
from app.errors import ApiError, Code
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])

settings = get_settings()

COOKIE_NAME = "papermind_session"

# scrypt cost: n=2**14, r=8 is ~16 MiB and ~50 ms per hash — the interactive-login tuning.
_N, _R, _P, _DKLEN = 1 << 14, 8, 1, 32

# HTTPS-only cookie. Default off so local http://localhost dev works; set COOKIE_SECURE=1
# in any deployed environment. This read belongs in config.py, which this change does not
# own — flagged in the handover rather than edited.
_COOKIE_SECURE = os.getenv("COOKIE_SECURE", "").lower() in {"1", "true", "yes"}

_SAME_ERROR = "invalid email or password"


def hash_password(password: str) -> str:
    """`scrypt$n$r$p$salt_hex$hash_hex`. Never log or return the result."""
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    parts = stored.split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        return False
    _, n, r, p, salt_hex, hash_hex = parts
    try:
        expected = bytes.fromhex(hash_hex)
        dk = hashlib.scrypt(
            password.encode(),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
        )
    except ValueError:
        return False
    return hmac.compare_digest(dk, expected)


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    """Verified against on unknown-email logins so response time does not reveal whether
    the address exists."""
    return hash_password(secrets.token_urlsafe(16))


def _sign(user_id: str) -> str:
    key = settings.session_secret.get_secret_value().encode()
    return hmac.new(key, user_id.encode(), hashlib.sha256).hexdigest()


def _cookie_value(user_id: uuid.UUID) -> str:
    return f"{user_id}.{_sign(str(user_id))}"


def _read_cookie(raw: str) -> uuid.UUID | None:
    user_id, _, signature = raw.partition(".")
    if not signature or not hmac.compare_digest(signature, _sign(user_id)):
        return None
    try:
        return uuid.UUID(user_id)
    except ValueError:
        return None


def _set_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        COOKIE_NAME,
        _cookie_value(user.id),
        httponly=True,  # §4.1: browser JS must never be able to read the session token
        samesite="lax",
        secure=_COOKIE_SECURE,
        path="/",
        max_age=60 * 60 * 24 * 14,
    )


def current_user(
    db: DB,
    session_cookie: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
) -> User:
    """Deny-by-default. Depend on this from any router that must not serve anonymously."""
    user_id = _read_cookie(session_cookie) if session_cookie else None
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise ApiError(Code.NOT_AUTHENTICATED, "not authenticated", status=401)
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def _user_out(user: User) -> s.UserOut:
    return s.UserOut(id=user.id, email=user.email, name=user.name, role=user.role)


@router.post("/signup", response_model=s.UserOut, status_code=201)
def signup(body: s.SignupIn, response: Response, db: DB) -> s.UserOut:
    email = body.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise ApiError(Code.EMAIL_TAKEN, "an account with this email already exists", status=409)
    user = User(email=email, name=body.name, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    _set_cookie(response, user)
    return _user_out(user)


@router.post("/login", response_model=s.UserOut)
def login(body: s.LoginIn, response: Response, db: DB) -> s.UserOut:
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    # Same message, same status, same work either way: the response must not say which
    # half was wrong, and must not take a shorter path when the account does not exist.
    if not verify_password(body.password, user.password_hash if user else _dummy_hash()):
        raise ApiError(Code.INVALID_CREDENTIALS, _SAME_ERROR, status=401)
    if user is None:
        raise ApiError(Code.INVALID_CREDENTIALS, _SAME_ERROR, status=401)
    _set_cookie(response, user)
    return _user_out(user)


@router.post("/logout", response_model=dict[str, str])
def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="lax")
    return {"status": "signed out"}


@router.get("/me", response_model=s.UserOut)
def me(user: CurrentUser) -> s.UserOut:
    return _user_out(user)
