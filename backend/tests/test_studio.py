"""Studio API tests: revision-engine wiring through the router.

The routers are mounted on a local app like test_workspaces.py so production wiring in
main.py is not a dependency. Auth is exercised because POST /studio/sessions and
POST .../messages now take CurrentUser; GET stays readable for the current UI.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers.auth import router as auth_router
from app.api.routers.studio import router as studio_router
from app.core.errors import install_error_handlers


@pytest.fixture
def app_client() -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(studio_router)
    install_error_handlers(app)
    with TestClient(app) as c:
        yield c


def signup(client: TestClient, email: str = "a@example.com") -> dict[str, object]:
    r = client.post(
        "/auth/signup", json={"email": email, "name": "Example", "password": "hunter2hunter2"}
    )
    assert r.status_code == 201, r.text
    return r.json()


def make_pack_and_version(db) -> tuple[uuid.UUID, uuid.UUID]:
    """A frozen legacy PackVersion to seed an edit session from."""
    from app.models import Pack, PackVersion

    pack = Pack(name=f"seed-pack-{uuid.uuid4().hex[:8]}")
    db.add(pack)
    db.flush()
    pv = PackVersion(
        pack_id=pack.id,
        version=1,
        spec={
            "name": "AP Invoice Review",
            "document_types": ["Invoice", "PO"],
            "fields": [
                {"name": "amount", "description": "Invoice total", "type": "currency"},
            ],
            "rules": [{"id": "po_match", "description": "A PO must match the invoice"}],
        },
    )
    db.add(pv)
    db.commit()
    return pack.id, pv.id


def stream_events(client: TestClient, session_id: str, text: str) -> list[str]:
    with client.stream(
        "POST", f"/studio/sessions/{session_id}/messages", json={"text": text}
    ) as r:
        assert r.status_code == 200, r.text
        return [line for line in r.iter_lines() if line]


# --- create session ----------------------------------------------------------


def test_create_session_requires_auth(app_client: TestClient) -> None:
    r = app_client.post("/studio/sessions", json={"title": "Invoice Pack"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "NOT_AUTHENTICATED"


def test_create_session_returns_summary(app_client: TestClient) -> None:
    signup(app_client)
    r = app_client.post("/studio/sessions", json={"title": "Invoice Pack"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"]
    assert body["title"] == "Invoice Pack"
    assert body["status"] == "active"
    assert body["current_revision"] is None
    assert body["turns"] == []
    assert body["pack_id"] is None


def test_create_session_seeded_from_pack_version(app_client: TestClient, db) -> None:
    signup(app_client)
    pack_id, pv_id = make_pack_and_version(db)
    r = app_client.post(
        "/studio/sessions",
        json={
            "title": "Edit AP Invoice",
            "pack_id": str(pack_id),
            "base_pack_version_id": str(pv_id),
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["pack_id"] == str(pack_id)
    assert body["base_pack_version_id"] == str(pv_id)
    revision = body["current_revision"]
    assert revision is not None
    assert revision["revision_no"] == 1
    assert revision["workflow"]["name"] == "AP Invoice Review"
    assert revision["workflow"]["document_types"] == ["Invoice", "PO"]


# --- send message (SSE) ------------------------------------------------------


def test_send_message_streams_draft_and_revision(app_client: TestClient, providers) -> None:
    signup(app_client)
    sid = app_client.post("/studio/sessions", json={"title": "Invoice Pack"}).json()["id"]

    lines = stream_events(app_client, sid, "Make an invoice pack")
    assert any('"type": "token"' in line for line in lines)
    assert any('"type": "draft_spec"' in line and '"spec"' in line for line in lines)
    assert any('"type": "revision"' in line and '"revision"' in line for line in lines)

    summary = app_client.get(f"/studio/sessions/{sid}").json()
    assert summary["current_revision"]["revision_no"] == 1
    assert summary["current_revision"]["validation"]["ok"] is True
    assert [t["role"] for t in summary["turns"]] == ["user", "assistant"]


def test_revision_list_and_detail_endpoints(app_client: TestClient, providers) -> None:
    signup(app_client)
    sid = app_client.post("/studio/sessions", json={"title": "Invoice Pack"}).json()["id"]
    stream_events(app_client, sid, "Make an invoice pack")

    revisions = app_client.get(f"/studio/sessions/{sid}/revisions")
    assert revisions.status_code == 200
    assert len(revisions.json()) == 1
    assert revisions.json()[0]["revision_no"] == 1
    assert revisions.json()[0]["workflow"]["name"] == "Invoice Pack"

    detail = app_client.get(f"/studio/sessions/{sid}/revisions/1")
    assert detail.status_code == 200
    assert detail.json()["digest"] == revisions.json()[0]["digest"]

    assert app_client.get(f"/studio/sessions/{sid}/revisions/99").status_code == 404
    missing = "/studio/sessions/00000000-0000-0000-0000-000000000000/revisions"
    assert app_client.get(missing).status_code == 404


def test_invalid_workflow_does_not_overwrite_prior_revision(
    app_client: TestClient, providers, monkeypatch
) -> None:
    signup(app_client)
    sid = app_client.post("/studio/sessions", json={"title": "Invoice Pack"}).json()["id"]

    # A valid first turn lands revision 1.
    stream_events(app_client, sid, "Make an invoice pack")
    summary = app_client.get(f"/studio/sessions/{sid}").json()
    assert summary["current_revision"]["revision_no"] == 1

    from app.services import studio as studio_svc

    def _invalid(*args: object, **kwargs: object) -> dict[str, object]:
        return {
            "ok": False,
            "error": "invalid",
            "validation": None,
            "revision": None,
            "diff": None,
            "digest": None,
        }

    monkeypatch.setattr(studio_svc, "commit_proposal", _invalid)

    lines = stream_events(app_client, sid, "Break the workflow")
    assert any('"type": "error"' in line and '"INVALID_WORKFLOW"' in line for line in lines)

    # The prior revision is untouched.
    summary = app_client.get(f"/studio/sessions/{sid}").json()
    assert summary["current_revision"]["revision_no"] == 1
    assert app_client.get(f"/studio/sessions/{sid}/revisions").json()[0]["revision_no"] == 1
