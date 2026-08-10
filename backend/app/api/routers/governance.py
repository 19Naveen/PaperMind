"""Wave4 governance/release lifecycle API, mounted under /governance.

Review submission + decision, forward-only promotion, forward-only restore,
release-based workspace install, and the pack audit trail. The state machine
lives in app/services/governance.py; this router only serializes.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

import app.schemas as s
from app.api.deps import DB, CurrentUser
from app.core.errors import ApiError, Code
from app.models import Pack, PackAuditEvent, PackRelease, PackReview, PackVersion
from app.services import governance as svc

router = APIRouter(prefix="/governance", tags=["governance"])


def _review_out(review: PackReview) -> s.PackReviewOut:
    return s.PackReviewOut(
        id=review.id,
        pack_id=review.pack_id,
        revision_id=review.revision_id,
        submitted_by=review.submitted_by,
        submitted_at=review.submitted_at,
        approved_by=review.approved_by,
        approved_at=review.approved_at,
        state=review.state,
        validation_digest=review.validation_digest,
    )


def _version_out(version: PackVersion) -> s.PackVersionOut:
    return s.PackVersionOut(
        id=version.id,
        version=version.version,
        created_at=version.created_at,
        spec=s.PackSpec.model_validate(version.spec),
        contract_version=version.contract_version,
    )


def _release_out(release: PackRelease) -> s.PackReleaseOut:
    return s.PackReleaseOut(
        id=release.id,
        pack_id=release.pack_id,
        pack_version_id=release.pack_version_id,
        environment=release.environment,
        action=release.action,
        source_release_id=release.source_release_id,
        restored_from_release_id=release.restored_from_release_id,
        created_by=release.created_by,
        created_at=release.created_at,
    )


def _audit_out(event: PackAuditEvent) -> s.PackAuditEventOut:
    return s.PackAuditEventOut(
        id=event.id,
        pack_id=event.pack_id,
        event_type=event.event_type,
        actor_id=event.actor_id,
        revision_id=event.revision_id,
        version_id=event.version_id,
        release_id=event.release_id,
        environment=event.environment,
        metadata=event.event_metadata,
        created_at=event.created_at,
    )


def _get_pack(db: DB, pack_id: uuid.UUID) -> Pack:
    pack = db.get(Pack, pack_id)
    if pack is None:
        raise ApiError(Code.PACK_NOT_FOUND, "Pack not found.", 404)
    return pack


@router.post("/reviews", response_model=s.PackReviewOut, status_code=201)
def submit_review(body: s.GovernanceReviewSubmit, user: CurrentUser, db: DB) -> s.PackReviewOut:
    review = svc.submit_for_review(
        db, pack_id=body.pack_id, revision_id=body.revision_id, actor=user.id
    )
    return _review_out(review)


@router.post("/reviews/{review_id}/decision", response_model=s.GovernanceDecisionOut)
def decide_review(
    review_id: uuid.UUID, body: s.GovernanceReviewDecision, user: CurrentUser, db: DB
) -> s.GovernanceDecisionOut:
    review, version = svc.decide_review(
        db, review_id=review_id, approve=body.approve, actor=user.id
    )
    return s.GovernanceDecisionOut(
        review=_review_out(review),
        version=_version_out(version) if version is not None else None,
    )


@router.get("/packs/{pack_id}/reviews", response_model=list[s.PackReviewOut])
def list_reviews(
    pack_id: uuid.UUID,
    db: DB,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[s.PackReviewOut]:
    _get_pack(db, pack_id)
    return [_review_out(r) for r in svc.list_reviews(db, pack_id, limit)]


@router.post("/packs/{pack_id}/releases", response_model=s.PackReleaseOut, status_code=201)
def promote_release(
    pack_id: uuid.UUID, body: s.GovernanceReleasePromote, user: CurrentUser, db: DB
) -> s.PackReleaseOut:
    release = svc.promote(
        db,
        pack_id=pack_id,
        pack_version_id=body.pack_version_id,
        environment=body.environment,
        actor=user.id,
        source_release_id=body.source_release_id,
    )
    return _release_out(release)


@router.get("/packs/{pack_id}/releases", response_model=list[s.PackReleaseOut])
def list_releases(
    pack_id: uuid.UUID,
    db: DB,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[s.PackReleaseOut]:
    _get_pack(db, pack_id)
    return [_release_out(r) for r in svc.list_releases(db, pack_id, limit)]


@router.post("/releases/{release_id}/restore", response_model=s.PackReleaseOut, status_code=201)
def restore_release(release_id: uuid.UUID, user: CurrentUser, db: DB) -> s.PackReleaseOut:
    release = svc.restore(db, release_id=release_id, actor=user.id)
    return _release_out(release)


@router.post(
    "/workspaces/{workspace_id}/releases/{release_id}/install",
    response_model=s.PackReleaseOut,
)
def install_release(
    workspace_id: uuid.UUID, release_id: uuid.UUID, user: CurrentUser, db: DB
) -> s.PackReleaseOut:
    release = svc.install_release(
        db, workspace_id=workspace_id, release_id=release_id, actor=user.id
    )
    return _release_out(release)


@router.get("/packs/{pack_id}/audit", response_model=list[s.PackAuditEventOut])
def list_audit(
    pack_id: uuid.UUID,
    db: DB,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[s.PackAuditEventOut]:
    """The pack's audit trail, chronological (oldest first)."""
    _get_pack(db, pack_id)
    return [_audit_out(e) for e in svc.list_audit_events(db, pack_id, limit)]
