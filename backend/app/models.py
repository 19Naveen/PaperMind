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

from app.config import get_settings
from app.db import Base

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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    pack: Mapped[Pack] = relationship(back_populates="versions")
    runs: Mapped[list[Run]] = relationship(back_populates="pack_version")


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
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
"""


def install_triggers(db: Session) -> None:
    """Create/refresh the DB triggers. Raw SQL: `%` here must reach Postgres verbatim, and
    neither SQLAlchemy text() nor psycopg's placeholder rules should process it."""
    db.connection().exec_driver_sql(TRIGGERS_SQL_SOURCE)
    db.commit()
