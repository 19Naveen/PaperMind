"""Workspaces and the sessions inside them.

Every route depends on `current_user` and filters on `owner_id`. A workspace owned by
someone else answers 404, not 403: a 403 would confirm the id exists.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import app.schemas as s
from app.auth import CurrentUser
from app.db import DB
from app.errors import ApiError, Code
from app.llm import get_providers
from app.models import (
    Chunk,
    Pack,
    PackAsset,
    PackVersion,
    Run,
    User,
    Workspace,
    WorkspaceSession,
)
from app.retrieval import search
from app.runs import create_run_rows, run_task, serialize_run

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


# --- Session chat -------------------------------------------------------------


def _run_context(db: Session, session: WorkspaceSession, query: str) -> str:
    """Grounded context for a question, drawn from a completed run's documents. An empty
    string means there is nothing to ground on yet — the prompt says so instead of inventing."""
    if session.run_id is None:
        return ""
    run = db.get(Run, session.run_id)
    if run is None or run.status != "complete":
        return ""
    doc_ids = [rd.document_id for rd in run.documents]
    if not doc_ids:
        return ""
    chunk_ids = search(db, query, doc_ids, k=4)
    if not chunk_ids:
        return ""
    chunks = db.scalars(select(Chunk).where(Chunk.id.in_(chunk_ids))).all()
    lines = []
    for chunk in chunks:
        doc_name = chunk.document.name if chunk.document else "document"
        lines.append(f"[{doc_name}, page {chunk.page}] {chunk.text[:400]}")
    return "\n\n".join(lines)


def _sse(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/{workspace_id}/sessions/{session_id}/messages")
def send_session_message(
    workspace_id: uuid.UUID,
    session_id: uuid.UUID,
    body: s.SessionMessage,
    user: CurrentUser,
    db: DB,
) -> StreamingResponse:
    """The session agent: RAG over the run's documents when one is complete, honest
    about it when it is not. Streams SSE token events; the assistant reply is appended
    to `messages` so a reload shows the same conversation."""
    session = _owned_session(db, _owned(db, user, workspace_id), session_id)
    session.messages = [*session.messages, {"role": "user", "content": body.text}]
    db.commit()

    def gen() -> Iterator[str]:
        parts: list[str] = []
        context = _run_context(db, session, body.text)
        try:
            system = (
                "You assist an examiner working on a document review session. Ground your "
                "answer in the provided source excerpts; say what the documents say and "
                "note what they do not. No fabricated detail."
                if context
                else "You assist an examiner working on a document review session. The "
                "session has no completed run yet, so there are no source documents — say "
                "a run must finish first, then answer briefly."
            )
            for token in get_providers().llm.stream_text(
                system=system,
                user=(context + "\n\nQuestion: " + body.text) if context else body.text,
            ):
                parts.append(token)
                yield _sse({"type": "token", "text": token})
        except Exception:
            fallback = "I could not answer that right now. Try again in a moment."
            parts = [fallback]
            yield _sse({"type": "token", "text": fallback})
        session.messages = [
            *session.messages,
            {"role": "assistant", "content": "".join(parts)},
        ]
        db.commit()
        yield _sse({"type": "done"})

    return StreamingResponse(gen(), media_type="text/event-stream")


# --- Runs + Pack install ------------------------------------------------------


@router.post("/{workspace_id}/sessions/{session_id}/run", response_model=s.RunOut, status_code=201)
def run_session(
    workspace_id: uuid.UUID,
    session_id: uuid.UUID,
    body: s.SessionRunCreate,
    background: BackgroundTasks,
    user: CurrentUser,
    db: DB,
) -> s.RunOut:
    """Kick off the runtime engine for a session: pins the workspace's latest pack
    version, links the run to the session, and executes in the background."""
    workspace = _owned(db, user, workspace_id)
    session = _owned_session(db, workspace, session_id)
    if workspace.pack_id is None:
        raise ApiError(
            Code.PACK_NOT_INSTALLED,
            "Install a Pack in this workspace before running a session.",
            status=409,
        )
    pv = db.scalar(
        select(PackVersion)
        .where(PackVersion.pack_id == workspace.pack_id)
        .order_by(PackVersion.version.desc())
        .limit(1)
    )
    if pv is None:
        raise ApiError(
            Code.PACK_NO_VERSION,
            "The installed Pack has no frozen version yet — approve one first.",
            status=409,
        )
    run = create_run_rows(
        db,
        pv.id,
        [s.RunCaseIn(subject=session.subject or session.title, document_ids=body.document_ids)],
    )
    session.run_id = run.id
    session.status = "pending"
    db.commit()
    background.add_task(run_task, run.id)
    return serialize_run(run)


@router.post("/{workspace_id}/pack", response_model=s.WorkspaceOut)
def install_pack(
    workspace_id: uuid.UUID, body: s.WorkspacePackInstall, user: CurrentUser, db: DB
) -> s.WorkspaceOut:
    """Claim a Pack for this workspace. The 1:1 Workspace→Pack rule is a UNIQUE on
    pack_id; the IntegrityError branch covers the race of two workspaces claiming the
    same Pack at once."""
    workspace = _owned(db, user, workspace_id)
    pack = db.get(Pack, body.pack_id)
    if pack is None:
        raise ApiError(Code.PACK_NOT_FOUND, "Pack not found.", 404)
    if workspace.pack_id is not None:
        raise ApiError(
            Code.WORKSPACE_PACK_TAKEN,
            "This workspace already has a Pack. Remove it before installing another.",
            status=409,
        )
    try:
        workspace.pack_id = pack.id
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(
            Code.WORKSPACE_PACK_TAKEN,
            "This workspace already has a Pack. Remove it before installing another.",
            status=409,
        ) from None
    return _out(_owned_row(db, user, workspace_id))
