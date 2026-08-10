"""The error envelope is a contract clients branch on, so it is tested at the route layer:
one shape for domain errors, framework errors, and validation errors alike (CLAUDE.md §3.4)."""

from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers.documents import router as documents_router
from app.api.routers.packs import router as packs_router
from app.core.errors import install_error_handlers


@pytest.fixture
def api():
    """Local app — main.py does not register the handlers yet (another agent owns it)."""
    app = FastAPI()
    install_error_handlers(app)
    app.include_router(packs_router)
    app.include_router(documents_router)
    with TestClient(app) as c:
        yield c


def error_of(resp):
    """Assert the envelope shape and hand back the error object."""
    body = resp.json()
    assert "detail" not in body, "FastAPI's raw {'detail': ...} leaked through"
    assert set(body) == {"error"}
    err = body["error"]
    assert set(err) == {"code", "message", "details"}
    assert isinstance(err["code"], str) and err["code"]
    assert isinstance(err["message"], str) and err["message"]
    assert isinstance(err["details"], dict)
    return err


def test_domain_404_uses_the_envelope(api):
    resp = api.get(f"/packs/{uuid.uuid4()}")
    assert resp.status_code == 404
    assert error_of(resp)["code"] == "PACK_NOT_FOUND"


def test_framework_404_uses_the_envelope(api):
    """Even errors Starlette raises itself keep the shape — clients parse one thing."""
    resp = api.get("/no-such-route")
    assert resp.status_code == 404
    assert error_of(resp)["code"] == "HTTP_404"


def test_validation_error_reports_the_offending_field(api):
    resp = api.post("/packs", json={})
    assert resp.status_code == 422
    err = error_of(resp)
    assert err["code"] == "VALIDATION_ERROR"
    assert any("name" in f["loc"] for f in err["details"]["fields"])


def test_list_packs_respects_limit(api):
    for i in range(3):
        assert api.post("/packs", json={"name": f"pack-{i}"}).status_code == 201

    assert len(api.get("/packs", params={"limit": 2}).json()) == 2
    assert len(api.get("/packs", params={"limit": 2, "offset": 2}).json()) == 1
    assert len(api.get("/packs").json()) == 3


def test_limit_over_max_is_rejected_not_clamped(api):
    resp = api.get("/packs", params={"limit": 500})
    assert resp.status_code == 422
    err = error_of(resp)
    assert err["code"] == "VALIDATION_ERROR"
    assert any("limit" in f["loc"] for f in err["details"]["fields"])


def test_empty_upload_is_rejected(api):
    resp = api.post("/documents", files={"file": ("empty.txt", b"", "text/plain")})
    assert resp.status_code == 422
    assert error_of(resp)["code"] == "EMPTY_FILE"
