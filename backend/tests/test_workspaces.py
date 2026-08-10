"""Auth + workspace routes. The routers are mounted on a local app: main.py wires them
in production, and these tests must not depend on that wiring having landed yet."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers.auth import router as auth_router
from app.api.routers.workspaces import router as workspaces_router


@pytest.fixture
def app_client() -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(workspaces_router)
    with TestClient(app) as c:
        yield c


def signup(client: TestClient, email: str = "a@example.com") -> dict[str, object]:
    r = client.post(
        "/auth/signup", json={"email": email, "name": "Example", "password": "hunter2hunter2"}
    )
    assert r.status_code == 201, r.text
    body: dict[str, object] = r.json()
    return body


def test_signup_sets_cookie_and_me_returns_user(app_client: TestClient) -> None:
    user = signup(app_client)
    assert "papermind_session" in app_client.cookies
    # The token is opaque and httpOnly: it must not be the raw id, and must carry a signature.
    raw = app_client.cookies["papermind_session"]
    assert raw != user["id"]
    assert raw.startswith(f"{user['id']}.")

    me = app_client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "a@example.com"
    assert "password" not in me.text and "scrypt" not in me.text


def test_signup_rejects_duplicate_email(app_client: TestClient) -> None:
    signup(app_client)
    r = app_client.post(
        "/auth/signup", json={"email": "a@example.com", "name": "B", "password": "hunter2hunter2"}
    )
    assert r.status_code == 409


def test_wrong_password_and_unknown_email_are_indistinguishable(app_client: TestClient) -> None:
    signup(app_client)
    app_client.post("/auth/logout")

    wrong_password = app_client.post(
        "/auth/login", json={"email": "a@example.com", "password": "not-the-password"}
    )
    unknown_email = app_client.post(
        "/auth/login", json={"email": "nobody@example.com", "password": "not-the-password"}
    )
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()
    assert "papermind_session" not in app_client.cookies


def test_login_then_logout_clears_session(app_client: TestClient) -> None:
    signup(app_client)
    assert app_client.post("/auth/logout").status_code == 200
    assert app_client.get("/auth/me").status_code == 401

    creds = {"email": "a@example.com", "password": "hunter2hunter2"}
    assert app_client.post("/auth/login", json=creds).status_code == 200
    assert app_client.get("/auth/me").status_code == 200


def test_forged_cookie_is_rejected(app_client: TestClient) -> None:
    user = signup(app_client)
    app_client.cookies.set("papermind_session", f"{user['id']}.deadbeef")
    assert app_client.get("/auth/me").status_code == 401


def test_password_hashing_roundtrip_and_malformed_input() -> None:
    from app.core.security import hash_password, verify_password

    stored = hash_password("hunter2hunter2")
    assert stored.startswith("scrypt$") and "hunter2hunter2" not in stored
    assert hash_password("hunter2hunter2") != stored  # salted: no two hashes match
    assert verify_password("hunter2hunter2", stored)
    assert not verify_password("hunter2hunter3", stored)
    # A malformed or foreign hash must fail closed, never raise.
    for junk in ("", "not-a-hash", "bcrypt$1$2$3$4$5", "scrypt$a$b$c$zz$zz", "scrypt$1$2$3$4"):
        assert not verify_password("hunter2hunter2", junk)


def test_cookie_with_a_non_uuid_body_is_rejected(app_client: TestClient) -> None:
    from app.core.security import sign_session

    app_client.cookies.set("papermind_session", f"not-a-uuid.{sign_session('not-a-uuid')}")
    assert app_client.get("/auth/me").status_code == 401


def test_workspaces_require_authentication(app_client: TestClient) -> None:
    assert app_client.get("/workspaces").status_code == 401
    assert app_client.post("/workspaces", json={"name": "x"}).status_code == 401


def test_user_cannot_touch_another_users_workspace(app_client: TestClient) -> None:
    """The tenancy boundary. Someone else's workspace must be indistinguishable from one
    that does not exist — 404, never 403."""
    signup(app_client, "b@example.com")
    owned = app_client.post("/workspaces", json={"name": "B's work", "goal": "private"}).json()
    app_client.post("/auth/logout")

    signup(app_client, "a@example.com")
    theirs = f"/workspaces/{owned['id']}"
    assert app_client.get(theirs).status_code == 404
    assert app_client.patch(theirs, json={"name": "stolen"}).status_code == 404
    assert app_client.delete(theirs).status_code == 404
    assert app_client.post(f"{theirs}/sessions", json={"title": "intruder"}).status_code == 404
    assert app_client.get("/workspaces").json() == []

    # ...and it is still there, untouched, for its owner.
    app_client.post("/auth/logout")
    app_client.post("/auth/login", json={"email": "b@example.com", "password": "hunter2hunter2"})
    still_there = app_client.get(f"/workspaces/{owned['id']}")
    assert still_there.status_code == 200
    assert still_there.json()["name"] == "B's work"


def test_workspace_lifecycle(app_client: TestClient) -> None:
    signup(app_client)
    created = app_client.post("/workspaces", json={"name": "Vendor review", "goal": "audit"})
    assert created.status_code == 201
    ws_id = created.json()["id"]
    assert created.json()["pack_id"] is None
    assert created.json()["session_count"] == 0

    listed = app_client.get("/workspaces", params={"limit": 10, "offset": 0})
    assert [w["id"] for w in listed.json()] == [ws_id]

    detail = app_client.get(f"/workspaces/{ws_id}").json()
    assert detail["sessions"] == [] and detail["assets"] == []

    patched = app_client.patch(f"/workspaces/{ws_id}", json={"name": "Renamed"})
    assert patched.status_code == 200
    assert patched.json()["name"] == "Renamed"
    assert patched.json()["goal"] == "audit"  # unset field is not clobbered

    assert app_client.delete(f"/workspaces/{ws_id}").status_code == 204
    assert app_client.get(f"/workspaces/{ws_id}").status_code == 404
    assert app_client.get("/workspaces").json() == []


def test_list_rejects_an_unbounded_limit(app_client: TestClient) -> None:
    signup(app_client)
    assert app_client.get("/workspaces", params={"limit": 5000}).status_code == 422


def test_session_lifecycle_and_appears_in_detail(app_client: TestClient) -> None:
    signup(app_client)
    ws_id = app_client.post("/workspaces", json={"name": "Leases"}).json()["id"]

    created = app_client.post(
        f"/workspaces/{ws_id}/sessions", json={"title": "First look", "subject": "Acme"}
    )
    assert created.status_code == 201
    session = created.json()
    assert session["status"] == "draft" and session["run_id"] is None

    patched = app_client.patch(
        f"/workspaces/{ws_id}/sessions/{session['id']}",
        json={"title": "Second look", "status": "pending"},
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "Second look"
    assert patched.json()["status"] == "pending"
    assert patched.json()["subject"] == "Acme"

    fetched = app_client.get(f"/workspaces/{ws_id}/sessions/{session['id']}")
    assert fetched.json()["title"] == "Second look"

    detail = app_client.get(f"/workspaces/{ws_id}").json()
    assert [x["id"] for x in detail["sessions"]] == [session["id"]]
    assert detail["session_count"] == 1

    bad = app_client.patch(
        f"/workspaces/{ws_id}/sessions/{session['id']}", json={"status": "not-a-status"}
    )
    assert bad.status_code == 422

    assert app_client.delete(f"/workspaces/{ws_id}/sessions/{session['id']}").status_code == 204
    assert app_client.get(f"/workspaces/{ws_id}/sessions/{session['id']}").status_code == 404
    assert app_client.get(f"/workspaces/{ws_id}").json()["sessions"] == []


def test_workspace_out_carries_pack_name_and_latest_version(app_client: TestClient) -> None:
    from app.core.db import SessionLocal
    from app.models import Pack, PackAsset, PackVersion, Workspace

    user = signup(app_client)
    db = SessionLocal()
    try:
        pack = Pack(name="Vendor Due Diligence")
        db.add(pack)
        db.flush()
        for version in (1, 2):
            db.add(PackVersion(pack_id=pack.id, version=version, spec={"name": "vdd"}))
        db.flush()
        latest = db.query(PackVersion).filter_by(pack_id=pack.id, version=2).one()
        db.add(PackAsset(pack_version_id=latest.id, name="template.md", blob_path="b", meta=None))
        db.add(Workspace(owner_id=user["id"], name="With pack", pack_id=pack.id))
        db.commit()
    finally:
        db.close()

    listed = app_client.get("/workspaces").json()
    assert listed[0]["pack_name"] == "Vendor Due Diligence"
    assert listed[0]["pack_version"] == 2

    detail = app_client.get(f"/workspaces/{listed[0]['id']}").json()
    assert [a["name"] for a in detail["assets"]] == ["template.md"]
