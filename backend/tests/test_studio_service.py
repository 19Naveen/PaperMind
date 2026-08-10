"""Studio authoring engine tests: blank-session drafting, revision advance, invalid-proposal
preservation, and legacy pack seeding — deterministic against the fake LLM and test DB."""

from __future__ import annotations

from app.models import Pack, PackVersion
from app.repositories import studio as repos
from app.services import studio
from app.services.workflow_contract import (
    Node,
    NodeKind,
    WorkflowSpecV1,
    validate,
)


def test_blank_turn_creates_first_revision(db, providers):
    session = repos.create_session(db, title="Invoice Pack")
    result = studio.process_turn(db, session, "Make an invoice pack")

    assert result["ok"] is True
    revision = result["revision"]
    assert revision.revision_no == 1
    assert result["validation"].ok is True
    db.refresh(session)
    assert session.current_revision_id == revision.id

    turns = repos.list_turns(db, session.id)
    assert turns[-1].role == "assistant"
    assert turns[-1].status == "ok"
    assert turns[-1].revision_id == revision.id


def test_second_turn_increments_revision(db, providers):
    session = repos.create_session(db, title="Invoice Pack")
    first = studio.process_turn(db, session, "Make an invoice pack")["revision"]
    second = studio.process_turn(db, session, "Add vendor verification")["revision"]

    assert second.revision_no == 2
    assert second.parent_id == first.id
    assert repos.current_revision(db, session.id).id == second.id


def test_invalid_proposal_preserves_prior(db):
    session = repos.create_session(db, title="Broken Pack")
    invalid = WorkflowSpecV1(
        name="broken",
        nodes=[
            Node(
                id="classify",
                kind=NodeKind.classify_documents,
                config={"document_types": "not-a-list"},
            )
        ],
    )
    result = studio.commit_proposal(db, session, invalid)

    assert result["ok"] is False
    assert result["error"] == "invalid"
    assert repos.current_revision(db, session.id) is None
    db.refresh(session)
    assert session.current_revision_id is None
    turns = repos.list_turns(db, session.id)
    assert turns[-1].status == "failed"


def test_seed_from_pack_version(db):
    pack = Pack(name="ap-invoice")
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
                {"name": "vendor", "description": "Payee name", "type": "string"},
            ],
            "rules": [{"id": "po_match", "description": "A PO must match the invoice"}],
        },
    )
    db.add(pv)
    db.commit()

    session = studio.seed_from_pack_version(
        db, pack_id=pack.id, base_pack_version_id=pv.id, title="Edit AP Invoice"
    )
    assert session.pack_id == pack.id
    assert session.base_pack_version_id == pv.id

    revision = repos.current_revision(db, session.id)
    assert revision is not None
    assert revision.revision_no == 1
    workflow = WorkflowSpecV1.model_validate(revision.workflow)
    assert validate(workflow).ok is True
    assert workflow.document_types == ["Invoice", "PO"]
