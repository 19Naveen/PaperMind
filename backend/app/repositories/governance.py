"""Thin persistence helpers for the Wave4 governance/release lifecycle
(pack_reviews, pack_releases, pack_audit_events).

Helpers add rows to the session WITHOUT committing — the caller (the governance
service) owns the transaction so a decision/promotion/restore commits atomically.
Append-only invariants and the pending→terminal review rule are enforced by the
DB triggers installed from app.models.install_triggers, not here. The audit
table's DB column is `metadata`; the ORM attribute is `event_metadata`, and that
attribute is what every writer must use.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PackAuditEvent, PackRelease, PackReview


def create_review(
    db: Session,
    *,
    pack_id: uuid.UUID,
    revision_id: uuid.UUID,
    submitted_by: uuid.UUID,
    validation_digest: str | None = None,
) -> PackReview:
    review = PackReview(
        pack_id=pack_id,
        revision_id=revision_id,
        submitted_by=submitted_by,
        state="pending",
        validation_digest=validation_digest,
    )
    db.add(review)
    return review


def get_review(db: Session, review_id: uuid.UUID) -> PackReview | None:
    return db.get(PackReview, review_id)


def list_reviews(db: Session, pack_id: uuid.UUID, limit: int = 100) -> list[PackReview]:
    """A pack's reviews, newest first."""
    stmt = (
        select(PackReview)
        .where(PackReview.pack_id == pack_id)
        .order_by(PackReview.created_at.desc(), PackReview.id.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt).all())


def create_release(
    db: Session,
    *,
    pack_id: uuid.UUID,
    pack_version_id: uuid.UUID,
    environment: str,
    action: str,
    source_release_id: uuid.UUID | None = None,
    restored_from_release_id: uuid.UUID | None = None,
    created_by: uuid.UUID | None = None,
) -> PackRelease:
    release = PackRelease(
        pack_id=pack_id,
        pack_version_id=pack_version_id,
        environment=environment,
        action=action,
        source_release_id=source_release_id,
        restored_from_release_id=restored_from_release_id,
        created_by=created_by,
    )
    db.add(release)
    return release


def latest_release(
    db: Session,
    *,
    pack_id: uuid.UUID,
    environment: str,
    pack_version_id: uuid.UUID | None = None,
) -> PackRelease | None:
    """The newest release of a pack into an environment, optionally of one version."""
    stmt = select(PackRelease).where(
        PackRelease.pack_id == pack_id, PackRelease.environment == environment
    )
    if pack_version_id is not None:
        stmt = stmt.where(PackRelease.pack_version_id == pack_version_id)
    return db.scalar(stmt.order_by(PackRelease.created_at.desc(), PackRelease.id.desc()).limit(1))


def list_releases(db: Session, pack_id: uuid.UUID, limit: int = 100) -> list[PackRelease]:
    """A pack's release log, newest first."""
    stmt = (
        select(PackRelease)
        .where(PackRelease.pack_id == pack_id)
        .order_by(PackRelease.created_at.desc(), PackRelease.id.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt).all())


def list_audit_events(db: Session, pack_id: uuid.UUID, limit: int = 100) -> list[PackAuditEvent]:
    """A pack's audit trail in chronological order (oldest first)."""
    stmt = (
        select(PackAuditEvent)
        .where(PackAuditEvent.pack_id == pack_id)
        .order_by(PackAuditEvent.created_at.asc(), PackAuditEvent.id.asc())
        .limit(limit)
    )
    return list(db.scalars(stmt).all())


def append_audit(
    db: Session,
    *,
    pack_id: uuid.UUID,
    event_type: str,
    actor_id: uuid.UUID | None = None,
    revision_id: uuid.UUID | None = None,
    version_id: uuid.UUID | None = None,
    release_id: uuid.UUID | None = None,
    environment: str | None = None,
    metadata: dict[str, object] | None = None,
) -> PackAuditEvent:
    event = PackAuditEvent(
        pack_id=pack_id,
        event_type=event_type,
        actor_id=actor_id,
        revision_id=revision_id,
        version_id=version_id,
        release_id=release_id,
        environment=environment,
        event_metadata=metadata or {},
    )
    db.add(event)
    return event
