"""Authentication HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Response
from sqlalchemy import select

import app.schemas as s
from app.api.deps import CurrentUser, DB
from app.core.errors import ApiError, Code
from app.core.security import (
    clear_session_cookie,
    dummy_password_hash,
    hash_password,
    set_session_cookie,
    verify_password,
)
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])

_SAME_ERROR = "invalid email or password"


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
    set_session_cookie(response, user.id)
    return _user_out(user)


@router.post("/login", response_model=s.UserOut)
def login(body: s.LoginIn, response: Response, db: DB) -> s.UserOut:
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    # Same message, same status, same work either way: the response must not say which
    # half was wrong, and must not take a shorter path when the account does not exist.
    if not verify_password(body.password, user.password_hash if user else dummy_password_hash()):
        raise ApiError(Code.INVALID_CREDENTIALS, _SAME_ERROR, status=401)
    if user is None:
        raise ApiError(Code.INVALID_CREDENTIALS, _SAME_ERROR, status=401)
    set_session_cookie(response, user.id)
    return _user_out(user)


@router.post("/logout", response_model=dict[str, str])
def logout(response: Response) -> dict[str, str]:
    clear_session_cookie(response)
    return {"status": "signed out"}


@router.get("/me", response_model=s.UserOut)
def me(user: CurrentUser) -> s.UserOut:
    return _user_out(user)


@router.patch("/me", response_model=s.UserOut)
def update_me(body: s.MeUpdate, user: CurrentUser, db: DB) -> s.UserOut:
    """Self-serve profile edits. PATCH semantics: only fields actually sent change."""
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        if field == "email":
            email = value.strip().lower()
            taken = db.scalar(select(User).where(User.email == email, User.id != user.id))
            if taken:
                raise ApiError(
                    Code.EMAIL_TAKEN, "an account with this email already exists", status=409
                )
            user.email = email
        else:
            setattr(user, field, value)
    db.commit()
    return _user_out(user)


@router.patch("/me/password", status_code=204)
def update_password(body: s.PasswordUpdate, user: CurrentUser, db: DB) -> None:
    if not verify_password(body.current_password, user.password_hash):
        raise ApiError(Code.WRONG_PASSWORD, "current password is incorrect", status=400)
    user.password_hash = hash_password(body.new_password)
    db.commit()
