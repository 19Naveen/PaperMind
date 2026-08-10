"""Packs: the contract comes first. Versions are append-only (a DB trigger, not Python),
and a `verified` fact with no citation is impossible (a DB trigger, not a habit)."""

from __future__ import annotations

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import ProgrammingError

from app.models import Fact, PackVersion
from tests.util import make_draft_session, make_spec

SPEC = make_spec(
    "Vendor Due Diligence",
    document_types=["Vendor Contract", "DPA"],
    fields=[
        {"name": "cap", "description": "Liability cap", "type": "currency"},
        {"name": "jurisdiction", "description": "Governing law", "type": "string"},
    ],
    rules=[{"id": "r1", "description": "A signed DPA must be present"}],
)


def _signup(client, email: str = "a@example.com") -> None:
    r = client.post(
        "/auth/signup", json={"email": email, "name": "Example", "password": "hunter2hunter2"}
    )
    assert r.status_code == 201, r.text


def test_create_pack_and_version(client, db):
    """The approval gate needs a signed-in author and a Studio draft; direct spec
    submission is governance-rejected, so versions are frozen via draft_session_id."""
    _signup(client)
    resp = client.post("/packs", json={"name": "Vendor Due Diligence"})
    assert resp.status_code == 201
    pack_id = resp.json()["id"]

    sid = str(make_draft_session(db, SPEC.model_dump(), title="VDD draft"))
    resp = client.post(f"/packs/{pack_id}/versions", json={"draft_session_id": sid})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["version"] == 1
    assert body["spec"]["document_types"] == ["Vendor Contract", "DPA"]

    detail = client.get(f"/packs/{pack_id}").json()
    assert detail["pack"]["latest_version"] == 1
    assert detail["versions"][0]["version"] == 1


def test_next_version_is_incremental(client, db):
    _signup(client)
    resp = client.post("/packs", json={"name": "P"})
    pack_id = resp.json()["id"]
    for i in range(2):
        sid = str(make_draft_session(db, SPEC.model_dump(), title=f"Draft {i}"))
        assert (
            client.post(f"/packs/{pack_id}/versions", json={"draft_session_id": sid}).status_code
            == 201
        )
    assert client.get(f"/packs/{pack_id}").json()["pack"]["latest_version"] == 2


def test_duplicate_pack_name_rejected(client):
    client.post("/packs", json={"name": "Dupe"})
    assert client.post("/packs", json={"name": "Dupe"}).status_code == 409


def test_version_is_immutable_db_trigger_rejects_mutation(client, db):
    """memory of the immutable-version guarantee lives in the DB, so app bugs can't
    silently rewrite a saved version."""
    _signup(client)
    pack_id = client.post("/packs", json={"name": "Immutable"}).json()["id"]
    sid = str(make_draft_session(db, SPEC.model_dump(), title="Immutable draft"))
    assert (
        client.post(f"/packs/{pack_id}/versions", json={"draft_session_id": sid}).status_code
        == 201
    )

    row = db.scalar(select(PackVersion).limit(1))
    with pytest.raises(ProgrammingError):
        db.execute(
            update(PackVersion).where(PackVersion.id == row.id).values(spec={"hacked": True})
        )


def test_verified_fact_without_citation_is_impossible(db):
    """'No citation, no result' — the DB rejects a verified fact with no citation row."""
    from app.models import Case, Pack, PackVersion, Run

    pack = Pack(name="P")
    db.add(pack)
    db.flush()
    pv = PackVersion(pack_id=pack.id, version=1, spec=SPEC.model_dump())
    db.add(pv)
    db.flush()
    run = Run(pack_version_id=pv.id, model_id="test", status="complete")
    db.add(run)
    db.flush()
    case = Case(run_id=run.id, subject="subject")
    db.add(case)
    db.flush()

    db.add(Fact(run_id=run.id, case_id=case.id, field="cap", value="$1M", state="verified"))
    with pytest.raises(ProgrammingError):
        db.commit()
