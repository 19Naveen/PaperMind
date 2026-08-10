"""The pack governance state machine: review submission → approval → version + release,
environment promotion (development → staging → production), and forward-only restore.
Persistence is thin (app/repositories/releases.py); decisions and validation live here.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, Code
from app.models import (
    Pack,
    PackAuditEvent,
    PackRelease,
    PackReview,
    PackVersion,
    StudioDraftRevision,
)
from app.repositories import releases as repos
from app.services.workflow_contract import WorkflowSpecV1, validate

ENVIRONMENTS = ("development", "staging", "production")

# Only forward promotions are allowed: a release advances one environment at a time.
_PROMOTIONS: frozenset[tuple[str, str]] = frozenset(
    {("development", "staging"), ("staging", "production")}
)


def _require_pack(db: Session, pack_id: uuid.UUID) -> Pack:
    pack = db.get(Pack, pack_id)
    if pack is None:
        raise ApiError(Code.PACK_NOT_FOUND, "Pack not found.", 404)
    return pack


def submit_for_review(
    db: Session,
    *,
    pack_id: uuid.UUID,
    revision_id: uuid.UUID,
    submitted_by: uuid.UUID,
    validation_digest: str | None = None,
) -> PackReview:
    """Open a pending governance review for a draft revision."""
    _require_pack(db, pack_id)
    existing = repos.get_pack_review_by_revision(db, pack_id, revision_id)
    if existing is not None and existing.state == "pending":
        raise ApiError(
            Code.REVIEW_ALREADY_PENDING,
            "A review is already pending for that revision.",
            409,
        )
    review = repos.create_review(
        db,
        pack_id=pack_id,
        revision_id=revision_id,
        submitted_by=submitted_by,
        validation_digest=validation_digest,
    )
    repos.create_audit(
        db,
        pack_id=pack_id,
        event_type="review_submitted",
        actor_id=submitted_by,
        revision_id=revision_id,
    )
    return review


def version_workflow_from_revision(db: Session, revision_id: uuid.UUID) -> WorkflowSpecV1:
    """Load a StudioDraftRevision and parse + validate its canonical workflow."""
    revision = db.get(StudioDraftRevision, revision_id)
    if revision is None:
        raise ApiError(Code.STUDIO_DRAFT_NOT_FOUND, "Draft revision not found.", 404)
    try:
        workflow = WorkflowSpecV1.model_validate(revision.workflow)
    except PydanticValidationError as exc:
        raise ApiError(
            Code.PACK_REVIEW_INVALID,
            "The reviewed revision does not hold a valid workflow.",
            422,
        ) from exc
    result = validate(workflow)
    if not result.ok:
        raise ApiError(
            Code.PACK_REVIEW_INVALID,
            "The reviewed workflow does not validate.",
            422,
            details={
                "errors": [
                    {"code": e.code, "path": e.path, "message": e.message}
                    for e in result.errors
                ]
            },
        )
    return workflow


def _lock_pack(db: Session, pack_id: uuid.UUID) -> Pack:
    pack = db.execute(
        select(Pack).where(Pack.id == pack_id).with_for_update()
    ).scalar_one_or_none()
    if pack is None:
        raise ApiError(Code.PACK_NOT_FOUND, "Pack not found.", 404)
    return pack


def _next_version(
    db: Session, *, pack_id: uuid.UUID, spec: dict[str, object], contract_version: int | None
) -> PackVersion:
    """Create the next immutable version of a pack (caller owns the transaction)."""
    latest = (
        db.scalar(select(func.max(PackVersion.version)).where(PackVersion.pack_id == pack_id))
        or 0
    )
    version = PackVersion(
        pack_id=pack_id,
        version=latest + 1,
        spec=spec,
        contract_version=contract_version,
    )
    db.add(version)
    db.flush()
    return version


def approve_review(
    db: Session, review_id: uuid.UUID, approved_by: uuid.UUID
) -> tuple[PackVersion, PackRelease]:
    """Approve a pending review: freeze the revision's workflow as the next immutable
    version, release it to development, and mark the review approved — one transaction."""
    review = db.execute(
        select(PackReview).where(PackReview.id == review_id).with_for_update()
    ).scalar_one_or_none()
    if review is None:
        raise ApiError(Code.REVIEW_NOT_FOUND, "Review not found.", 404)
    if review.state != "pending":
        raise ApiError(Code.REVIEW_NOT_PENDING, "Only a pending review can be approved.", 409)
    if review.revision_id is None:
        raise ApiError(
            Code.PACK_REVIEW_INVALID, "The review does not reference a draft revision.", 422
        )

    workflow = version_workflow_from_revision(db, review.revision_id)
    _lock_pack(db, review.pack_id)

    version = _next_version(
        db,
        pack_id=review.pack_id,
        spec=workflow.model_dump(mode="json"),
        contract_version=1,
    )
    release = PackRelease(
        pack_id=review.pack_id,
        pack_version_id=version.id,
        environment="development",
        action="approve_to_development",
        created_by=approved_by,
    )
    db.add(release)
    db.flush()

    review.state = "approved"
    review.approved_by = approved_by
    review.approved_at = datetime.now()

    db.add(
        PackAuditEvent(
            pack_id=review.pack_id,
            event_type="version_approved",
            actor_id=approved_by,
            revision_id=review.revision_id,
            version_id=version.id,
        )
    )
    db.add(
        PackAuditEvent(
            pack_id=review.pack_id,
            event_type="release_created",
            actor_id=approved_by,
            version_id=version.id,
            release_id=release.id,
            environment="development",
        )
    )
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise ApiError(Code.PACK_VERSION_IMMUTABLE, "Could not approve the review.", 409) from exc
    db.refresh(version)
    db.refresh(release)
    return version, release


def promote_release(
    db: Session, release_id: uuid.UUID, target_environment: str, actor: uuid.UUID
) -> PackRelease:
    """Promote a release one environment forward. History is never mutated: the promotion
    is a NEW release row (append-only), sourced from the one being promoted."""
    release = db.get(PackRelease, release_id)
    if release is None:
        raise ApiError(Code.RELEASE_NOT_FOUND, "Release not found.", 404)
    if target_environment not in ENVIRONMENTS:
        raise ApiError(
            Code.INVALID_ENVIRONMENT,
            f"environment must be one of {', '.join(ENVIRONMENTS)}",
            422,
        )
    if (release.environment, target_environment) not in _PROMOTIONS:
        raise ApiError(
            Code.INVALID_PROMOTION,
            f"Cannot promote a {release.environment} release to {target_environment}; "
            "promotions move one environment forward (development → staging → production).",
            409,
        )
    new_release = repos.create_release(
        db,
        pack_id=release.pack_id,
        pack_version_id=release.pack_version_id,
        environment=target_environment,
        action="promote",
        source_release_id=release.id,
        created_by=actor,
    )
    repos.create_audit(
        db,
        pack_id=release.pack_id,
        event_type="release_promoted",
        actor_id=actor,
        release_id=new_release.id,
        version_id=release.pack_version_id,
        environment=target_environment,
    )
    return new_release


def restore_release(
    db: Session,
    *,
    pack_id: uuid.UUID,
    environment: str,
    historical_release_id: uuid.UUID,
    actor: uuid.UUID,
) -> PackRelease:
    """Restore a historical release's version into an environment as a NEW release row.
    The historical row is never mutated — restores are forward-only."""
    if environment not in ENVIRONMENTS:
        raise ApiError(
            Code.INVALID_ENVIRONMENT,
            f"environment must be one of {', '.join(ENVIRONMENTS)}",
            422,
        )
    historical = db.get(PackRelease, historical_release_id)
    if historical is None or historical.pack_id != pack_id:
        raise ApiError(Code.RELEASE_NOT_FOUND, "Release not found.", 404)
    new_release = repos.create_release(
        db,
        pack_id=pack_id,
        pack_version_id=historical.pack_version_id,
        environment=environment,
        action="restore",
        restored_from_release_id=historical.id,
        created_by=actor,
    )
    repos.create_audit(
        db,
        pack_id=pack_id,
        event_type="release_restored",
        actor_id=actor,
        release_id=new_release.id,
        version_id=historical.pack_version_id,
        environment=environment,
    )
    return new_release


def active_release_for(
    db: Session, pack_id: uuid.UUID, environment: str
) -> PackRelease | None:
    return repos.active_release(db, pack_id, environment)


def list_releases(db: Session, pack_id: uuid.UUID, limit: int = 100) -> list[PackRelease]:
    return repos.list_releases(db, pack_id, limit)


def list_audit_events(
    db: Session, pack_id: uuid.UUID, limit: int = 100
) -> list[PackAuditEvent]:
    return repos.list_audit_events(db, pack_id, limit)


def record_audit(
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
    return repos.create_audit(
        db,
        pack_id=pack_id,
        event_type=event_type,
        actor_id=actor_id,
        revision_id=revision_id,
        version_id=version_id,
        release_id=release_id,
        environment=environment,
        metadata=metadata,
    )
