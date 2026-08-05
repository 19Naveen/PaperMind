"""Pydantic API models. The field names/types are the contract with the Next.js client
(web/lib/types.ts + the API table in docs/frontend-plan.md)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

FACT_STATES = ("verified", "unsupported", "missing")
RUN_STATUSES = ("pending", "running", "complete", "failed")
STAGES = ("classify", "retrieve", "extract", "verify", "cross-validate", "report")


class PackField(BaseModel):
    name: str
    description: str
    type: str


class PackRule(BaseModel):
    id: str
    description: str


class PackSpec(BaseModel):
    name: str
    document_types: list[str] = []
    fields: list[PackField] = []
    rules: list[PackRule] = []


# --- Packs -------------------------------------------------------------------
class PackCreate(BaseModel):
    name: str = Field(min_length=1)


class PackOut(BaseModel):
    id: uuid.UUID
    name: str
    latest_version: int
    updated_at: datetime


class PackVersionOut(BaseModel):
    id: uuid.UUID
    version: int
    created_at: datetime
    spec: PackSpec


class PackDetailOut(BaseModel):
    pack: PackOut
    versions: list[PackVersionOut]


class PackApprove(BaseModel):
    """The approval gate. Supply a draft_session_id (from the studio) OR a spec directly."""

    draft_session_id: uuid.UUID | None = None
    spec: PackSpec | None = None


class PackVersionRefOut(BaseModel):
    id: uuid.UUID
    pack_version_id: uuid.UUID
    pack_id: uuid.UUID
    pack_name: str
    version: int
    spec: PackSpec


# ---------------------------------------------------------------------------
# Run setup
# ---------------------------------------------------------------------------
class RunCaseIn(BaseModel):
    subject: str
    document_ids: list[uuid.UUID] = []


class RunCreate(BaseModel):
    pack_version_id: uuid.UUID
    cases: list[RunCaseIn] = []


# ---------------------------------------------------------------------------
# Run output — mirrors web/lib/types.ts Run shape exactly.
# ---------------------------------------------------------------------------
class Citation(BaseModel):
    chunk_id: uuid.UUID
    quote: str
    document_id: uuid.UUID
    document_name: str
    page: int
    char_start: int
    char_end: int


class Fact(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    field: str
    value: str | None
    state: str
    citations: list[Citation]


class RunDocument(BaseModel):
    id: uuid.UUID
    case_id: uuid.UUID
    name: str
    doc_type: str | None


class Case(BaseModel):
    id: uuid.UUID
    subject: str


class RunOut(BaseModel):
    id: uuid.UUID
    pack_id: uuid.UUID
    pack_name: str
    pack_version: int
    status: str
    stage: str | None
    started_at: datetime
    cases: list[Case]
    documents: list[RunDocument]
    facts: list[Fact]


class ReportOut(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    status: str
    stage: str | None
    error: str | None


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------
class DocumentOut(BaseModel):
    id: uuid.UUID
    name: str
    content_type: str | None


class DocumentContent(BaseModel):
    id: uuid.UUID
    name: str
    text: str
    pages: list[dict[str, int]]


class CorrectionCreate(BaseModel):
    fact_id: uuid.UUID
    user_value: str
    note: str | None = None


class CorrectionOut(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    fact_id: uuid.UUID
    user_value: str
    note: str | None
    created_at: datetime


# ---------------------------------------------------------------------------
# Studio / authoring
# ---------------------------------------------------------------------------
class StudioSessionCreate(BaseModel):
    title: str = "Untitled Pack"


class StudioMessage(BaseModel):
    text: str


class StudioPreview(BaseModel):
    document_ids: list[uuid.UUID] = []


class StudioPreviewOut(BaseModel):
    spec: PackSpec
    facts: list[dict[str, object]]


class StudioSessionOut(BaseModel):
    id: uuid.UUID
    pack_id: uuid.UUID | None
    title: str
    status: str
    draft: PackSpec | None
    created_at: datetime


class StudioDraftOut(BaseModel):
    session_id: uuid.UUID
    draft: PackSpec


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------
class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: str


class SignupIn(BaseModel):
    # `str`, not EmailStr: pydantic's email type needs the `email-validator` package, and
    # this module stays dependency-free. Real address validation belongs at signup anyway.
    email: str = Field(min_length=3)
    name: str = Field(min_length=1)
    password: str = Field(min_length=8)


class LoginIn(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


# ---------------------------------------------------------------------------
# Workspaces — mirrors web/lib/types.ts Workspace / WorkspaceSession.
# ---------------------------------------------------------------------------
class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1)
    goal: str = ""


class PackAssetOut(BaseModel):
    id: uuid.UUID
    name: str
    meta: str | None


class WorkspaceSessionOut(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    run_id: uuid.UUID | None
    subject: str | None
    messages: list[dict[str, object]]
    created_at: datetime
    updated_at: datetime


class WorkspaceOut(BaseModel):
    id: uuid.UUID
    name: str
    goal: str
    pack_id: uuid.UUID | None
    pack_name: str | None
    pack_version: int | None
    session_count: int
    updated_at: datetime


class WorkspaceDetailOut(WorkspaceOut):
    sessions: list[WorkspaceSessionOut]
    assets: list[PackAssetOut]


class SessionCreate(BaseModel):
    title: str = Field(min_length=1)
    subject: str | None = None


class SessionUpdate(BaseModel):
    title: str | None = None
    subject: str | None = None
    status: str | None = None
