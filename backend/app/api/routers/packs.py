"""Pack + PackVersion CRUD and the governance/release lifecycle. The approval gate
(`POST /packs/{id}/versions`) is the only way a draft becomes a frozen version — either
through a reviewed Studio revision (`POST /packs/{id}/reviews/.../approve`) or the
author's own quick-approve of a draft session. Direct spec submission is rejected."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import app.schemas as s
from app.api.deps import DB, CurrentUser
from app.core.errors import ApiError, Code
from app.models import (
    Pack,
    PackAuditEvent,
    PackRelease,
    PackReview,
    PackVersion,
    StudioDraftRevision,
    StudioSession,
    Workspace,
)
from app.services import releases as releases_svc
from app.services.workflow_contract import WorkflowSpecV1, validate

router = APIRouter(prefix="/packs", tags=["packs"])


def _pack_out(
    pack: Pack,
    latest: int,
    installs: int = 0,
    document_types: list[str] | None = None,
    field_names: list[str] | None = None,
    rule_count: int = 0,
) -> s.PackOut:
    return s.PackOut(
        id=pack.id,
        name=pack.name,
        latest_version=latest,
        updated_at=pack.updated_at,
        installs=installs,
        document_types=document_types or [],
        field_names=field_names or [],
        rule_count=rule_count,
    )


def _spec_summary(spec: dict[str, object] | None) -> tuple[list[str], list[str], int]:
    """Documents reviewed, field names and rule count of one frozen version."""
    if not spec:
        return [], [], 0
    parsed = s.PackSpec.model_validate(spec)
    return parsed.document_types, [f.name for f in parsed.fields], len(parsed.rules)


def _installs_by_pack(db: Session) -> dict[uuid.UUID, int]:
    """How many workspaces have claimed each Pack — the marketplace popularity metric."""
    rows = db.execute(
        select(Workspace.pack_id, func.count())
        .where(Workspace.pack_id.is_not(None))
        .group_by(Workspace.pack_id)
    ).all()
    return {pack_id: count for pack_id, count in rows if pack_id is not None}


def _version_out(v: PackVersion) -> s.PackVersionOut:
    return s.PackVersionOut(
        id=v.id,
        version=v.version,
        created_at=v.created_at,
        spec=s.PackSpec.model_validate(v.spec),
        contract_version=v.contract_version,
    )


def _review_out(r: PackReview) -> s.PackReviewOut:
    return s.PackReviewOut(
        id=r.id,
        pack_id=r.pack_id,
        revision_id=r.revision_id,
        submitted_by=r.submitted_by,
        submitted_at=r.submitted_at,
        approved_by=r.approved_by,
        approved_at=r.approved_at,
        state=r.state,
        validation_digest=r.validation_digest,
    )


def _release_out(r: PackRelease) -> s.PackReleaseOut:
    return s.PackReleaseOut(
        id=r.id,
        pack_id=r.pack_id,
        pack_version_id=r.pack_version_id,
        environment=r.environment,
        action=r.action,
        source_release_id=r.source_release_id,
        restored_from_release_id=r.restored_from_release_id,
        created_by=r.created_by,
        created_at=r.created_at,
    )


def _audit_out(e: PackAuditEvent) -> s.PackAuditEventOut:
    return s.PackAuditEventOut(
        id=e.id,
        pack_id=e.pack_id,
        event_type=e.event_type,
        actor_id=e.actor_id,
        revision_id=e.revision_id,
        version_id=e.version_id,
        release_id=e.release_id,
        environment=e.environment,
        metadata=e.event_metadata,
        created_at=e.created_at,
    )


def _review_of_pack(db: Session, pack_id: uuid.UUID, review_id: uuid.UUID) -> PackReview:
    review = db.get(PackReview, review_id)
    if review is None or review.pack_id != pack_id:
        raise ApiError(Code.REVIEW_NOT_FOUND, "Review not found.", 404)
    return review


def _release_of_pack(db: Session, pack_id: uuid.UUID, release_id: uuid.UUID) -> PackRelease:
    release = db.get(PackRelease, release_id)
    if release is None or release.pack_id != pack_id:
        raise ApiError(Code.RELEASE_NOT_FOUND, "Release not found.", 404)
    return release


@router.post("", response_model=s.PackOut, status_code=201)
def create_pack(body: s.PackCreate, db: DB) -> s.PackOut:
    existing = db.scalar(select(Pack).where(Pack.name == body.name))
    if existing:
        raise ApiError(Code.PACK_NAME_TAKEN, "A pack with this name already exists.", 409)
    pack = Pack(name=body.name)
    db.add(pack)
    db.commit()
    return _pack_out(pack, latest=0)


@router.get("", response_model=list[s.PackOut])
def list_packs(
    db: DB,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[s.PackOut]:
    """Paginated (CLAUDE.md §3.5). An out-of-range `limit` is rejected as 422, not clamped —
    silently returning fewer rows than asked for is how clients ship broken paging."""
    packs = db.scalars(
        select(Pack)
        .order_by(func.coalesce(Pack.updated_at, Pack.created_at).desc())
        .limit(limit)
        .offset(offset)
    ).all()
    installs = _installs_by_pack(db)
    out = []
    for pack in packs:
        latest = (
            db.scalar(select(func.max(PackVersion.version)).where(PackVersion.pack_id == pack.id))
            or 0
        )
        doc_types, field_names, rule_count = [], [], 0
        if latest:
            spec = db.scalar(
                select(PackVersion.spec).where(
                    PackVersion.pack_id == pack.id, PackVersion.version == latest
                )
            )
            doc_types, field_names, rule_count = _spec_summary(spec)
        out.append(
            _pack_out(
                pack,
                latest,
                installs=installs.get(pack.id, 0),
                document_types=doc_types,
                field_names=field_names,
                rule_count=rule_count,
            )
        )
    return out


def _get_pack(db: Session, pack_id: uuid.UUID) -> Pack:
    pack = db.get(Pack, pack_id)
    if not pack:
        raise ApiError(Code.PACK_NOT_FOUND, "Pack not found.", 404)
    return pack


@router.get("/{pack_id}", response_model=s.PackDetailOut)
def get_pack(pack_id: uuid.UUID, db: DB) -> s.PackDetailOut:
    pack = _get_pack(db, pack_id)
    versions = db.scalars(
        select(PackVersion).where(PackVersion.pack_id == pack_id).order_by(PackVersion.version)
    ).all()
    latest = versions[-1].version if versions else 0
    installs = db.scalar(
        select(func.count()).select_from(Workspace).where(Workspace.pack_id == pack_id)
    ) or 0
    doc_types, field_names, rule_count = _spec_summary(versions[-1].spec if versions else None)
    return s.PackDetailOut(
        pack=_pack_out(
            pack,
            latest,
            installs=installs,
            document_types=doc_types,
            field_names=field_names,
            rule_count=rule_count,
        ),
        versions=[_version_out(v) for v in versions],
    )


@router.get("/{pack_id}/versions/{version}", response_model=s.PackVersionOut)
def get_version(pack_id: uuid.UUID, version: int, db: DB) -> s.PackVersionOut:
    _get_pack(db, pack_id)
    row = db.scalar(
        select(PackVersion).where(PackVersion.pack_id == pack_id, PackVersion.version == version)
    )
    if not row:
        raise ApiError(Code.PACK_VERSION_NOT_FOUND, "Pack version not found.", 404)
    return _version_out(row)


@router.post("/{pack_id}/versions", response_model=s.PackVersionOut, status_code=201)
def approve_version(
    pack_id: uuid.UUID, body: s.PackApprove, user: CurrentUser, db: DB
) -> s.PackVersionOut:
    """The review gate. A frozen version is created only by approving a Studio draft:
    either through a reviewed revision (`POST /reviews/.../approve`) or the author's own
    quick-approve of a draft session. Direct spec submission is rejected (REVIEW_REQUIRED);
    the frontend always sends draft_session_id."""
    if body.spec is not None and body.draft_session_id is None:
        raise ApiError(
            Code.REVIEW_REQUIRED,
            "Direct spec submission is not allowed; approve via a reviewed Studio revision.",
            403,
        )
    if body.draft_session_id is not None and body.spec is not None:
        raise ApiError(
            Code.APPROVAL_SOURCE_INVALID,
            "Provide either a draft session or a spec, not both.",
            400,
        )
    if body.draft_session_id is None:
        raise ApiError(Code.APPROVAL_SOURCE_INVALID, "A draft session is required.", 422)

    session = db.get(StudioSession, body.draft_session_id)
    if session is None:
        raise ApiError(
            Code.STUDIO_DRAFT_NOT_FOUND, "That studio session has no draft to approve yet.", 404
        )
    # The draft is the legacy session.spec when present, else the session's current
    # revision workflow (the canonical studio draft). The quick-approve is the author
    # approving their own draft, so it writes the version, a development release, an
    # approved self-review, and audit events in ONE transaction.
    workflow: WorkflowSpecV1 | None = None
    draft_spec: s.PackSpec | None = None
    if session.spec:
        draft_spec = s.PackSpec.model_validate(session.spec)
    elif session.current_revision_id is not None:
        revision = db.get(StudioDraftRevision, session.current_revision_id)
        if revision is None:
            raise ApiError(
                Code.STUDIO_DRAFT_NOT_FOUND,
                "That studio session has no draft to approve yet.",
                404,
            )
        workflow = WorkflowSpecV1.model_validate(revision.workflow)
        result = validate(workflow)
        if not result.ok:
            raise ApiError(
                Code.PACK_REVIEW_INVALID,
                "The studio draft does not validate.",
                422,
                details={
                    "errors": [
                        {"code": e.code, "path": e.path, "message": e.message}
                        for e in result.errors
                    ]
                },
            )
    else:
        raise ApiError(
            Code.STUDIO_DRAFT_NOT_FOUND, "That studio session has no draft to approve yet.", 404
        )
    session.status = "approved"

    # Lock the pack row so concurrent approvals cannot race the version counter.
    pack = db.execute(select(Pack).where(Pack.id == pack_id).with_for_update()).scalar_one_or_none()
    if pack is None:
        raise ApiError(Code.PACK_NOT_FOUND, "Pack not found.", 404)

    next_version = (
        db.scalar(select(func.max(PackVersion.version)).where(PackVersion.pack_id == pack_id)) or 0
    ) + 1
    spec_dict = (
        workflow.model_dump(mode="json")
        if workflow is not None
        else draft_spec.model_dump(mode="json")
    )
    row = PackVersion(
        pack_id=pack_id,
        version=next_version,
        spec=spec_dict,
        contract_version=1 if workflow is not None else None,
    )
    db.add(row)
    db.flush()

    release = PackRelease(
        pack_id=pack_id,
        pack_version_id=row.id,
        environment="development",
        action="approve_to_development",
        created_by=user.id,
    )
    db.add(release)
    db.flush()

    revision_id = session.current_revision_id
    review = PackReview(
        pack_id=pack_id,
        revision_id=revision_id,
        submitted_by=user.id,
        submitted_at=datetime.now(),
        approved_by=user.id,
        approved_at=datetime.now(),
        state="approved",
    )
    db.add(review)

    db.add(
        PackAuditEvent(
            pack_id=pack_id,
            event_type="version_approved",
            actor_id=user.id,
            revision_id=revision_id,
            version_id=row.id,
        )
    )
    db.add(
        PackAuditEvent(
            pack_id=pack_id,
            event_type="release_created",
            actor_id=user.id,
            version_id=row.id,
            release_id=release.id,
            environment="development",
        )
    )
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise ApiError(
            Code.PACK_VERSION_IMMUTABLE,
            "Saved versions cannot change. Create a new version instead.",
            409,
        ) from exc
    db.refresh(row)
    return _version_out(row)


# --- Governance / release lifecycle -------------------------------------------


@router.post("/{pack_id}/reviews", response_model=s.PackReviewOut, status_code=201)
def submit_review(
    pack_id: uuid.UUID, body: s.PackReviewSubmit, user: CurrentUser, db: DB
) -> s.PackReviewOut:
    """Submit a draft revision for governance review (state="pending")."""
    review = releases_svc.submit_for_review(
        db,
        pack_id=pack_id,
        revision_id=body.revision_id,
        submitted_by=user.id,
        validation_digest=body.validation_digest,
    )
    return _review_out(review)


@router.post("/{pack_id}/reviews/{review_id}/approve", response_model=s.PackApproveReviewOut)
def approve_review(
    pack_id: uuid.UUID, review_id: uuid.UUID, user: CurrentUser, db: DB
) -> s.PackApproveReviewOut:
    """Approve a pending review: freeze the revision's workflow as the next immutable
    version and release it to development."""
    _review_of_pack(db, pack_id, review_id)
    version, release = releases_svc.approve_review(db, review_id, approved_by=user.id)
    return s.PackApproveReviewOut(version=_version_out(version), release=_release_out(release))


@router.get("/{pack_id}/releases", response_model=list[s.PackReleaseOut])
def list_releases(pack_id: uuid.UUID, db: DB) -> list[s.PackReleaseOut]:
    """The pack's release log, newest first."""
    _get_pack(db, pack_id)
    return [_release_out(r) for r in releases_svc.list_releases(db, pack_id)]


@router.post("/{pack_id}/releases/{release_id}/promote", response_model=s.PackReleaseOut)
def promote_release(
    pack_id: uuid.UUID,
    release_id: uuid.UUID,
    body: s.PackPromoteIn,
    user: CurrentUser,
    db: DB,
) -> s.PackReleaseOut:
    """Promote a release one environment forward (development → staging → production)."""
    _release_of_pack(db, pack_id, release_id)
    release = releases_svc.promote_release(db, release_id, body.environment, actor=user.id)
    return _release_out(release)


@router.post("/{pack_id}/releases/restore", response_model=s.PackReleaseOut)
def restore_release(
    pack_id: uuid.UUID, body: s.PackRestoreIn, user: CurrentUser, db: DB
) -> s.PackReleaseOut:
    """Restore a historical release's version into an environment as a NEW release row."""
    release = releases_svc.restore_release(
        db,
        pack_id=pack_id,
        environment=body.environment,
        historical_release_id=body.release_id,
        actor=user.id,
    )
    return _release_out(release)


@router.get("/{pack_id}/audit", response_model=list[s.PackAuditEventOut])
def list_audit(pack_id: uuid.UUID, db: DB) -> list[s.PackAuditEventOut]:
    """The pack's governance audit trail, newest first."""
    _get_pack(db, pack_id)
    return [_audit_out(e) for e in releases_svc.list_audit_events(db, pack_id)]
