"""Studio revision-lifecycle persistence: draft revisions and turns are append-only at the
DB level (BEFORE UPDATE OR DELETE triggers), mirroring the pack_versions immutability test."""

from __future__ import annotations

import pytest
from sqlalchemy import delete, update
from sqlalchemy.exc import ProgrammingError

from app.models import StudioDraftRevision, StudioSession, StudioTurn


def test_studio_draft_revision_and_turn_are_immutable(db):
    session = StudioSession(title="immutable")
    db.add(session)
    db.flush()

    rev = StudioDraftRevision(
        session_id=session.id,
        revision_no=1,
        workflow={"name": "draft", "nodes": []},
        digest="d",
    )
    db.add(rev)
    db.flush()

    # UPDATE on an append-only table must be rejected by the DB trigger. The savepoint
    # keeps the outer transaction alive so the second assertion can run after the first
    # aborts the inner transaction.
    with pytest.raises(ProgrammingError), db.begin_nested():
        db.execute(
            update(StudioDraftRevision)
            .where(StudioDraftRevision.id == rev.id)
            .values(digest="hacked")
        )

    turn = StudioTurn(session_id=session.id, role="user", content="hello")
    db.add(turn)
    db.flush()

    with pytest.raises(ProgrammingError), db.begin_nested():
        db.execute(delete(StudioTurn).where(StudioTurn.id == turn.id))
