"""Pack + PackVersion CRUD. The approval gate (`POST /packs/{id}/versions`) is the only
way a draft becomes a frozen version — see app/studio.py."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import app.schemas as s
from app.core.db import DB
from app.core.errors import ApiError, Code
from app.models import Pack, PackVersion

router = APIRouter(prefix="/packs", tags=["packs"])


def _pack_out(pack: Pack, latest: int) -> s.PackOut:
    return s.PackOut(id=pack.id, name=pack.name, latest_version=latest, updated_at=pack.updated_at)


def _version_out(v: PackVersion) -> s.PackVersionOut:
    return s.PackVersionOut(
        id=v.id,
        version=v.version,
        created_at=v.created_at,
        spec=s.PackSpec.model_validate(v.spec),
    )


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
    out = []
    for pack in packs:
        latest = (
            db.scalar(select(func.max(PackVersion.version)).where(PackVersion.pack_id == pack.id))
            or 0
        )
        out.append(_pack_out(pack, latest))
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
    return s.PackDetailOut(
        pack=_pack_out(pack, latest), versions=[_version_out(v) for v in versions]
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
def approve_version(pack_id: uuid.UUID, body: s.PackApprove, db: DB) -> s.PackVersionOut:
    """The review gate. Frames a draft (or a submitted spec) into an immutable version."""
    if body.draft_session_id and body.spec is not None:
        raise ApiError(
            Code.APPROVAL_SOURCE_INVALID,
            "Provide either a draft session or a spec, not both.",
            400,
        )

    draft: s.PackSpec | None = body.spec
    if draft is None and body.draft_session_id is not None:
        from app.api.v1.routers.studio import (
            get_draft,
            mark_approved,
        )  # local import avoids a circular import

        draft = get_draft(db, body.draft_session_id)
        if draft is None:
            raise ApiError(
                Code.STUDIO_DRAFT_NOT_FOUND,
                "That studio session has no draft to approve yet.",
                404,
            )
        mark_approved(db, body.draft_session_id)
    if draft is None:
        raise ApiError(Code.APPROVAL_SOURCE_INVALID, "A draft session or a spec is required.", 422)

    spec = draft

    _get_pack(db, pack_id)
    next_version = (
        db.scalar(select(func.max(PackVersion.version)).where(PackVersion.pack_id == pack_id)) or 0
    ) + 1

    row = PackVersion(pack_id=pack_id, version=next_version, spec=spec.model_dump(mode="json"))
    db.add(row)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise ApiError(
            Code.PACK_VERSION_IMMUTABLE,
            "Saved versions cannot change. Create a new version instead.",
            409,
        ) from exc
    return _version_out(row)
