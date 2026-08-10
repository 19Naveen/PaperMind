"""Sessions (chat + run), pack install, and self-serve profile routes.

Routers are mounted on a local app like test_workspaces.py: production wiring in
main.py must not be a dependency of these tests. The default providers are the fake,
scripted ones from conftest, so a run executes deterministically with no network.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers.auth import router as auth_router
from app.api.routers.packs import router as packs_router
from app.api.routers.runs import router as runs_router
from app.api.routers.workspaces import router as workspaces_router
from app.core.errors import install_error_handlers


@pytest.fixture
def app_client() -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(workspaces_router)
    app.include_router(packs_router)
    app.include_router(runs_router)
    install_error_handlers(app)
    with TestClient(app) as c:
        yield c


def signup(client: TestClient, email: str = "a@example.com") -> dict[str, object]:
    r = client.post(
        "/auth/signup", json={"email": email, "name": "Example", "password": "hunter2hunter2"}
    )
    assert r.status_code == 201, r.text
    return r.json()


def make_workspace(client: TestClient, name: str = "W") -> dict[str, object]:
    r = client.post("/workspaces", json={"name": name, "goal": "review"})
    assert r.status_code == 201, r.text
    return r.json()


def make_pack_with_version(client: TestClient) -> dict[str, object]:
    pack = client.post("/packs", json={"name": "KYC Pack"}).json()
    spec = {
        "name": "KYC Pack",
        "document_types": ["passport"],
        "fields": [
            {"name": "name", "description": "holder name", "type": "string"},
        ],
        "rules": [{"id": "r1", "description": "name must match"}],
    }
    # Direct spec submission is governance-rejected; freeze a Studio draft instead.
    from app.core.db import SessionLocal
    from tests.util import make_draft_session

    db = SessionLocal()
    try:
        sid = str(make_draft_session(db, spec, title="KYC draft"))
    finally:
        db.close()
    v = client.post(f"/packs/{pack['id']}/versions", json={"draft_session_id": sid})
    assert v.status_code == 201, v.text
    return pack


# --- profile ------------------------------------------------------------------


def test_update_me_changes_name_and_email(app_client: TestClient) -> None:
    signup(app_client)
    r = app_client.patch("/auth/me", json={"name": "Renamed", "email": "b@example.com"})
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed"
    assert r.json()["email"] == "b@example.com"


def test_update_me_rejects_duplicate_email(app_client: TestClient) -> None:
    signup(app_client)
    r = app_client.post(
        "/auth/signup", json={"email": "b@example.com", "name": "B", "password": "hunter2hunter2"}
    )
    assert r.status_code == 201
    # The second signup replaced the session cookie; act as the first user again.
    app_client.post("/auth/login", json={"email": "a@example.com", "password": "hunter2hunter2"})
    taken = app_client.patch("/auth/me", json={"email": "b@example.com"})
    assert taken.status_code == 409
    assert taken.json()["error"]["code"] == "EMAIL_TAKEN"


def test_password_change_roundtrip(app_client: TestClient) -> None:
    signup(app_client)
    wrong = app_client.patch(
        "/auth/me/password", json={"current_password": "nope", "new_password": "newpass1234"}
    )
    assert wrong.status_code == 400
    assert wrong.json()["error"]["code"] == "WRONG_PASSWORD"
    ok = app_client.patch(
        "/auth/me/password",
        json={"current_password": "hunter2hunter2", "new_password": "newpass1234"},
    )
    assert ok.status_code == 204
    app_client.post("/auth/logout")
    assert (
        app_client.post(
            "/auth/login", json={"email": "a@example.com", "password": "newpass1234"}
        ).status_code
        == 200
    )
    assert (
        app_client.post(
            "/auth/login", json={"email": "a@example.com", "password": "hunter2hunter2"}
        ).status_code
        == 401
    )


# --- pack install -------------------------------------------------------------


def test_install_pack_claims_workspace(app_client: TestClient) -> None:
    signup(app_client)
    ws = make_workspace(app_client)
    pack = make_pack_with_version(app_client)
    r = app_client.post(f"/workspaces/{ws['id']}/pack", json={"pack_id": pack["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["pack_id"] == pack["id"]
    assert r.json()["pack_name"] == "KYC Pack"


def test_install_pack_twice_is_conflict(app_client: TestClient) -> None:
    signup(app_client)
    ws = make_workspace(app_client)
    pack = make_pack_with_version(app_client)
    first = app_client.post(f"/workspaces/{ws['id']}/pack", json={"pack_id": pack["id"]})
    assert first.status_code == 200
    second = app_client.post(f"/workspaces/{ws['id']}/pack", json={"pack_id": pack["id"]})
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "WORKSPACE_PACK_TAKEN"


# --- session chat -------------------------------------------------------------


def test_session_chat_streams_and_persists_messages(app_client: TestClient) -> None:
    signup(app_client)
    ws = make_workspace(app_client)
    sess = app_client.post(
        f"/workspaces/{ws['id']}/sessions", json={"title": "S", "subject": "Acme"}
    ).json()
    with app_client.stream(
        "POST",
        f"/workspaces/{ws['id']}/sessions/{sess['id']}/messages",
        json={"text": "hello"},
    ) as r:
        assert r.status_code == 200
        lines = [line for line in r.iter_lines() if line]
    assert any('"type": "token"' in line for line in lines)
    assert any('"type": "done"' in line for line in lines)
    updated = app_client.get(f"/workspaces/{ws['id']}/sessions/{sess['id']}").json()
    assert [m["role"] for m in updated["messages"]] == ["user", "assistant"]


# --- session runs -------------------------------------------------------------


def test_run_session_requires_installed_pack(app_client: TestClient) -> None:
    signup(app_client)
    ws = make_workspace(app_client)
    sess = app_client.post(f"/workspaces/{ws['id']}/sessions", json={"title": "S"}).json()
    r = app_client.post(
        f"/workspaces/{ws['id']}/sessions/{sess['id']}/run", json={"document_ids": []}
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "PACK_NOT_INSTALLED"


def test_run_session_requires_frozen_version(app_client: TestClient) -> None:
    signup(app_client)
    ws = make_workspace(app_client)
    pack = app_client.post("/packs", json={"name": "No versions yet"}).json()
    assert (
        app_client.post(f"/workspaces/{ws['id']}/pack", json={"pack_id": pack["id"]}).status_code
        == 200
    )
    sess = app_client.post(f"/workspaces/{ws['id']}/sessions", json={"title": "S"}).json()
    r = app_client.post(
        f"/workspaces/{ws['id']}/sessions/{sess['id']}/run", json={"document_ids": []}
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "PACK_NO_VERSION"


def test_run_session_links_run_and_updates_status(app_client: TestClient) -> None:
    signup(app_client)
    ws = make_workspace(app_client)
    pack = make_pack_with_version(app_client)
    app_client.post(f"/workspaces/{ws['id']}/pack", json={"pack_id": pack["id"]})
    sess = app_client.post(
        f"/workspaces/{ws['id']}/sessions", json={"title": "S", "subject": "Acme"}
    ).json()
    r = app_client.post(
        f"/workspaces/{ws['id']}/sessions/{sess['id']}/run", json={"document_ids": []}
    )
    assert r.status_code == 201, r.text
    run = r.json()
    assert run["pack_name"] == "KYC Pack"
    assert run["status"] in ("pending", "running", "complete", "failed")
    updated = app_client.get(f"/workspaces/{ws['id']}/sessions/{sess['id']}").json()
    assert updated["run_id"] == run["id"]
    assert updated["status"] in ("pending", "running", "complete", "failed")
