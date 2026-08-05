"""Pack Studio: conversational authoring. The conversation accretes a draft Pack spec;
only an explicit approve call writes a pack_versions row (see packs.approve_version)."""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

import app.schemas as s
from app.db import DB
from app.llm import JSON_SCHEMA, get_providers
from app.models import StudioSession
from app.runtime import preview_document

router = APIRouter(prefix="/studio", tags=["studio"])

PACK_SPEC_SCHEMA: JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "document_types": {"type": "array", "items": {"type": "string"}},
        "fields": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "type": {"type": "string"},
                },
                "required": ["name", "description", "type"],
            },
        },
        "rules": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["id", "description"],
            },
        },
    },
    "required": ["name", "document_types", "fields", "rules"],
}


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


def _session_out(session: StudioSession) -> s.StudioSessionOut:
    draft = s.PackSpec.model_validate(session.spec) if session.spec else None
    return s.StudioSessionOut(
        id=session.id,
        pack_id=session.pack_id,
        title=session.title,
        status=session.status,
        draft=draft,
        created_at=session.created_at,
    )


def _heuristic_draft(text: str, title: str) -> s.PackSpec:
    """Offline draft when no LLM is configured. Good enough for the mock-driven UI and
    for tests to exercise the approve/preview wiring."""
    low = text.lower() + " " + title.lower()
    name = title.strip().title()
    if not name:
        name = "Untitled Pack"
    if "vendor" in low or "due diligence" in low:
        return s.PackSpec(
            name=name or "Vendor Due Diligence",
            document_types=["Vendor Contract", "DPA", "Privacy Policy"],
            fields=[
                s.PackField(
                    name="liability_cap",
                    description="Contractual cap on aggregate liability",
                    type="currency",
                ),
                s.PackField(
                    name="jurisdiction",
                    description="Governing law jurisdiction",
                    type="string",
                ),
                s.PackField(
                    name="dpa_signed_date",
                    description="Execution date of the Data Processing Agreement",
                    type="date",
                ),
            ],
            rules=[
                s.PackRule(
                    id="r1",
                    description=(
                        "A signed DPA must be present for any vendor processing EU personal data"
                    ),
                ),
                s.PackRule(id="r2", description="Liability cap must be at least $250,000"),
            ],
        )
    if "kyc" in low or "onboarding" in low:
        return s.PackSpec(
            name=name or "KYC Onboarding",
            document_types=["Passport", "Proof of Address", "Bank Statement"],
            fields=[
                s.PackField(
                    name="applicant_name",
                    description="Full legal name as shown on passport",
                    type="string",
                ),
                s.PackField(
                    name="proof_of_address_date",
                    description="Issue date of the proof-of-address document",
                    type="date",
                ),
            ],
            rules=[s.PackRule(id="r1", description="Passport must not be expired")],
        )
    return s.PackSpec(
        name=name,
        document_types=["Contract"],
        fields=[
            s.PackField(
                name="subject",
                description="Subject matter of the document",
                type="string",
            )
        ],
        rules=[],
    )


def _draft_spec(text: str, title: str) -> s.PackSpec:
    llm = get_providers().llm
    if llm.model_id.startswith("fake:"):
        return _heuristic_draft(text, title)
    try:
        result = llm.structured(
            PACK_SPEC_SCHEMA,
            system=(
                "You are a compliance Pack authoring assistant. Given the user's request, "
                "produce a Knowledge Pack as strict JSON with document_types, fields, and "
                "rules. A field needs name, description, and a type like string/date/currency."
            ),
            user=text,
        )
        return s.PackSpec.model_validate(result)
    except Exception:
        return _heuristic_draft(text, title)


def _sse(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/sessions", response_model=s.StudioSessionOut, status_code=201)
def create_session(body: s.StudioSessionCreate, db: DB) -> s.StudioSessionOut:
    session = StudioSession(title=body.title)
    db.add(session)
    db.commit()
    return _session_out(session)


@router.get("/sessions/{session_id}", response_model=s.StudioSessionOut)
def get_session(session_id: uuid.UUID, db: DB) -> s.StudioSessionOut:
    session = db.get(StudioSession, session_id)
    if session is None:
        raise HTTPException(404, "studio session not found")
    return _session_out(session)


@router.post("/sessions/{session_id}/messages")
def send_message(session_id: uuid.UUID, db: DB, body: s.StudioMessage) -> StreamingResponse:
    session = db.get(StudioSession, session_id)
    if session is None:
        raise HTTPException(404, "studio session not found")

    session.messages = [*session.messages, {"role": "user", "content": body.text}]
    db.commit()

    def gen() -> Iterator[str]:
        parts = []
        try:
            for token in _assistant_tokens(session, body.text):
                parts.append(token)
                yield _sse({"type": "token", "text": token})
        except Exception:
            fallback = "I couldn't draft that. Could you rephrase your request?"
            parts = [fallback]
            yield _sse({"type": "token", "text": fallback})
        session.messages = [
            *session.messages,
            {"role": "assistant", "content": "".join(parts)},
        ]
        draft = _draft_spec(body.text, session.title)
        session.spec = draft.model_dump(mode="json")
        db.commit()
        yield _sse({"type": "draft_spec", "spec": draft.model_dump(mode="json")})

    return StreamingResponse(gen(), media_type="text/event-stream")


def _assistant_tokens(session: StudioSession, user_text: str) -> list[str]:
    prompt = (
        f"The user wants to author this Knowledge Pack: {user_text}\n"
        "Ask up to two clarifying questions about documents and checks, then say you "
        "will draft the spec. Answer in under 80 words."
    )
    return list(
        get_providers().llm.stream_text(system="You author Knowledge Pack drafts.", user=prompt)
    )


@router.post("/sessions/{session_id}/preview")
def preview_session(session_id: uuid.UUID, body: s.StudioPreview, db: DB) -> s.StudioPreviewOut:
    draft = get_draft(db, session_id)
    if draft is None:
        raise HTTPException(409, "session has no draft to preview yet")
    if not body.document_ids:
        raise HTTPException(422, "at least one document_id is required")
    facts = preview_document(db, draft, body.document_ids)
    return s.StudioPreviewOut(spec=draft, facts=facts)
