"""Wave4 governance/release lifecycle state machine.

Review submission → decision (approval freezes a version) → forward-only promotion
(development → staging → production) → forward-only restore → workspace install.
Who may do what, in what order, is decided here; persistence is thin
(app/repositories/governance.py) and the append-only invariants live in the DB
triggers from app.models.install_triggers. No FastAPI imports.
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
    Workspace,
)
from app.repositories import governance as repos
from app.services.workflow_contract import WorkflowSpecV1, validate

ENVIRONMENTS = ("development", "staging", "production")


def _require_pack(db: Session, pack_id: uuid.UUID) -> Pack:
    pack = db.get(Pack, pack_id)
    if pack is None:
        raise ApiError(Code.PACK_NOT_FOUND, "Pack not found.", 404)
    return pack


def _lock_pack(db: Session, pack_id: uuid.UUID) -> Pack:
    """Lock the pack row so concurrent approvals cannot race the version counter."""
    pack = db.execute(select(Pack).where(Pack.id == pack_id).with_for_update()).scalar_one_or_none()
    if pack is None:
        raise ApiError(Code.PACK_NOT_FOUND, "Pack not found.", 404)
    return pack


def _next_version(db: Session, pack_id: uuid.UUID) -> int:
    latest = (
        db.scalar(select(func.max(PackVersion.version)).where(PackVersion.pack_id == pack_id)) or 0
    )
    return latest + 1


def _workflow_of_revision(
    db: Session, revision_id: uuid.UUID
) -> tuple[StudioDraftRevision, WorkflowSpecV1]:
    """Load a draft revision and parse + validate its canonical workflow."""
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
                    {"code": e.code, "path": e.path, "message": e.message} for e in result.errors
                ]
            },
        )
    return revision, workflow


def submit_for_review(
    db: Session,
    *,
    pack_id: uuid.UUID,
    revision_id: uuid.UUID,
    actor: uuid.UUID,
) -> PackReview:
    """Open a pending governance review for a draft revision whose workflow validates."""
    _require_pack(db, pack_id)
    revision, _ = _workflow_of_revision(db, revision_id)
    existing = db.scalar(
        select(PackReview)
        .where(PackReview.pack_id == pack_id, PackReview.revision_id == revision_id)
        .order_by(PackReview.created_at.desc(), PackReview.id.desc())
        .limit(1)
    )
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
        submitted_by=actor,
        validation_digest=revision.digest,
    )
    repos.append_audit(
        db,
        pack_id=pack_id,
        event_type="review_submitted",
        actor_id=actor,
        revision_id=revision_id,
    )
    db.commit()
    db.refresh(review)
    return review


def decide_review(
    db: Session,
    *,
    review_id: uuid.UUID,
    approve: bool,
    actor: uuid.UUID,
) -> tuple[PackReview, PackVersion | None]:
    """Decide a pending review once. Approval freezes the revision's canonical workflow as
    the next immutable PackVersion (contract_version=1); rejection closes the review.
    A terminal review cannot be decided again — guarded here and trigger-enforced in the DB.
    """
    review = db.execute(
        select(PackReview).where(PackReview.id == review_id).with_for_update()
    ).scalar_one_or_none()
    if review is None:
        raise ApiError(Code.REVIEW_NOT_FOUND, "Review not found.", 404)
    if review.state != "pending":
        raise ApiError(Code.REVIEW_NOT_PENDING, "Only a pending review can be decided.", 409)
    if review.revision_id is None:
        raise ApiError(
            Code.PACK_REVIEW_INVALID, "The review does not reference a draft revision.", 422
        )

    version: PackVersion | None = None
    if approve:
        _, workflow = _workflow_of_revision(db, review.revision_id)
        _lock_pack(db, review.pack_id)
        version = PackVersion(
            pack_id=review.pack_id,
            version=_next_version(db, review.pack_id),
            spec=workflow.model_dump(mode="json"),
            contract_version=1,
        )
        db.add(version)
        db.flush()

    review.state = "approved" if approve else "rejected"
    review.approved_by = actor
    review.approved_at = datetime.now()

    repos.append_audit(
        db,
        pack_id=review.pack_id,
        event_type="review_approved" if approve else "review_rejected",
        actor_id=actor,
        revision_id=review.revision_id,
        version_id=version.id if version is not None else None,
    )
    if approve:
        repos.append_audit(
            db,
            pack_id=review.pack_id,
            event_type="version_approved",
            actor_id=actor,
            revision_id=review.revision_id,
            version_id=version.id if version is not None else None,
        )
    db.commit()
    db.refresh(review)
    if version is not None:
        db.refresh(version)
    return review, version


def promote(
    db: Session,
    *,
    pack_id: uuid.UUID,
    pack_version_id: uuid.UUID,
    environment: str,
    actor: uuid.UUID,
    source_release_id: uuid.UUID | None = None,
) -> PackRelease:
    """Promote a pack version into an environment. Forward-only and append-only: the
    promotion is a NEW release row; history is never mutated. A version may be promoted
    multiple times — each promotion appends another release."""
    if environment not in ENVIRONMENTS:
        raise ApiError(
            Code.INVALID_ENVIRONMENT,
            f"environment must be one of {', '.join(ENVIRONMENTS)}",
            422,
        )
    _require_pack(db, pack_id)
    version = db.get(PackVersion, pack_version_id)
    if version is None or version.pack_id != pack_id:
        raise ApiError(Code.PACK_VERSION_NOT_FOUND, "Pack version not found.", 404)

    # Environment ordering: development may be first; staging needs the latest
    # development release of the same version; production needs the latest staging
    # release of the same version.
    source: PackRelease | None = None
    if environment == "staging":
        source = repos.latest_release(
            db, pack_id=pack_id, environment="development", pack_version_id=pack_version_id
        )
        if source is None:
            raise ApiError(
                Code.INVALID_PROMOTION,
                "Staging requires a development release of the same pack version first.",
                409,
            )
    elif environment == "production":
        source = repos.latest_release(
            db, pack_id=pack_id, environment="staging", pack_version_id=pack_version_id
        )
        if source is None:
            raise ApiError(
                Code.INVALID_PROMOTION,
                "Production requires a staging release of the same pack version first.",
                409,
            )

    release = repos.create_release(
        db,
        pack_id=pack_id,
        pack_version_id=pack_version_id,
        environment=environment,
        action="promote",
        source_release_id=source_release_id or (source.id if source is not None else None),
        created_by=actor,
    )
    repos.append_audit(
        db,
        pack_id=pack_id,
        event_type="promoted",
        actor_id=actor,
        version_id=pack_version_id,
        release_id=release.id,
        environment=environment,
    )
    db.commit()
    db.refresh(release)
    return release


def restore(db: Session, *, release_id: uuid.UUID, actor: uuid.UUID) -> PackRelease:
    """Forward-only restore: bring a historical release's version back into its
    environment as a NEW release row. The historical row is never mutated."""
    historical = db.get(PackRelease, release_id)
    if historical is None:
        raise ApiError(Code.RELEASE_NOT_FOUND, "Release not found.", 404)
    head = repos.latest_release(db, pack_id=historical.pack_id, environment=historical.environment)
    source_id = head.id if head is not None and head.id != historical.id else None
    new_release = repos.create_release(
        db,
        pack_id=historical.pack_id,
        pack_version_id=historical.pack_version_id,
        environment=historical.environment,
        action="restore",
        source_release_id=source_id,
        restored_from_release_id=historical.id,
        created_by=actor,
    )
    repos.append_audit(
        db,
        pack_id=historical.pack_id,
        event_type="restored",
        actor_id=actor,
        version_id=historical.pack_version_id,
        release_id=new_release.id,
        environment=historical.environment,
    )
    db.commit()
    db.refresh(new_release)
    return new_release


def install_release(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    release_id: uuid.UUID,
    actor: uuid.UUID,
) -> PackRelease:
    """Attach a release's pack to a workspace. The release's environment must match the
    workspace's environment and the workspace must not already hold a pack (existing
    install behavior: one pack per workspace). run.release_id is assigned when a run is
    created under that release in later wiring — there is no workspace↔release column,
    so none is invented here."""
    workspace = db.scalar(
        select(Workspace).where(Workspace.id == workspace_id, Workspace.owner_id == actor)
    )
    if workspace is None:
        raise ApiError(Code.WORKSPACE_NOT_FOUND, "workspace not found", 404)
    release = db.get(PackRelease, release_id)
    if release is None:
        raise ApiError(Code.RELEASE_NOT_FOUND, "Release not found.", 404)
    if workspace.environment != release.environment:
        raise ApiError(
            Code.INVALID_ENVIRONMENT,
            f"The release is in {release.environment}; the workspace is {workspace.environment}.",
            409,
        )
    if workspace.pack_id is not None:
        raise ApiError(
            Code.WORKSPACE_PACK_TAKEN,
            "This workspace already has a Pack. Remove it before installing another.",
            409,
        )
    workspace.pack_id = release.pack_id
    repos.append_audit(
        db,
        pack_id=release.pack_id,
        event_type="installed",
        actor_id=actor,
        release_id=release.id,
        environment=release.environment,
    )
    db.commit()
    db.refresh(release)
    return release


def list_reviews(db: Session, pack_id: uuid.UUID, limit: int = 100) -> list[PackReview]:
    return repos.list_reviews(db, pack_id, limit)


def list_releases(db: Session, pack_id: uuid.UUID, limit: int = 100) -> list[PackRelease]:
    return repos.list_releases(db, pack_id, limit)


def list_audit_events(db: Session, pack_id: uuid.UUID, limit: int = 100) -> list[PackAuditEvent]:
    return repos.list_audit_events(db, pack_id, limit)
