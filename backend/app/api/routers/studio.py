"""Pack Studio: conversational authoring. The conversation accretes a draft Pack spec;
only an explicit approve call writes a pack_versions row (see packs.approve_version).

Drafting is delegated to app.services.studio (the revision engine): each turn validates a
proposed WorkflowSpecV1 and, when valid, advances the session to a new draft revision.
The legacy `session.spec` field and the approve/preview flows that read it are left
untouched here — the workflow-aware preview/approve land in a later wave.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from typing import cast

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

import app.schemas as s
from app.api.deps import DB, CurrentUser
from app.core.errors import ApiError, Code
from app.models import StudioDraftRevision, StudioSession
from app.repositories import studio as repos
from app.services import studio as studio_svc
from app.services.runtime import preview_document
from app.services.workflow_contract import (
    ValidationResult,
    WorkflowSpecV1,
    project_legacy,
)

router = APIRouter(prefix="/studio", tags=["studio"])


def get_draft(db: Session, session_id: uuid.UUID) -> s.PackSpec | None:
    session = db.get(StudioSession, session_id)
    if session is None or not session.spec:
        return None
    return s.PackSpec.model_validate(session.spec)


def mark_approved(db: Session, session_id: uuid.UUID) -> None:
    session = db.get(StudioSession, session_id)
    if session is not None:
        session.status = "approved"
        db.commit()


def _revision_out(revision: StudioDraftRevision) -> s.StudioDraftRevisionOut:
    return s.StudioDraftRevisionOut.model_validate(
        {
            "id": revision.id,
            "session_id": revision.session_id,
            "revision_no": revision.revision_no,
            "parent_id": revision.parent_id,
            "workflow": revision.workflow,
            "diff": revision.diff,
            "validation": revision.validation,
            "digest": revision.digest,
            "model_id": revision.model_id,
            "created_by_id": revision.created_by_id,
            "created_at": revision.created_at,
        }
    )


def _sse(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/sessions", status_code=201)
def create_session(body: s.StudioSessionCreate, db: DB, user: CurrentUser) -> dict[str, object]:
    if body.pack_id is not None and body.base_pack_version_id is not None:
        # Editing an existing Pack starts from its latest frozen version (revision 1).
        session = studio_svc.seed_from_pack_version(
            db,
            pack_id=body.pack_id,
            base_pack_version_id=body.base_pack_version_id,
            created_by_id=user.id,
            title=body.title or "Edit pack",
        )
    else:
        session = repos.create_session(
            db,
            title=body.title,
            workspace_id=body.workspace_id,
            created_by_id=user.id,
            pack_id=body.pack_id,
            base_pack_version_id=body.base_pack_version_id,
        )
    return studio_svc.session_summary(db, session)


@router.get("/sessions/{session_id}")
def get_session(session_id: uuid.UUID, db: DB) -> dict[str, object]:
    session = repos.get_session(db, session_id)
    if session is None:
        raise ApiError(Code.STUDIO_SESSION_NOT_FOUND, "Studio session not found.", 404)
    return studio_svc.session_summary(db, session)


@router.get("/sessions/{session_id}/revisions")
def list_revisions(session_id: uuid.UUID, db: DB) -> list[s.StudioDraftRevisionOut]:
    session = repos.get_session(db, session_id)
    if session is None:
        raise ApiError(Code.STUDIO_SESSION_NOT_FOUND, "Studio session not found.", 404)
    return [_revision_out(r) for r in repos.list_revisions(db, session_id)]


@router.get("/sessions/{session_id}/revisions/{revision_no}")
def get_revision(
    session_id: uuid.UUID, revision_no: int, db: DB
) -> s.StudioDraftRevisionOut:
    session = repos.get_session(db, session_id)
    if session is None:
        raise ApiError(Code.STUDIO_SESSION_NOT_FOUND, "Studio session not found.", 404)
    revision = repos.get_revision(db, session_id, revision_no)
    if revision is None:
        raise ApiError(Code.STUDIO_DRAFT_NOT_FOUND, "Revision not found.", 404)
    return _revision_out(revision)


@router.post("/sessions/{session_id}/messages")
def send_message(
    session_id: uuid.UUID, db: DB, body: s.StudioMessage, user: CurrentUser
) -> StreamingResponse:
    session = repos.get_session(db, session_id)
    if session is None:
        raise ApiError(Code.STUDIO_SESSION_NOT_FOUND, "Studio session not found.", 404)

    # The service records the assistant turn (ok or failed) inside process_turn.
    repos.create_turn(db, session_id=session_id, role="user", content=body.text, status="ok")

    def gen() -> Iterator[str]:
        try:
            yield _sse({"type": "token", "text": "Drafting your spec..."})
            result = studio_svc.process_turn(db, session, body.text, created_by_id=user.id)
            if result["ok"]:
                revision = cast(StudioDraftRevision, result["revision"])
                workflow = WorkflowSpecV1.model_validate(revision.workflow)
                yield _sse({"type": "draft_spec", "spec": project_legacy(workflow)})
                yield _sse(
                    {
                        "type": "revision",
                        "revision": _revision_out(revision).model_dump(mode="json"),
                    }
                )
            else:
                code = "INVALID_WORKFLOW" if result["error"] == "invalid" else "STUDIO_TURN_FAILED"
                details: dict[str, object] = {}
                validation = result.get("validation")
                if isinstance(validation, ValidationResult):
                    details = {
                        "errors": [
                            {"code": e.code, "path": e.path, "message": e.message}
                            for e in validation.errors
                        ]
                    }
                yield _sse({"type": "error", "code": code, "details": details})
        except Exception:
            fallback = "I couldn't draft that. Could you rephrase your request?"
            yield _sse({"type": "token", "text": fallback})

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.post("/sessions/{session_id}/preview")
def preview_session(session_id: uuid.UUID, body: s.StudioPreview, db: DB) -> s.StudioPreviewOut:
    draft = get_draft(db, session_id)
    if draft is None:
        raise ApiError(
            Code.STUDIO_DRAFT_NOT_FOUND, "This session has no draft to preview yet.", 409
        )
    if not body.document_ids:
        raise ApiError(Code.VALIDATION_ERROR, "Select at least one document to preview.", 422)
    facts = preview_document(db, draft, body.document_ids)
    return s.StudioPreviewOut(spec=draft, facts=facts)
