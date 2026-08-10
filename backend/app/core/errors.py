"""The single API error contract (CLAUDE.md §3.4).

Every error response — domain, HTTP, or validation — is emitted as::

    {"error": {"code": "PACK_NOT_FOUND", "message": "...", "details": {}}}

`code` is stable and machine-readable; clients branch on it and never parse `message`.
`message` is user-safe prose: stack traces, SQL and internals stay in the logs.

`install_error_handlers(app)` is the only entry point. This module deliberately does not
import or modify `main.py` — the app owner calls the installer during app construction.
"""

from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from starlette.responses import Response


class Code(StrEnum):
    """Error codes with a real raise site. Add one only together with its raise."""

    VALIDATION_ERROR = "VALIDATION_ERROR"

    NOT_AUTHENTICATED = "NOT_AUTHENTICATED"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    EMAIL_TAKEN = "EMAIL_TAKEN"
    WRONG_PASSWORD = "WRONG_PASSWORD"  # noqa: S105 # an error code, not a credential

    WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND"
    SESSION_NOT_FOUND = "SESSION_NOT_FOUND"

    PACK_NOT_INSTALLED = "PACK_NOT_INSTALLED"
    PACK_NO_VERSION = "PACK_NO_VERSION"
    WORKSPACE_PACK_TAKEN = "WORKSPACE_PACK_TAKEN"

    PACK_NOT_FOUND = "PACK_NOT_FOUND"
    PACK_NAME_TAKEN = "PACK_NAME_TAKEN"
    PACK_VERSION_NOT_FOUND = "PACK_VERSION_NOT_FOUND"
    PACK_VERSION_IMMUTABLE = "PACK_VERSION_IMMUTABLE"
    APPROVAL_SOURCE_INVALID = "APPROVAL_SOURCE_INVALID"

    RUN_NOT_FOUND = "RUN_NOT_FOUND"
    FACT_NOT_FOUND = "FACT_NOT_FOUND"

    DOCUMENT_NOT_FOUND = "DOCUMENT_NOT_FOUND"
    DOCUMENT_PARSE_FAILED = "DOCUMENT_PARSE_FAILED"
    EMPTY_FILE = "EMPTY_FILE"

    STUDIO_SESSION_NOT_FOUND = "STUDIO_SESSION_NOT_FOUND"
    STUDIO_DRAFT_NOT_FOUND = "STUDIO_DRAFT_NOT_FOUND"

    # Governance / release lifecycle.
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    REVIEW_NOT_FOUND = "REVIEW_NOT_FOUND"
    REVIEW_NOT_PENDING = "REVIEW_NOT_PENDING"
    REVIEW_ALREADY_PENDING = "REVIEW_ALREADY_PENDING"
    INVALID_ENVIRONMENT = "INVALID_ENVIRONMENT"
    RELEASE_NOT_FOUND = "RELEASE_NOT_FOUND"
    PACK_REVIEW_INVALID = "PACK_REVIEW_INVALID"
    INVALID_PROMOTION = "INVALID_PROMOTION"


class ApiError(HTTPException):
    """A domain failure with a client-facing code. Raise this, never HTTPException.

    It subclasses HTTPException so that an app which has not (yet) called
    `install_error_handlers` still answers with the right status instead of a 500.
    """

    def __init__(
        self,
        code: Code,
        message: str,
        status: int = 400,
        details: dict[str, object] | None = None,
    ) -> None:
        super().__init__(status_code=status, detail=message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}


def _envelope(
    status: int,
    code: str,
    message: str,
    details: dict[str, object],
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": jsonable_encoder(details)}},
        headers=headers,
    )


async def _api_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, ApiError)  # noqa: S101 # registered for ApiError only
    return _envelope(exc.status, exc.code, exc.message, exc.details)


async def _http_error(request: Request, exc: Exception) -> Response:
    """Anything still raising HTTPException (Starlette's own 404/405/…) keeps the envelope."""
    assert isinstance(exc, HTTPException)  # noqa: S101 # registered for HTTPException only
    return _envelope(exc.status_code, f"HTTP_{exc.status_code}", str(exc.detail), {}, exc.headers)


async def _validation_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, RequestValidationError)  # noqa: S101 # registered for it only
    return _envelope(
        422,
        Code.VALIDATION_ERROR,
        "The request body or parameters are invalid.",
        {"fields": exc.errors()},
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error)
    app.add_exception_handler(HTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
