"""Pack release/governance lifecycle persistence: the release log and audit trail are
append-only at the DB level (BEFORE UPDATE OR DELETE triggers), and a pack review is
immutable once it reaches a terminal state — but a pending review may still be decided."""

from __future__ import annotations

import pytest
from sqlalchemy import delete, update
from sqlalchemy.exc import ProgrammingError

from app.models import Pack, PackAuditEvent, PackRelease, PackReview, PackVersion

SPEC = {"name": "governance", "document_types": [], "fields": [], "rules": []}


def _make_pack_and_version(db):
    pack = Pack(name="governance")
    db.add(pack)
    db.flush()
    pv = PackVersion(pack_id=pack.id, version=1, spec=SPEC)
    db.add(pv)
    db.flush()
    return pack, pv


def test_pack_audit_events_are_fully_append_only(db):
    pack, _ = _make_pack_and_version(db)
    event = PackAuditEvent(pack_id=pack.id, event_type="pack.created")
    db.add(event)
    db.flush()

    # UPDATE on the audit trail must be rejected. The savepoint keeps the outer
    # transaction alive so the DELETE assertion can run after this aborts the inner one.
    with pytest.raises(ProgrammingError), db.begin_nested():
        db.execute(
            update(PackAuditEvent).where(PackAuditEvent.id == event.id).values(event_type="hacked")
        )

    with pytest.raises(ProgrammingError), db.begin_nested():
        db.execute(delete(PackAuditEvent).where(PackAuditEvent.id == event.id))


def test_pack_releases_are_append_only(db):
    pack, pv = _make_pack_and_version(db)
    release = PackRelease(
        pack_id=pack.id, pack_version_id=pv.id, environment="staging", action="promote"
    )
    db.add(release)
    db.flush()

    with pytest.raises(ProgrammingError), db.begin_nested():
        db.execute(delete(PackRelease).where(PackRelease.id == release.id))

    with pytest.raises(ProgrammingError), db.begin_nested():
        db.execute(
            update(PackRelease)
            .where(PackRelease.id == release.id)
            .values(environment="production")
        )


def test_pack_review_pending_can_be_decided_but_terminal_is_immutable(db):
    pack, _ = _make_pack_and_version(db)
    review = PackReview(pack_id=pack.id, state="pending")
    db.add(review)
    db.flush()

    # A pending review may move to a terminal state without raising.
    db.execute(update(PackReview).where(PackReview.id == review.id).values(state="approved"))

    # A decided review is immutable: any further UPDATE is rejected by the trigger.
    with pytest.raises(ProgrammingError), db.begin_nested():
        db.execute(
            update(PackReview)
            .where(PackReview.id == review.id)
            .values(validation_digest="hacked")
        )


def test_pack_review_delete_always_blocked_even_when_pending(db):
    pack, _ = _make_pack_and_version(db)
    review = PackReview(pack_id=pack.id, state="pending")
    db.add(review)
    db.flush()

    with pytest.raises(ProgrammingError), db.begin_nested():
        db.execute(delete(PackReview).where(PackReview.id == review.id))
