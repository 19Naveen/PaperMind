"""Pack governance/release lifecycle: submit → approve → version + release + audit,
promotion order, forward-only restore, and environment-aware run resolution."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.models import PackAuditEvent, PackRelease, PackReview, PackVersion, Run
from app.repositories import studio as studio_repo
from app.services import studio as studio_svc


def signup(client, email: str = "a@example.com") -> dict[str, object]:
    r = client.post(
        "/auth/signup", json={"email": email, "name": "Example", "password": "hunter2hunter2"}
    )
    assert r.status_code == 201, r.text
    return r.json()


def make_pack(client, name: str = "KYC Pack") -> dict[str, object]:
    r = client.post("/packs", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def make_revision(db, title: str = "Invoice Pack"):
    """A valid StudioDraftRevision via the authoring engine (fake LLM heuristic)."""
    session = studio_repo.create_session(db, title=title)
    result = studio_svc.process_turn(db, session, "Make an invoice pack")
    assert result["ok"] is True, result
    return session, result["revision"]


def release_count(db, pack_id) -> int:
    return len(db.scalars(select(PackRelease).where(PackRelease.pack_id == pack_id)).all())


def audit_types(db, pack_id) -> set[str]:
    return {
        e.event_type
        for e in db.scalars(select(PackAuditEvent).where(PackAuditEvent.pack_id == pack_id)).all()
    }


def submit_and_approve(client, db, pack_id):
    """Review the pack's first revision and approve it; returns the approved release."""
    _, revision = make_revision(db)
    review = client.post(
        f"/packs/{pack_id}/reviews", json={"revision_id": str(revision.id)}
    )
    assert review.status_code == 201, review.text
    appr = client.post(f"/packs/{pack_id}/reviews/{review.json()['id']}/approve")
    assert appr.status_code == 200, appr.text
    return appr.json()


def test_submit_and_approve_creates_version_release_audit(client, db):
    user = signup(client)
    pack = make_pack(client)
    _, revision = make_revision(db)

    submitted = client.post(
        f"/packs/{pack['id']}/reviews", json={"revision_id": str(revision.id)}
    )
    assert submitted.status_code == 201, submitted.text
    review_id = submitted.json()["id"]
    assert submitted.json()["state"] == "pending"
    assert submitted.json()["revision_id"] == str(revision.id)

    approved = client.post(f"/packs/{pack['id']}/reviews/{review_id}/approve")
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["version"]["version"] == 1
    assert body["version"]["contract_version"] == 1
    assert body["release"]["environment"] == "development"
    assert body["release"]["action"] == "approve_to_development"
    assert body["release"]["pack_version_id"] == body["version"]["id"]

    review = db.scalar(select(PackReview).where(PackReview.id == review_id))
    assert review.state == "approved"
    assert str(review.approved_by) == user["id"]

    assert db.scalar(select(PackVersion.version).where(PackVersion.pack_id == pack["id"])) == 1
    assert release_count(db, pack["id"]) == 1
    assert {"review_submitted", "version_approved", "release_created"} <= audit_types(
        db, pack["id"]
    )


def test_direct_spec_version_rejected(client):
    signup(client)
    pack = make_pack(client)
    spec = {
        "name": "X",
        "document_types": ["passport"],
        "fields": [],
        "rules": [],
    }
    r = client.post(f"/packs/{pack['id']}/versions", json={"spec": spec})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "REVIEW_REQUIRED"


def test_draft_session_quick_approve_creates_release(client, db):
    signup(client)
    pack = make_pack(client)
    session, _ = make_revision(db)

    r = client.post(f"/packs/{pack['id']}/versions", json={"draft_session_id": str(session.id)})
    assert r.status_code == 201, r.text
    assert r.json()["version"] == 1

    assert release_count(db, pack["id"]) == 1
    release = db.scalar(select(PackRelease).where(PackRelease.pack_id == pack["id"]))
    assert release.environment == "development"
    assert release.action == "approve_to_development"
    version = db.scalar(select(PackVersion).where(PackVersion.pack_id == pack["id"]))
    assert release.pack_version_id == version.id
    assert {"version_approved", "release_created"} <= audit_types(db, pack["id"])

    # The author's quick-approve is itself a governance review: approved by the author.
    review = db.scalar(select(PackReview).where(PackReview.pack_id == pack["id"]))
    assert review.state == "approved"
    assert review.submitted_by == review.approved_by


def test_promotion_order_enforced(client, db):
    signup(client)
    pack = make_pack(client)
    appr = submit_and_approve(client, db, pack["id"])
    dev_id = appr["release"]["id"]

    # development -> production directly is not a promotion.
    jump = client.post(
        f"/packs/{pack['id']}/releases/{dev_id}/promote", json={"environment": "production"}
    )
    assert jump.status_code == 409
    assert jump.json()["error"]["code"] == "INVALID_PROMOTION"

    staging = client.post(
        f"/packs/{pack['id']}/releases/{dev_id}/promote", json={"environment": "staging"}
    )
    assert staging.status_code == 200, staging.text
    assert staging.json()["environment"] == "staging"
    assert staging.json()["action"] == "promote"
    assert staging.json()["source_release_id"] == dev_id

    production = client.post(
        f"/packs/{pack['id']}/releases/{staging.json()['id']}/promote",
        json={"environment": "production"},
    )
    assert production.status_code == 200, production.text
    assert production.json()["environment"] == "production"

    # Three release rows: approve + two promotions; the rejected jump wrote nothing.
    assert release_count(db, pack["id"]) == 3
    assert {"release_promoted"} <= audit_types(db, pack["id"])


def test_restore_is_forward_only(client, db):
    signup(client)
    pack = make_pack(client)
    appr = submit_and_approve(client, db, pack["id"])
    first_release = appr["release"]
    # Move version 1 to staging, then approve a second version + release.
    assert (
        client.post(
            f"/packs/{pack['id']}/releases/{first_release['id']}/promote",
            json={"environment": "staging"},
        ).status_code
        == 200
    )
    appr2 = submit_and_approve(client, db, pack["id"])
    second_release = appr2["release"]
    assert second_release["pack_version_id"] != first_release["pack_version_id"]

    before = release_count(db, pack["id"])
    restored = client.post(
        f"/packs/{pack['id']}/releases/restore",
        json={"environment": "production", "release_id": first_release["id"]},
    )
    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert body["action"] == "restore"
    assert body["environment"] == "production"
    assert body["restored_from_release_id"] == first_release["id"]
    assert body["pack_version_id"] == first_release["pack_version_id"]

    # A NEW restore row appeared; historical rows are untouched (append-only).
    assert release_count(db, pack["id"]) == before + 1
    assert {"release_restored"} <= audit_types(db, pack["id"])


def test_run_resolves_active_release(client, db):
    signup(client)
    pack = make_pack(client)
    appr = submit_and_approve(client, db, pack["id"])
    dev_id = appr["release"]["id"]
    staging = client.post(
        f"/packs/{pack['id']}/releases/{dev_id}/promote", json={"environment": "staging"}
    ).json()
    production = client.post(
        f"/packs/{pack['id']}/releases/{staging['id']}/promote",
        json={"environment": "production"},
    ).json()

    ws = client.post(
        "/workspaces",
        json={"name": "Prod WS", "goal": "review", "environment": "production"},
    )
    assert ws.status_code == 201, ws.text
    ws_id = ws.json()["id"]
    assert (
        client.post(f"/workspaces/{ws_id}/pack", json={"pack_id": pack["id"]}).status_code == 200
    )
    sess = client.post(f"/workspaces/{ws_id}/sessions", json={"title": "S"}).json()

    r = client.post(f"/workspaces/{ws_id}/sessions/{sess['id']}/run", json={"document_ids": []})
    assert r.status_code == 201, r.text
    run = r.json()
    # serialize_run (runs.py) pins pack_version from the run's version; the release_id
    # is recorded on the run row (the governance invariant), which the DB asserts below.
    pinned = db.get(PackVersion, uuid.UUID(production["pack_version_id"]))
    assert run["pack_version"] == pinned.version

    row = db.scalar(select(Run).where(Run.id == run["id"]))
    assert row.release_id == uuid.UUID(production["id"])
    assert row.pack_version_id == uuid.UUID(production["pack_version_id"])


def test_create_workspace_validates_environment(client):
    signup(client)
    bad = client.post("/workspaces", json={"name": "W", "goal": "g", "environment": "prod"})
    assert bad.status_code == 422

    staging = client.post(
        "/workspaces", json={"name": "W", "goal": "g", "environment": "staging"}
    )
    assert staging.status_code == 201, staging.text
    assert staging.json()["environment"] == "staging"

    default = client.post("/workspaces", json={"name": "D"})
    assert default.status_code == 201, default.text
    assert default.json()["environment"] == "production"
