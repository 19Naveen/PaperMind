"""Workspaces and the sessions inside them.

Every route depends on `current_user` and filters on `owner_id`. A workspace owned by
someone else answers 404, not 403: a 403 would confirm the id exists.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

import app.schemas as s
from app.auth import CurrentUser
from app.db import DB
from app.errors import ApiError, Code
from app.models import Pack, PackAsset, PackVersion, User, Workspace, WorkspaceSession

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

WorkspaceRow = tuple[Workspace, str | None, int | None, int]

_SESSION_STATUSES = ("draft", "pending", "running", "complete", "failed")


def _rows_query() -> Select[WorkspaceRow]:
    """One statement for the whole list: pack name, latest pack version and session count
    are joined in, not fetched per row."""
    counts = (
        select(
            WorkspaceSession.workspace_id.label("workspace_id"),
            func.count().label("n"),
        )
        .group_by(WorkspaceSession.workspace_id)
        .subquery()
    )
    latest = (
        select(
            PackVersion.pack_id.label("pack_id"),
            func.max(PackVersion.version).label("version"),
        )
        .group_by(PackVersion.pack_id)
        .subquery()
    )
    return (
        select(
            Workspace,
            Pack.name,
            latest.c.version,
            func.coalesce(counts.c.n, 0),
        )
        .outerjoin(Pack, Pack.id == Workspace.pack_id)
        .outerjoin(latest, latest.c.pack_id == Workspace.pack_id)
        .outerjoin(counts, counts.c.workspace_id == Workspace.id)
    )


def _out(row: WorkspaceRow) -> s.WorkspaceOut:
    workspace, pack_name, pack_version, session_count = row
    return s.WorkspaceOut(
        id=workspace.id,
        name=workspace.name,
        goal=workspace.goal,
        pack_id=workspace.pack_id,
        pack_name=pack_name,
        pack_version=pack_version,
        session_count=session_count,
        updated_at=workspace.updated_at,
    )


def _session_out(row: WorkspaceSession) -> s.WorkspaceSessionOut:
    return s.WorkspaceSessionOut(
        id=row.id,
        title=row.title,
        status=row.status,
        run_id=row.run_id,
        subject=row.subject,
        messages=row.messages,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _owned_row(db: Session, user: User, workspace_id: uuid.UUID) -> WorkspaceRow:
    row = db.execute(
        _rows_query().where(Workspace.id == workspace_id, Workspace.owner_id == user.id)
    ).first()
    if row is None:
        raise ApiError(Code.WORKSPACE_NOT_FOUND, "workspace not found", status=404)
    return (row[0], row[1], row[2], row[3])


def _owned(db: Session, user: User, workspace_id: uuid.UUID) -> Workspace:
    workspace = db.scalar(
        select(Workspace).where(Workspace.id == workspace_id, Workspace.owner_id == user.id)
    )
    if workspace is None:
        raise ApiError(Code.WORKSPACE_NOT_FOUND, "workspace not found", status=404)
    return workspace


def _owned_session(db: Session, workspace: Workspace, session_id: uuid.UUID) -> WorkspaceSession:
    row = db.scalar(
        select(WorkspaceSession).where(
            WorkspaceSession.id == session_id,
            WorkspaceSession.workspace_id == workspace.id,
        )
    )
    if row is None:
        raise ApiError(Code.SESSION_NOT_FOUND, "session not found", status=404)
    return row


@router.get("", response_model=list[s.WorkspaceOut])
def list_workspaces(
    user: CurrentUser,
    db: DB,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[s.WorkspaceOut]:
    rows = db.execute(
        _rows_query()
        .where(Workspace.owner_id == user.id)
        .order_by(Workspace.updated_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [_out((r[0], r[1], r[2], r[3])) for r in rows]


@router.post("", response_model=s.WorkspaceOut, status_code=201)
def create_workspace(body: s.WorkspaceCreate, user: CurrentUser, db: DB) -> s.WorkspaceOut:
    workspace = Workspace(owner_id=user.id, name=body.name, goal=body.goal)
    db.add(workspace)
    db.commit()
    return _out((workspace, None, None, 0))


@router.get("/{workspace_id}", response_model=s.WorkspaceDetailOut)
def get_workspace(workspace_id: uuid.UUID, user: CurrentUser, db: DB) -> s.WorkspaceDetailOut:
    row = _owned_row(db, user, workspace_id)
    workspace, _, pack_version, _ = row
    sessions = db.scalars(
        select(WorkspaceSession)
        .where(WorkspaceSession.workspace_id == workspace.id)
        .order_by(WorkspaceSession.created_at.desc())
    ).all()
    assets: list[PackAsset] = []
    if workspace.pack_id is not None and pack_version is not None:
        assets = list(
            db.scalars(
                select(PackAsset)
                .join(PackVersion, PackVersion.id == PackAsset.pack_version_id)
                .where(
                    PackVersion.pack_id == workspace.pack_id,
                    PackVersion.version == pack_version,
                )
                .order_by(PackAsset.name)
            ).all()
        )
    return s.WorkspaceDetailOut(
        **_out(row).model_dump(),
        sessions=[_session_out(r) for r in sessions],
        assets=[s.PackAssetOut(id=a.id, name=a.name, meta=a.meta) for a in assets],
    )


@router.patch("/{workspace_id}", response_model=s.WorkspaceOut)
def update_workspace(
    workspace_id: uuid.UUID, body: s.WorkspaceCreate, user: CurrentUser, db: DB
) -> s.WorkspaceOut:
    workspace = _owned(db, user, workspace_id)
    # exclude_unset: a PATCH that sends only `name` must not reset the goal to the
    # schema's "" default.
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(workspace, field, value)
    db.commit()
    return _out(_owned_row(db, user, workspace_id))


@router.delete("/{workspace_id}", status_code=204)
def delete_workspace(workspace_id: uuid.UUID, user: CurrentUser, db: DB) -> None:
    db.delete(_owned(db, user, workspace_id))
    db.commit()


@router.post("/{workspace_id}/sessions", response_model=s.WorkspaceSessionOut, status_code=201)
def create_session(
    workspace_id: uuid.UUID, body: s.SessionCreate, user: CurrentUser, db: DB
) -> s.WorkspaceSessionOut:
    workspace = _owned(db, user, workspace_id)
    row = WorkspaceSession(
        workspace_id=workspace.id,
        title=body.title,
        subject=body.subject,
        status="draft",
        messages=[],
    )
    db.add(row)
    db.commit()
    return _session_out(row)


@router.get("/{workspace_id}/sessions/{session_id}", response_model=s.WorkspaceSessionOut)
def get_session(
    workspace_id: uuid.UUID, session_id: uuid.UUID, user: CurrentUser, db: DB
) -> s.WorkspaceSessionOut:
    return _session_out(_owned_session(db, _owned(db, user, workspace_id), session_id))


@router.patch("/{workspace_id}/sessions/{session_id}", response_model=s.WorkspaceSessionOut)
def update_session(
    workspace_id: uuid.UUID,
    session_id: uuid.UUID,
    body: s.SessionUpdate,
    user: CurrentUser,
    db: DB,
) -> s.WorkspaceSessionOut:
    row = _owned_session(db, _owned(db, user, workspace_id), session_id)
    # The status vocabulary is a CheckConstraint on the table; reject here so a bad value
    # is a 422 rather than a 500 from the database.
    if body.status is not None and body.status not in _SESSION_STATUSES:
        raise ApiError(
            Code.VALIDATION_ERROR,
            f"status must be one of {', '.join(_SESSION_STATUSES)}",
            status=422,
            details={"field": "status", "allowed": list(_SESSION_STATUSES)},
        )
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(row, field, value)
    db.commit()
    return _session_out(row)


@router.delete("/{workspace_id}/sessions/{session_id}", status_code=204)
def delete_session(
    workspace_id: uuid.UUID, session_id: uuid.UUID, user: CurrentUser, db: DB
) -> None:
    db.delete(_owned_session(db, _owned(db, user, workspace_id), session_id))
    db.commit()
