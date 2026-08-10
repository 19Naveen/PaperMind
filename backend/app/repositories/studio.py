"""Thin persistence helpers for the authoring studio. Session-in, no FastAPI imports.

Each helper commits its work and returns the ORM object. Higher-level authoring logic
(drafting, validation, diffing) lives in app/services/studio.py.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    StudioDraftRevision,
    StudioSession,
    StudioTestRun,
    StudioTurn,
)


def create_session(
    db: Session,
    *,
    title: str,
    workspace_id: uuid.UUID | None = None,
    created_by_id: uuid.UUID | None = None,
    pack_id: uuid.UUID | None = None,
    base_pack_version_id: uuid.UUID | None = None,
) -> StudioSession:
    session = StudioSession(
        title=title,
        workspace_id=workspace_id,
        created_by_id=created_by_id,
        pack_id=pack_id,
        base_pack_version_id=base_pack_version_id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session(db: Session, session_id: uuid.UUID) -> StudioSession | None:
    return db.get(StudioSession, session_id)


def list_turns(db: Session, session_id: uuid.UUID, limit: int = 50) -> list[StudioTurn]:
    """The last `limit` turns in chronological order (oldest of the window first)."""
    stmt = (
        select(StudioTurn)
        .where(StudioTurn.session_id == session_id)
        .order_by(StudioTurn.created_at.desc(), StudioTurn.id.desc())
        .limit(limit)
    )
    rows = db.scalars(stmt).all()
    return list(reversed(rows))


def current_revision(db: Session, session_id: uuid.UUID) -> StudioDraftRevision | None:
    session = db.get(StudioSession, session_id)
    if session is None or session.current_revision_id is None:
        return None
    return db.get(StudioDraftRevision, session.current_revision_id)


def list_revisions(db: Session, session_id: uuid.UUID) -> list[StudioDraftRevision]:
    """All draft revisions newest-first."""
    stmt = (
        select(StudioDraftRevision)
        .where(StudioDraftRevision.session_id == session_id)
        .order_by(StudioDraftRevision.revision_no.desc())
    )
    return list(db.scalars(stmt).all())


def get_revision(
    db: Session, session_id: uuid.UUID, revision_no: int
) -> StudioDraftRevision | None:
    return db.scalar(
        select(StudioDraftRevision).where(
            StudioDraftRevision.session_id == session_id,
            StudioDraftRevision.revision_no == revision_no,
        )
    )


def create_turn(
    db: Session,
    *,
    session_id: uuid.UUID,
    role: str,
    content: str,
    model_id: str | None = None,
    status: str = "ok",
    revision_id: uuid.UUID | None = None,
) -> StudioTurn:
    turn = StudioTurn(
        session_id=session_id,
        role=role,
        content=content,
        model_id=model_id,
        status=status,
        revision_id=revision_id,
    )
    db.add(turn)
    db.commit()
    db.refresh(turn)
    return turn


def create_revision(
    db: Session,
    *,
    session_id: uuid.UUID,
    workflow: dict[str, object],
    revision_no: int,
    parent_id: uuid.UUID | None,
    diff: list[dict[str, object]],
    validation: dict[str, object],
    digest: str,
    model_id: str | None = None,
    created_by_id: uuid.UUID | None = None,
) -> StudioDraftRevision:
    """Insert a draft revision and point the session's current_revision_id at it."""
    revision = StudioDraftRevision(
        session_id=session_id,
        revision_no=revision_no,
        parent_id=parent_id,
        workflow=workflow,
        diff=diff,
        validation=validation,
        digest=digest,
        model_id=model_id,
        created_by_id=created_by_id,
    )
    db.add(revision)
    db.flush()  # populate revision.id (Python-side uuid default)
    session = db.get(StudioSession, session_id)
    if session is not None:
        session.current_revision_id = revision.id
    db.commit()
    db.refresh(revision)
    return revision


def record_test_run(
    db: Session,
    *,
    revision_id: uuid.UUID,
    document_ids: list[str],
    summary: dict[str, object],
    digest: str,
    created_by_id: uuid.UUID | None = None,
) -> StudioTestRun:
    test_run = StudioTestRun(
        revision_id=revision_id,
        document_ids=document_ids,
        summary=summary,
        digest=digest,
        created_by_id=created_by_id,
    )
    db.add(test_run)
    db.commit()
    db.refresh(test_run)
    return test_run
