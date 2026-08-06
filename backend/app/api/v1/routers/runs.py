"""Run lifecycle: create (+kick off in a background task), poll, correct. The client
chooses only *which frozen Pack to run* — nothing here lets it pick a model or strategy."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

import app.schemas as s
from app.core.db import DB
from app.core.errors import ApiError, Code
from app.models import (
    Case,
    Chunk,
    Citation,
    Correction,
    Document,
    Fact,
    PackVersion,
    Run,
    RunDocument,
)
from app.services.llm import get_providers
from app.services.runtime import execute_run

router = APIRouter(prefix="/runs", tags=["runs"])


def _citation_out(c: Citation) -> s.Citation:
    chunk = c.chunk
    return s.Citation(
        chunk_id=chunk.id,
        quote=c.quote,
        document_id=chunk.document_id,
        document_name=chunk.document.name,
        page=c.page,
        char_start=c.char_start,
        char_end=c.char_end,
    )


def _fact_out(f: Fact, include_citations: bool = True) -> s.Fact:
    citations = [_citation_out(c) for c in f.citations] if include_citations else []
    return s.Fact(
        id=f.id,
        case_id=f.case_id,
        field=f.field,
        value=f.value,
        state=f.state,
        citations=citations,
    )


def serialize_run(run: Run) -> s.RunOut:
    pv = run.pack_version
    return s.RunOut(
        id=run.id,
        pack_id=pv.pack_id,
        pack_name=pv.pack.name,
        pack_version=pv.version,
        status=run.status,
        stage=run.stage,
        started_at=run.started_at,
        cases=[s.Case(id=c.id, subject=c.subject) for c in run.cases],
        documents=[
            s.RunDocument(
                id=rd.document_id,
                case_id=rd.case_id,
                name=rd.document.name,
                doc_type=rd.doc_type,
            )
            for rd in run.documents
        ],
        facts=sorted([_fact_out(f) for f in run.facts], key=lambda f: f.field),
    )


def load_run(db: Session, run_id: uuid.UUID) -> Run:
    run = db.scalar(
        select(Run)
        .options(
            selectinload(Run.pack_version).selectinload(PackVersion.pack),
            selectinload(Run.cases),
            selectinload(Run.documents).selectinload(RunDocument.document),
            selectinload(Run.facts)
            .selectinload(Fact.citations)
            .selectinload(Citation.chunk)
            .selectinload(Chunk.document),
        )
        .where(Run.id == run_id)
    )
    if run is None:
        raise ApiError(Code.RUN_NOT_FOUND, "Run not found.", 404)
    return run


def create_run_rows(db: Session, pack_version_id: uuid.UUID, cases: list[s.RunCaseIn]) -> Run:
    """Create a pending Run with its cases and document links. Shared by POST /runs and
    the session-run route; the caller owns the background task that executes it."""
    pv = db.get(PackVersion, pack_version_id)
    if pv is None:
        raise ApiError(Code.PACK_VERSION_NOT_FOUND, "Pack version not found.", 404)

    run = Run(
        pack_version_id=pv.id,
        model_id=get_providers().llm.model_id,
        status="pending",
        stage=None,
    )
    db.add(run)
    db.commit()

    for cin in cases:
        case = Case(run_id=run.id, subject=cin.subject)
        db.add(case)
        db.flush()
        for document_id in cin.document_ids:
            doc = db.get(Document, document_id)
            if doc is None:
                raise ApiError(
                    Code.DOCUMENT_NOT_FOUND,
                    "One of the selected documents no longer exists.",
                    404,
                    {"document_id": str(document_id)},
                )
            db.add(RunDocument(run_id=run.id, case_id=case.id, document_id=doc.id, doc_type=None))

    db.commit()
    return run


# Plain `def`: every call below is synchronous DB I/O (CLAUDE.md §3.2).
@router.post("", response_model=s.RunOut, status_code=201)
def create_run(body: s.RunCreate, background: BackgroundTasks, db: DB) -> s.RunOut:
    run = create_run_rows(db, body.pack_version_id, body.cases)
    background.add_task(run_task, run.id)
    return serialize_run(run)


@router.get("/{run_id}", response_model=s.RunOut)
def get_run(run_id: uuid.UUID, db: DB) -> s.RunOut:
    run = load_run(db, run_id)
    return serialize_run(run)


@router.post("/{run_id}/corrections", response_model=s.CorrectionOut, status_code=201)
def append_correction(run_id: uuid.UUID, body: s.CorrectionCreate, db: DB) -> s.CorrectionOut:
    """Append a correction. It never mutates the fact — corrections are written, not applied."""
    run = db.get(Run, run_id)
    if run is None:
        raise ApiError(Code.RUN_NOT_FOUND, "Run not found.", 404)
    fact = db.get(Fact, body.fact_id)
    if fact is None or fact.run_id != run_id:
        raise ApiError(Code.FACT_NOT_FOUND, "That fact is not part of this run.", 404)
    corr = Correction(
        run_id=run_id, fact_id=body.fact_id, user_value=body.user_value, note=body.note
    )
    db.add(corr)
    db.commit()
    db.refresh(corr)
    return s.CorrectionOut(
        id=corr.id,
        run_id=corr.run_id,
        fact_id=corr.fact_id,
        user_value=corr.user_value,
        note=corr.note,
        created_at=corr.created_at,
    )


def run_task(run_id: uuid.UUID) -> None:
    """BackgroundTasks entry point — the client polls GET /runs/{id} while this runs."""
    try:
        execute_run(run_id)
    except Exception:
        from app.core.db import SessionLocal

        db = SessionLocal()
        try:
            run = db.get(Run, run_id)
            if run is not None:
                run.status = "failed"
                run.error = "background task crashed"
                db.commit()
        finally:
            db.close()
