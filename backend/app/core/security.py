"""Password and signed-session-cookie primitives."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import uuid
from functools import lru_cache

from fastapi import Response

from app.core.config import get_settings

COOKIE_NAME = "papermind_session"

_N, _R, _P, _DKLEN = 1 << 14, 8, 1, 32
_COOKIE_SECURE = os.getenv("COOKIE_SECURE", "").lower() in {"1", "true", "yes"}

_settings = get_settings()


def hash_password(password: str) -> str:
    """Return a scrypt password hash. Never log or return the result."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    parts = stored.split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        return False
    _, n, r, p, salt_hex, hash_hex = parts
    try:
        expected = bytes.fromhex(hash_hex)
        digest = hashlib.scrypt(
            password.encode(),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
        )
    except ValueError:
        return False
    return hmac.compare_digest(digest, expected)


@lru_cache(maxsize=1)
def dummy_password_hash() -> str:
    """Use during unknown-email login to avoid a timing oracle."""
    return hash_password(secrets.token_urlsafe(16))


def sign_session(user_id: str) -> str:
    key = _settings.session_secret.get_secret_value().encode()
    return hmac.new(key, user_id.encode(), hashlib.sha256).hexdigest()


def read_session_cookie(raw: str) -> uuid.UUID | None:
    user_id, _, signature = raw.partition(".")
    if not signature or not hmac.compare_digest(signature, sign_session(user_id)):
        return None
    try:
        return uuid.UUID(user_id)
    except ValueError:
        return None


def set_session_cookie(response: Response, user_id: uuid.UUID) -> None:
    response.set_cookie(
        COOKIE_NAME,
        f"{user_id}.{sign_session(str(user_id))}",
        httponly=True,
        samesite="lax",
        secure=_COOKIE_SECURE,
        path="/",
        max_age=60 * 60 * 24 * 14,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="lax")
