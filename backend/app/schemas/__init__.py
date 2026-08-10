"""Pydantic API models. The field names/types are the contract with the Next.js client
(web/lib/types.ts + the API table in docs/frontend-plan.md)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.services.workflow_contract import DiffEntry, ValidationResult, WorkflowSpecV1

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
    installs: int = 0
    # Latest frozen version's shape — what the Pack reviews and extracts, so the
    # marketplace grid is informative without a per-pack detail fetch.
    document_types: list[str] = []
    field_names: list[str] = []
    rule_count: int = 0


class PackVersionOut(BaseModel):
    id: uuid.UUID
    version: int
    created_at: datetime
    spec: PackSpec
    contract_version: int | None = None


class PackDetailOut(BaseModel):
    pack: PackOut
    versions: list[PackVersionOut]


class PackApprove(BaseModel):
    """The approval gate. Supply a draft_session_id (from the studio) OR a spec directly."""

    draft_session_id: uuid.UUID | None = None
    spec: PackSpec | None = None


class PackReviewSubmit(BaseModel):
    """Submit a draft revision for governance review."""

    revision_id: uuid.UUID
    validation_digest: str | None = None


class PackPromoteIn(BaseModel):
    environment: str


class PackRestoreIn(BaseModel):
    environment: str
    release_id: uuid.UUID


class PackApproveReviewOut(BaseModel):
    version: PackVersionOut
    release: PackReleaseOut


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
    # The pack release this run executed under, if any.
    release_id: uuid.UUID | None = None


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
    workspace_id: uuid.UUID | None = None
    pack_id: uuid.UUID | None = None
    base_pack_version_id: uuid.UUID | None = None


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
    # Revision-lifecycle fields. All default-bearing so existing callers that build
    # StudioSessionOut without them keep working.
    workspace_id: uuid.UUID | None = None
    created_by_id: uuid.UUID | None = None
    base_pack_version_id: uuid.UUID | None = None
    current_revision: StudioDraftRevisionOut | None = None
    turns: list[StudioTurnOut] = []


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
    # Deployment target for the workspace's Pack. Default keeps pre-lifecycle callers
    # (and existing tests) reading as the production tenant they already are.
    environment: Literal["development", "staging", "production"] = "production"


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
    # Deployment target for the workspace's Pack. Default keeps pre-lifecycle callers
    # (and existing tests) reading as the production tenant they already are.
    environment: str = "production"


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


# ---------------------------------------------------------------------------
# Session chat + runs
# ---------------------------------------------------------------------------
class SessionMessage(BaseModel):
    text: str = Field(min_length=1)


class SessionRunCreate(BaseModel):
    document_ids: list[uuid.UUID] = []


class WorkspacePackInstall(BaseModel):
    pack_id: uuid.UUID


# ---------------------------------------------------------------------------
# Identity updates
# ---------------------------------------------------------------------------
class MeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    email: str | None = Field(default=None, min_length=3)


class PasswordUpdate(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


# ---------------------------------------------------------------------------
# Studio revision lifecycle — DTOs for the draft-revision / turn / test-run tables.
# WorkflowSpecV1 / DiffEntry / ValidationResult are re-exported from the pure domain
# module workflow_contract; embedding them here keeps the persisted shape canonical.
# ---------------------------------------------------------------------------
class StudioTurnOut(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    role: str
    content: str
    model_id: str | None
    status: str
    revision_id: uuid.UUID | None
    created_at: datetime


class StudioDraftRevisionOut(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    revision_no: int
    parent_id: uuid.UUID | None
    workflow: WorkflowSpecV1
    diff: list[DiffEntry]
    validation: ValidationResult
    digest: str
    model_id: str | None
    created_by_id: uuid.UUID | None
    created_at: datetime


class StudioTestRunOut(BaseModel):
    id: uuid.UUID
    revision_id: uuid.UUID
    document_ids: list[uuid.UUID]
    summary: dict[str, object]
    digest: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Run telemetry + pack release/governance lifecycle
# ---------------------------------------------------------------------------
class RunNodeAttemptOut(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    node_id: str
    attempt_no: int
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    branch_reason: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    output_digest: str | None = None


class PackReviewOut(BaseModel):
    id: uuid.UUID
    pack_id: uuid.UUID
    revision_id: uuid.UUID | None = None
    submitted_by: uuid.UUID | None = None
    submitted_at: datetime
    approved_by: uuid.UUID | None = None
    approved_at: datetime | None = None
    state: str
    validation_digest: str | None = None


class PackReleaseOut(BaseModel):
    id: uuid.UUID
    pack_id: uuid.UUID
    pack_version_id: uuid.UUID
    environment: str
    action: str
    source_release_id: uuid.UUID | None = None
    restored_from_release_id: uuid.UUID | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime


class PackAuditEventOut(BaseModel):
    id: uuid.UUID
    pack_id: uuid.UUID
    event_type: str
    actor_id: uuid.UUID | None = None
    revision_id: uuid.UUID | None = None
    version_id: uuid.UUID | None = None
    release_id: uuid.UUID | None = None
    environment: str | None = None
    metadata: dict[str, object] = Field(default_factory=dict)
    created_at: datetime


# ---------------------------------------------------------------------------
# Wave4 governance/release lifecycle
# ---------------------------------------------------------------------------
class GovernanceReviewSubmit(BaseModel):
    pack_id: uuid.UUID
    revision_id: uuid.UUID


class GovernanceReviewDecision(BaseModel):
    approve: bool


class GovernanceReleasePromote(BaseModel):
    pack_version_id: uuid.UUID
    environment: Literal["development", "staging", "production"]
    source_release_id: uuid.UUID | None = None


class GovernanceDecisionOut(BaseModel):
    review: PackReviewOut
    version: PackVersionOut | None = None
