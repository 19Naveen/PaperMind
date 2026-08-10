"""Thin persistence helpers for the pack governance/release lifecycle
(pack_reviews, pack_releases, pack_audit_events). Each helper commits its work and
returns the ORM object; the state machine that decides what/when lives in
app/services/releases.py.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PackAuditEvent, PackRelease, PackReview, PackVersion


def create_review(
    db: Session,
    *,
    pack_id: uuid.UUID,
    revision_id: uuid.UUID,
    submitted_by: uuid.UUID,
    validation_digest: str | None,
) -> PackReview:
    review = PackReview(
        pack_id=pack_id,
        revision_id=revision_id,
        submitted_by=submitted_by,
        state="pending",
        validation_digest=validation_digest,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return review


def get_review(db: Session, review_id: uuid.UUID) -> PackReview | None:
    return db.get(PackReview, review_id)


def get_pack_review_by_revision(
    db: Session, pack_id: uuid.UUID, revision_id: uuid.UUID
) -> PackReview | None:
    """The most recent review of one revision of a pack, if any."""
    return db.scalar(
        select(PackReview)
        .where(PackReview.pack_id == pack_id, PackReview.revision_id == revision_id)
        .order_by(PackReview.created_at.desc(), PackReview.id.desc())
        .limit(1)
    )


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
    db.commit()
    db.refresh(release)
    return release


def active_release(
    db: Session, pack_id: uuid.UUID, environment: str
) -> PackRelease | None:
    """The latest release of a pack into an environment."""
    return db.scalar(
        select(PackRelease)
        .where(PackRelease.pack_id == pack_id, PackRelease.environment == environment)
        .order_by(PackRelease.created_at.desc(), PackRelease.id.desc())
        .limit(1)
    )


def list_releases(db: Session, pack_id: uuid.UUID, limit: int = 100) -> list[PackRelease]:
    return list(
        db.scalars(
            select(PackRelease)
            .where(PackRelease.pack_id == pack_id)
            .order_by(PackRelease.created_at.desc(), PackRelease.id.desc())
            .limit(limit)
        ).all()
    )


def list_audit_events(
    db: Session, pack_id: uuid.UUID, limit: int = 100
) -> list[PackAuditEvent]:
    return list(
        db.scalars(
            select(PackAuditEvent)
            .where(PackAuditEvent.pack_id == pack_id)
            .order_by(PackAuditEvent.created_at.desc(), PackAuditEvent.id.desc())
            .limit(limit)
        ).all()
    )


def create_audit(
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
    db.commit()
    db.refresh(event)
    return event


def latest_pack_version(db: Session, pack_id: uuid.UUID) -> PackVersion | None:
    return db.scalar(
        select(PackVersion)
        .where(PackVersion.pack_id == pack_id)
        .order_by(PackVersion.version.desc())
        .limit(1)
    )
