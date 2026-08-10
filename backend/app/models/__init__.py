"""SQLAlchemy models. Append-only + citation invariants are enforced by DB triggers in
backend/app/triggers.sql, not in Python — see the README/plan principle 6."""

from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from app.core.config import get_settings
from app.core.db import Base

settings = get_settings()


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _now() -> datetime:
    return datetime.now()


class Pack(Base):
    """Identity only. The spec (and its versioning) lives in pack_versions."""

    __tablename__ = "packs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    versions: Mapped[list[PackVersion]] = relationship(
        back_populates="pack", cascade="all, delete-orphan"
    )


class PackVersion(Base):
    """A frozen spec. Append-only: UPDATE/DELETE are rejected by a DB trigger."""

    __tablename__ = "pack_versions"
    __table_args__ = (
        UniqueConstraint("pack_id", "version", name="uq_pack_versions_pack_version"),
        CheckConstraint("version >= 1", name="ck_pack_versions_version_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    pack_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("packs.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    spec: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    # NULL == legacy v0 (pre-contract). New canonical-workflow versions write 1+.
    contract_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    pack: Mapped[Pack] = relationship(back_populates="versions")
    runs: Mapped[list[Run]] = relationship(back_populates="pack_version")
    assets: Mapped[list[PackAsset]] = relationship(
        back_populates="pack_version", cascade="all, delete-orphan"
    )


class Run(Base):
    """One execution. Pins the exact pack version and model that produced it."""

    __tablename__ = "runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','running','complete','failed')", name="ck_runs_status"
        ),
        CheckConstraint(
            (
                "stage IS NULL OR stage IN "
                "('classify','retrieve','extract','verify','cross-validate','report')"
            ),
            name="ck_runs_stage",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    pack_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("pack_versions.id"), nullable=False
    )
    model_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    stage: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    report: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    # The pack release this run executed under (the release that pinned the version
    # into an environment). Nullable: historical runs predate the release lifecycle.
    release_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("pack_releases.id", ondelete="SET NULL"), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    pack_version: Mapped[PackVersion] = relationship(back_populates="runs")
    cases: Mapped[list[Case]] = relationship(back_populates="run", cascade="all, delete-orphan")
    documents: Mapped[list[RunDocument]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    facts: Mapped[list[Fact]] = relationship(back_populates="run", cascade="all, delete-orphan")


class Case(Base):
    """One subject under review — a vendor, a customer, a lease."""

    __tablename__ = "cases"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    subject: Mapped[str] = mapped_column(Text, nullable=False)

    run: Mapped[Run] = relationship(back_populates="cases")
    documents: Mapped[list[RunDocument]] = relationship(back_populates="case")
    facts: Mapped[list[Fact]] = relationship(back_populates="case")


class Document(Base):
    """An uploaded artifact. Run-independent — documents belong to cases via run_documents."""

    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    blob_path: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Offsets are {page, char_start, char_end} — see flatten_pages in ingest.py.
    pages: Mapped[list[dict[str, int]]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    chunks: Mapped[list[Chunk]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    run_links: Mapped[list[RunDocument]] = relationship(back_populates="document")


class RunDocument(Base):
    """A document's membership in a run, with the classified doc_type."""

    __tablename__ = "run_documents"
    __table_args__ = (
        UniqueConstraint("run_id", "document_id", name="uq_run_documents_run_document"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False
    )
    document_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("documents.id"), nullable=False)
    doc_type: Mapped[str | None] = mapped_column(Text, nullable=True)

    run: Mapped[Run] = relationship(back_populates="documents")
    case: Mapped[Case] = relationship(back_populates="documents")
    document: Mapped[Document] = relationship(back_populates="run_links")


class Chunk(Base):
    """A page-aligned text window with absolute char offsets into the flattened document
    text. The offsets are what make a citation checkable rather than decorative."""

    __tablename__ = "chunks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    page: Mapped[int] = mapped_column(Integer, nullable=False)
    char_start: Mapped[int] = mapped_column(Integer, nullable=False)
    char_end: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(settings.embedding_dim), nullable=False)
    tsv: Mapped[str] = mapped_column(TSVECTOR, nullable=False)

    document: Mapped[Document] = relationship(back_populates="chunks")
    citations: Mapped[list[Citation]] = relationship(back_populates="chunk")

    __table_args__ = (
        Index(
            "ix_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        Index("ix_chunks_document_id", "document_id"),
        Index("ix_chunks_text_tsv", "tsv", postgresql_using="gin"),
    )

    @property
    def preview(self) -> str:
        return self.text[:120]


class Fact(Base):
    """One extracted field for one case. verified requires a citation — enforced by trigger."""

    __tablename__ = "facts"
    __table_args__ = (
        CheckConstraint("state IN ('verified','unsupported','missing')", name="ck_facts_state"),
        Index("ix_facts_run_case_field", "run_id", "case_id", "field"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False
    )
    field: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    run: Mapped[Run] = relationship(back_populates="facts")
    case: Mapped[Case] = relationship(back_populates="facts")
    citations: Mapped[list[Citation]] = relationship(
        back_populates="fact", cascade="all, delete-orphan"
    )
    corrections: Mapped[list[Correction]] = relationship(back_populates="fact")


class Citation(Base):
    """A quote grounded in a chunk. Offset fields mirror chunk.page/char_start/char_end."""

    __tablename__ = "citations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    fact_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("facts.id", ondelete="CASCADE"), nullable=False
    )
    chunk_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("chunks.id", ondelete="CASCADE"), nullable=False
    )
    quote: Mapped[str] = mapped_column(Text, nullable=False)
    char_start: Mapped[int] = mapped_column(Integer, nullable=False)
    char_end: Mapped[int] = mapped_column(Integer, nullable=False)
    page: Mapped[int] = mapped_column(Integer, nullable=False)

    fact: Mapped[Fact] = relationship(back_populates="citations")
    chunk: Mapped[Chunk] = relationship(back_populates="citations")


class Correction(Base):
    """Written, never applied. Feeds the v2-diff proposer (Phase 4+)."""

    __tablename__ = "corrections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    fact_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("facts.id", ondelete="CASCADE"), nullable=False
    )
    user_value: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    fact: Mapped[Fact] = relationship(back_populates="corrections")


class StudioSession(Base):
    """An authoring conversation. The spec it accrues stays a *draft* until the approve
    route writes a pack_versions row — that gate is a route, not a prompt instruction."""

    __tablename__ = "studio_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    pack_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("packs.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    spec: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    messages: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False, default=list)
    # Revision lifecycle: a session is owned by a workspace/user and pins the pack
    # version it branched from. current_revision_id points at studio_draft_revisions.id;
    # left as a plain Uuid with NO FK to avoid a circular FK dependency (a draft revision
    # FKs this session, this column would FK that revision — the cycle is real, so the
    # link is app-side). base_pack_version_id is the frozen pack this draft descended from.
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    base_pack_version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("pack_versions.id", ondelete="SET NULL"), nullable=True
    )
    current_revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class StudioTurn(Base):
    """One turn in the studio conversation. Append-only (UPDATE/DELETE rejected by trigger):
    the transcript is an audit trail of how a spec evolved, so rewriting history is not allowed."""

    __tablename__ = "studio_turns"
    __table_args__ = (Index("ix_studio_turns_session_order", "session_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("studio_sessions.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(Text, nullable=False)  # 'user' | 'assistant'
    content: Mapped[str] = mapped_column(Text, nullable=False)
    model_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="ok")  # 'ok' | 'failed'
    # revision_id points at studio_draft_revisions.id; plain Uuid (no FK) to avoid a
    # circular FK dependency between studio_turns and studio_draft_revisions (each
    # references the other). Integrity is enforced in app code, not by the DB.
    revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StudioDraftRevision(Base):
    """One frozen draft of a session's spec. Append-only: UPDATE/DELETE rejected by trigger.
    workflow holds the canonical WorkflowSpecV1 dump; diff/validation record how it differs
    from its parent and whether it currently validates. digest is the sha256 of the workflow."""

    __tablename__ = "studio_draft_revisions"
    __table_args__ = (
        UniqueConstraint("session_id", "revision_no", name="uq_studio_revisions_session_no"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("studio_sessions.id", ondelete="CASCADE"), nullable=False
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # parent_id is a self-reference (the prior revision this one was built from); plain
    # Uuid with NO FK to avoid a self-referential FK that would also need to be append-only
    # compatible. The chain is app-managed.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    workflow: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    diff: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False, default=list)
    validation: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    digest: Mapped[str] = mapped_column(Text, nullable=False)
    model_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StudioTestRun(Base):
    """A dry run of one revision against a set of documents. Append-only like the revision it
    tests: a test outcome is evidence, not an editable record. summary holds only safe counts."""

    __tablename__ = "studio_test_runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    revision_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("studio_draft_revisions.id", ondelete="CASCADE"), nullable=False
    )
    document_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    summary: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    digest: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    """An identity. Roles are a CheckConstraint rather than a lookup table: two values that
    the authorization code branches on directly gain nothing from a join."""

    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role IN ('examiner','admin')", name="ck_users_role"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="examiner")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    workspaces: Mapped[list[Workspace]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class Workspace(Base):
    """A business objective and the one Pack that serves it. A workspace holds a single
    Pack (enforced in route code); a published Pack may serve any number of workspaces."""

    __tablename__ = "workspaces"
    __table_args__ = (
        CheckConstraint(
            "environment IN ('development','staging','production')",
            name="ck_workspaces_environment",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # Which deployment the workspace's Pack is released to. 'production' is the default
    # so pre-lifecycle workspaces read as the production tenant they already are.
    environment: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="production"
    )
    # Nullable: a workspace is authored before its Pack is frozen. Not unique: a
    # marketplace Pack is a shared artifact any number of workspaces may install —
    # each workspace still holds only one Pack (enforced in route code).
    pack_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("packs.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner: Mapped[User] = relationship(back_populates="workspaces")
    sessions: Mapped[list[WorkspaceSession]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )


class WorkspaceSession(Base):
    """A conversation *about* a run. It exists before the run does — which is why run_id is
    nullable and 'draft' is a status the runs table has no equivalent for."""

    __tablename__ = "workspace_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','pending','running','complete','failed')",
            name="ck_workspace_sessions_status",
        ),
        Index("ix_workspace_sessions_workspace_created", "workspace_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("runs.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="draft")
    messages: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False, default=list)
    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    workspace: Mapped[Workspace] = relationship(back_populates="sessions")


class PackAsset(Base):
    """A template or policy file a spec references. Hung off pack_versions, not packs: a Pack
    whose template file can change underneath it is not reproducible, so assets are frozen
    with the version that cites them."""

    __tablename__ = "pack_assets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    pack_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("pack_versions.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    blob_path: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    pack_version: Mapped[PackVersion] = relationship(back_populates="assets")


class RunNodeAttempt(Base):
    """One attempt at one DAG node within a run. This is LIVE execution state — status and
    timestamps mutate as the run progresses, so unlike pack_versions there is deliberately
    NO immutability trigger. One row per (run, node, attempt)."""

    __tablename__ = "run_node_attempts"
    __table_args__ = (
        UniqueConstraint(
            "run_id", "node_id", "attempt_no", name="uq_run_node_attempts_run_node_attempt"
        ),
        Index("ix_run_node_attempts_run_id", "run_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
    )
    node_id: Mapped[str] = mapped_column(Text, nullable=False)
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="running")
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    branch_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_digest: Mapped[str | None] = mapped_column(Text, nullable=True)


class PackReview(Base):
    """A governance review of one draft revision. A pending review may be updated to
    approved/rejected; a terminal review is immutable (trigger-enforced)."""

    __tablename__ = "pack_reviews"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    pack_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("packs.id", ondelete="CASCADE"), nullable=False
    )
    # revision_id points at studio_draft_revisions.id; plain Uuid with NO FK — the same
    # circular-dependency rationale as studio_sessions.current_revision_id (the draft
    # revision the review decides on lives under a session that references revisions).
    revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    state: Mapped[str] = mapped_column(Text, nullable=False, server_default="pending")
    validation_digest: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PackRelease(Base):
    """One release action (promote/rollback/install…) of a pack version into an environment.
    Append-only: the release log is an audit trail, so UPDATE/DELETE are trigger-rejected."""

    __tablename__ = "pack_releases"
    __table_args__ = (Index("ix_pack_releases_pack_env", "pack_id", "environment"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    pack_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("packs.id", ondelete="CASCADE"), nullable=False
    )
    pack_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("pack_versions.id", ondelete="CASCADE"), nullable=False
    )
    environment: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    # Self-referential links (the release this one superseded / restored from) kept as
    # plain Uuids with NO FK: pack_releases is append-only, so an FK would join to rows
    # that can never be deleted while forcing an extra constraint — the chain is app-managed.
    source_release_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    restored_from_release_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PackAuditEvent(Base):
    """Every governance-relevant event on a pack. Fully append-only (UPDATE/DELETE rejected
    by trigger): an audit trail that could be rewritten is not an audit trail."""

    __tablename__ = "pack_audit_events"
    __table_args__ = (Index("ix_pack_audit_events_pack_created", "pack_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    pack_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("packs.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("pack_versions.id", ondelete="SET NULL"), nullable=True
    )
    release_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    environment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # DB column is literally `metadata`; the attribute is event_metadata because `metadata`
    # is reserved by the Declarative API (it names the class's MetaData object).
    event_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


TRIGGERS_SQL_SOURCE = """
-- Append-only pack_versions: principle 6 lives in the DB, not in Python.
CREATE OR REPLACE FUNCTION f_block_pack_version_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'pack_versions is append-only: UPDATE/DELETE is not allowed (version %% of pack %%)',
        OLD.version, OLD.pack_id;
    RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pack_versions_no_update ON pack_versions;
CREATE TRIGGER pack_versions_no_update
    BEFORE UPDATE OR DELETE ON pack_versions
    FOR EACH ROW EXECUTE FUNCTION f_block_pack_version_mutation();

-- "No verified fact without a citation" — enforced as a deferred constraint trigger so the
-- fact row and its citations can be inserted in the same transaction.
CREATE OR REPLACE FUNCTION f_check_verified_has_citation() RETURNS trigger AS $$
DECLARE
    n integer;
BEGIN
    SELECT count(*) INTO n FROM citations WHERE fact_id = NEW.id;
    IF n = 0 THEN
        RAISE EXCEPTION 'verified fact %% must have at least one citation (violates "no citation, no result")', NEW.id;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS facts_verified_requires_citation ON facts;
CREATE CONSTRAINT TRIGGER facts_verified_requires_citation
    AFTER INSERT OR UPDATE OF state ON facts
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.state = 'verified') EXECUTE FUNCTION f_check_verified_has_citation();

CREATE OR REPLACE FUNCTION f_check_verified_have_citations() RETURNS trigger AS $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT f.id
             FROM facts f
             WHERE f.state = 'verified'
               AND NOT EXISTS (SELECT 1 FROM citations c WHERE c.fact_id = f.id)
             LIMIT 1
    LOOP
        RAISE EXCEPTION 'verified fact %% lost its citations', r.id;
    END LOOP;
    RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS citations_preserve_fact_invariants ON citations;
CREATE CONSTRAINT TRIGGER citations_preserve_fact_invariants
    AFTER INSERT OR UPDATE OR DELETE ON citations
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION f_check_verified_have_citations();

-- Append-only studio_draft_revisions / studio_turns / studio_test_runs: a revision is a
-- frozen artifact like pack_versions, and turns/test-runs are the audit trail behind it.
CREATE OR REPLACE FUNCTION f_block_studio_draft_revisions_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'studio_draft_revisions is append-only: UPDATE/DELETE is not allowed (revision_no %% of session %%)',
        OLD.revision_no, OLD.session_id;
    RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS studio_draft_revisions_no_update ON studio_draft_revisions;
CREATE TRIGGER studio_draft_revisions_no_update
    BEFORE UPDATE OR DELETE ON studio_draft_revisions
    FOR EACH ROW EXECUTE FUNCTION f_block_studio_draft_revisions_mutation();

CREATE OR REPLACE FUNCTION f_block_studio_turns_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'studio_turns is append-only: UPDATE/DELETE is not allowed (turn %% of session %%)',
        OLD.id, OLD.session_id;
    RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS studio_turns_no_update ON studio_turns;
CREATE TRIGGER studio_turns_no_update
    BEFORE UPDATE OR DELETE ON studio_turns
    FOR EACH ROW EXECUTE FUNCTION f_block_studio_turns_mutation();

CREATE OR REPLACE FUNCTION f_block_studio_test_runs_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'studio_test_runs is append-only: UPDATE/DELETE is not allowed (test run %% of revision %%)',
        OLD.id, OLD.revision_id;
    RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS studio_test_runs_no_update ON studio_test_runs;
CREATE TRIGGER studio_test_runs_no_update
    BEFORE UPDATE OR DELETE ON studio_test_runs
    FOR EACH ROW EXECUTE FUNCTION f_block_studio_test_runs_mutation();

-- Append-only pack_audit_events / pack_releases: the release log and audit trail are
-- immutable evidence, like pack_versions. pack_reviews is the exception: a *pending*
-- review may be updated (to approved/rejected), but a terminal review is frozen.
CREATE OR REPLACE FUNCTION f_block_pack_audit_event_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'pack_audit_events is append-only: UPDATE/DELETE is not allowed (event %% of pack %%)',
        OLD.id, OLD.pack_id;
    RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pack_audit_events_no_update ON pack_audit_events;
CREATE TRIGGER pack_audit_events_no_update
    BEFORE UPDATE OR DELETE ON pack_audit_events
    FOR EACH ROW EXECUTE FUNCTION f_block_pack_audit_event_mutation();

CREATE OR REPLACE FUNCTION f_block_pack_release_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'pack_releases is append-only: UPDATE/DELETE is not allowed (release %% of pack %%)',
        OLD.id, OLD.pack_id;
    RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pack_releases_no_update ON pack_releases;
CREATE TRIGGER pack_releases_no_update
    BEFORE UPDATE OR DELETE ON pack_releases
    FOR EACH ROW EXECUTE FUNCTION f_block_pack_release_mutation();

CREATE OR REPLACE FUNCTION f_block_pack_review_mutation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' OR OLD.state IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'pack_reviews is immutable once decided: mutation not allowed (review %% of pack %%)',
            OLD.id, OLD.pack_id;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pack_reviews_no_update ON pack_reviews;
CREATE TRIGGER pack_reviews_no_update
    BEFORE UPDATE OR DELETE ON pack_reviews
    FOR EACH ROW EXECUTE FUNCTION f_block_pack_review_mutation();
"""


def install_triggers(db: Session) -> None:
    """Create/refresh the DB triggers. Raw SQL: `%` here must reach Postgres verbatim, and
    neither SQLAlchemy text() nor psycopg's placeholder rules should process it."""
    db.connection().exec_driver_sql(TRIGGERS_SQL_SOURCE)
    db.commit()
