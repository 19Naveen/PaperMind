"""Wave4 governance/release lifecycle: submit → decide → frozen version + audits,
forward-only promotion order, forward-only restore, terminal-review immutability,
chronological audit list, and release-based workspace install."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError

from app.models import PackAuditEvent, PackRelease, PackReview, PackVersion, Workspace
from app.repositories import studio as studio_repo
from app.services import studio as studio_svc
from app.services.workflow_contract import Node, NodeKind, WorkflowSpecV1


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


def make_revision(db):
    """A valid StudioDraftRevision via the authoring engine (fake LLM heuristic)."""
    session = studio_repo.create_session(db, title="Invoice Pack")
    result = studio_svc.process_turn(db, session, "Make an invoice pack")
    assert result["ok"] is True, result
    return session, result["revision"]


def _invalid_workflow() -> WorkflowSpecV1:
    """A spec that fails contract validation: classify requires document_types config."""
    return WorkflowSpecV1(
        name="Broken",
        document_types=[],
        nodes=[Node(id="classify", kind=NodeKind.classify_documents, config={})],
        edges=[],
        outputs=[],
        integrations=[],
    )


def submit(client, pack_id: str, revision_id: uuid.UUID) -> dict[str, object]:
    r = client.post(
        "/governance/reviews",
        json={"pack_id": str(pack_id), "revision_id": str(revision_id)},
    )
    assert r.status_code == 201, r.text
    return r.json()


def decide(client, review_id: str, approve: bool = True) -> dict[str, object]:
    r = client.post(f"/governance/reviews/{review_id}/decision", json={"approve": approve})
    assert r.status_code == 200, r.text
    return r.json()


def promote(client, pack_id: str, version_id: str, environment: str) -> dict[str, object]:
    r = client.post(
        f"/governance/packs/{pack_id}/releases",
        json={"pack_version_id": str(version_id), "environment": environment},
    )
    assert r.status_code == 201, r.text
    return r.json()


def release_count(db, pack_id) -> int:
    return len(db.scalars(select(PackRelease).where(PackRelease.pack_id == pack_id)).all())


def audit_types(db, pack_id) -> set[str]:
    return {
        e.event_type
        for e in db.scalars(select(PackAuditEvent).where(PackAuditEvent.pack_id == pack_id)).all()
    }


def test_submit_rejects_invalid_revision(client, db):
    signup(client)
    pack = make_pack(client)

    # A revision that does not exist → 404.
    missing = client.post(
        "/governance/reviews",
        json={"pack_id": pack["id"], "revision_id": str(uuid.uuid4())},
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "STUDIO_DRAFT_NOT_FOUND"

    # A revision whose workflow fails contract validation → 422.
    session = studio_repo.create_session(db, title="Broken")
    revision = studio_repo.create_revision(
        db,
        session_id=session.id,
        workflow=_invalid_workflow().model_dump(mode="json"),
        revision_no=1,
        parent_id=None,
        diff=[],
        validation={"ok": False, "errors": []},
        digest="x" * 64,
    )
    invalid = client.post(
        "/governance/reviews",
        json={"pack_id": pack["id"], "revision_id": str(revision.id)},
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "PACK_REVIEW_INVALID"


def test_submit_and_approve_freeze_version_and_audits(client, db):
    user = signup(client)
    pack = make_pack(client)
    _, revision = make_revision(db)

    submitted = submit(client, str(pack["id"]), revision.id)
    assert submitted["state"] == "pending"
    assert submitted["revision_id"] == str(revision.id)

    decided = decide(client, str(submitted["id"]), approve=True)
    assert decided["review"]["state"] == "approved"
    assert str(decided["review"]["approved_by"]) == user["id"]
    assert decided["version"]["version"] == 1
    assert decided["version"]["contract_version"] == 1

    # The frozen version exists, is immutable (append-only trigger), version 1.
    version = db.scalar(select(PackVersion).where(PackVersion.pack_id == pack["id"]))
    assert version is not None and version.version == 1
    assert version.contract_version == 1
    assert {"review_submitted", "review_approved", "version_approved"} <= audit_types(
        db, pack["id"]
    )


def test_promotion_order_enforced(client, db):
    signup(client)
    pack = make_pack(client)
    _, revision = make_revision(db)
    submitted = submit(client, str(pack["id"]), revision.id)
    version_id = decide(client, str(submitted["id"]))["version"]["id"]

    # Production before any staging release is rejected.
    jump = client.post(
        f"/governance/packs/{pack['id']}/releases",
        json={"pack_version_id": version_id, "environment": "production"},
    )
    assert jump.status_code == 409
    assert jump.json()["error"]["code"] == "INVALID_PROMOTION"

    # An environment outside the vocabulary is rejected by the request schema.
    bad = client.post(
        f"/governance/packs/{pack['id']}/releases",
        json={"pack_version_id": version_id, "environment": "prod"},
    )
    assert bad.status_code == 422

    # Development can be first.
    dev = promote(client, str(pack["id"]), str(version_id), "development")
    assert dev["action"] == "promote"
    assert dev["environment"] == "development"

    # Staging needs the same version's development release.
    staging = promote(client, str(pack["id"]), str(version_id), "staging")
    assert staging["source_release_id"] == dev["id"]

    # Production needs the same version's staging release.
    production = promote(client, str(pack["id"]), str(version_id), "production")
    assert production["source_release_id"] == staging["id"]
    assert release_count(db, pack["id"]) == 3
    assert {"promoted"} <= audit_types(db, pack["id"])


def test_restore_is_forward_only(client, db):
    signup(client)
    pack = make_pack(client)
    _, revision = make_revision(db)
    submitted = submit(client, str(pack["id"]), revision.id)
    version_id = decide(client, str(submitted["id"]))["version"]["id"]
    dev = promote(client, str(pack["id"]), str(version_id), "development")

    before = release_count(db, pack["id"])
    restored = client.post(f"/governance/releases/{dev['id']}/restore")
    assert restored.status_code == 201, restored.text
    body = restored.json()
    assert body["action"] == "restore"
    assert body["environment"] == "development"
    assert body["restored_from_release_id"] == dev["id"]
    assert body["pack_version_id"] == dev["pack_version_id"]

    # A NEW restore row appeared; the historical row is untouched.
    assert release_count(db, pack["id"]) == before + 1
    original = db.get(PackRelease, uuid.UUID(str(dev["id"])))
    assert original.action == "promote"
    assert original.pack_version_id == uuid.UUID(str(dev["pack_version_id"]))
    assert {"restored"} <= audit_types(db, pack["id"])


def test_terminal_review_cannot_be_mutated(client, db):
    signup(client)
    pack = make_pack(client)
    _, revision = make_revision(db)
    submitted = submit(client, str(pack["id"]), revision.id)
    decided = decide(client, str(submitted["id"]), approve=True)
    review_id = uuid.UUID(str(decided["review"]["id"]))

    # The service refuses a second decision.
    again = client.post(f"/governance/reviews/{review_id}/decision", json={"approve": False})
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "REVIEW_NOT_PENDING"

    # The DB trigger refuses a raw UPDATE on a terminal review.
    review = db.get(PackReview, review_id)
    review.state = "rejected"
    with pytest.raises(DBAPIError):
        db.commit()
    db.rollback()


def test_audit_endpoint_is_chronological(client, db):
    signup(client)
    pack = make_pack(client)
    _, revision = make_revision(db)
    submitted = submit(client, str(pack["id"]), revision.id)
    decide(client, str(submitted["id"]), approve=True)

    r = client.get(f"/governance/packs/{pack['id']}/audit")
    assert r.status_code == 200, r.text
    types = [e["event_type"] for e in r.json()]
    # Submission (its own transaction) precedes the decision/version events.
    assert types.index("review_submitted") < types.index("review_approved")
    assert types.index("review_submitted") < types.index("version_approved")


def test_install_release_matches_environment(client, db):
    signup(client)
    pack = make_pack(client)
    _, revision = make_revision(db)
    submitted = submit(client, str(pack["id"]), revision.id)
    version_id = decide(client, str(submitted["id"]))["version"]["id"]
    dev = promote(client, str(pack["id"]), str(version_id), "development")

    prod_ws = client.post(
        "/workspaces", json={"name": "Prod", "goal": "g", "environment": "production"}
    ).json()
    mismatch = client.post(f"/governance/workspaces/{prod_ws['id']}/releases/{dev['id']}/install")
    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "INVALID_ENVIRONMENT"

    dev_ws = client.post(
        "/workspaces", json={"name": "Dev", "goal": "g", "environment": "development"}
    ).json()
    installed = client.post(f"/governance/workspaces/{dev_ws['id']}/releases/{dev['id']}/install")
    assert installed.status_code == 200, installed.text
    assert installed.json()["id"] == dev["id"]

    ws = db.get(Workspace, uuid.UUID(str(dev_ws["id"])))
    assert ws.pack_id == uuid.UUID(str(pack["id"]))
    assert {"installed"} <= audit_types(db, pack["id"])
