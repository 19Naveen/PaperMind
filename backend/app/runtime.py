"""The runtime engine: six deterministic stages in fixed order.

No reasoning about business logic happens here — the Pack already decided. LLM calls use
temperature=0 and structured output only; verification is deterministic (string
containment against the source text, no LLM), which is what makes a fabricated "quote"
land as `unsupported` rather than `verified`.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import cast

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.llm import JSON_SCHEMA, get_providers
from app.models import Case, Chunk, Citation, Fact, Run, RunDocument
from app.retrieval import search
from app.schemas import PackSpec

STAGES = ("classify", "retrieve", "extract", "verify", "cross-validate", "report")

EXTRACT_SCHEMA: JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean"},
        "value": {"type": ["string", "null"]},
        "quote": {"type": ["string", "null"]},
    },
    "required": ["found", "value", "quote"],
}


def _classify_schema(document_types: list[str]) -> dict[str, object]:
    enum_values: list[str | None] = cast(
        list[str | None], document_types if document_types else [None]
    )
    return {
        "type": "object",
        "properties": {"doc_type": {"type": ["string", "null"], "enum": enum_values}},
        "required": ["doc_type"],
    }


# --- Entry point -------------------------------------------------------------
def execute_run(run_id: uuid.UUID) -> dict[str, object]:
    """Run the six stages in fixed order. One function call per stage; no alternate
    paths. Runs in a FastAPI BackgroundTask; the client polls GET /runs/{id}."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        run = db.get(Run, run_id)
        if run is None:
            return {"status": "failed", "error": "run not found"}
        spec = PackSpec.model_validate(run.pack_version.spec)
        run.status = "running"
        run.stage = "classify"
        db.commit()

        try:
            _classify(db, run, spec)
            for case in run.cases:
                extract_and_verify_case(db, run, case, spec)
            _cross_validate(db, run, spec)
            run.stage = "report"
            run.report = _report(db, run, spec)
            run.status = "complete"
            run.stage = None
        except Exception as exc:
            db.rollback()
            run.status = "failed"
            run.error = str(exc)
            run.stage = None
        finally:
            run.updated_at = datetime.now()
            db.commit()
        return {
            "status": run.status,
            "stage": run.stage,
            "error": run.error,
        }
    finally:
        db.close()


# --- Stage 1: classify -------------------------------------------------------
def _classify(db: Session, run: Run, spec: PackSpec) -> None:
    allowed = spec.document_types
    schema = _classify_schema(allowed)
    for case in run.cases:
        for rd in _case_documents(db, run.id, case.id):
            text = rd.document.text[:2000]
            try:
                result = get_providers().llm.structured(
                    schema,
                    system=(
                        "You classify a document into one of the declared types. "
                        f"Allowed types: {allowed or 'none'}. When no type clearly "
                        "fits, doc_type must be null — never a guess."
                    ),
                    user=f"Document name: {rd.document.name}\n\n{text}",
                    temperature=0.0,
                )
                dt = result.get("doc_type")
                rd.doc_type = dt if dt in allowed else None
            except Exception:
                rd.doc_type = None
        db.commit()
    _bump(db, run.id)


# --- Stages 2-4: retrieve / extract / verify ----------------------------------
def extract_and_verify_case(db: Session, run: Run, case: Case, spec: PackSpec) -> None:
    run.stage = "retrieve"
    db.commit()
    _bump(db, run.id)

    documents = _case_documents(db, run.id, case.id)
    doc_ids = [rd.document_id for rd in documents]

    run.stage = "extract"
    db.commit()

    for field in spec.fields:
        query = f"{field.name}: {field.description}"
        chunk_ids = search(db, query, doc_ids, k=3)
        chunks = (
            db.query(Chunk).filter(or_(*[Chunk.id == c for c in chunk_ids])).all()
            if chunk_ids
            else []
        )
        state, value, located = _extract_and_verify_field(db, chunks, field.name, field.description)

        run.stage = "verify"
        db.commit()

        fact = Fact(run_id=run.id, case_id=case.id, field=field.name, value=value, state=state)
        db.add(fact)
        db.flush()
        if located is not None:
            chunk, start, end = located
            db.add(
                Citation(
                    fact_id=fact.id,
                    chunk_id=chunk.id,
                    quote=chunk.text[start - chunk.char_start : end - chunk.char_start],
                    page=chunk.page,
                    char_start=start,
                    char_end=end,
                )
            )
        db.commit()
        _bump(db, run.id)


def _extract_and_verify_field(
    db: Session, chunks: list[Chunk], field_name: str, description: str
) -> tuple[str, str | None, tuple[Chunk, int, int] | None]:
    """One call per field, never one summarizing call per document."""
    if not chunks:
        return "missing", None, None

    context = "\n\n".join(f"[page {c.page}] {c.text}" for c in chunks)
    try:
        result = get_providers().llm.structured(
            EXTRACT_SCHEMA,
            system=(
                "You extract one field value from the document fragments below. Return "
                "found=true with a value AND a verbatim quote ONLY when the quote appears "
                "word-for-word in the fragments. If the source does not contain the field, "
                "found=false. Never invent a quote."
            ),
            user=f"field: {field_name}\ndescription: {description}\n\nfragments:\n{context}",
            temperature=0.0,
        )
    except Exception:
        return "unsupported", None, None

    if not result.get("found"):
        return "missing", None, None

    value = result.get("value")
    # The extraction schema forces value/quote to strings (or null); trust the edge.
    if not isinstance(value, str):
        return "unsupported", None, None
    raw_quote = result.get("quote")
    quote = raw_quote.strip() if isinstance(raw_quote, str) else ""
    if not quote:
        return "unsupported", None, None

    located = _locate_quote(chunks, quote)
    if located is None:
        # Plausible value, nothing in the source backs it: exactly the fabricated-quote
        # failure mode the plan names. Deterministic, no LLM involved.
        return "unsupported", value, None
    return "verified", value, located


def _locate_quote(chunks: list[Chunk], quote: str) -> tuple[Chunk, int, int] | None:
    """Find the quote verbatim in one of the chunks. Returns (chunk, char_start, char_end).

    Case- and whitespace-insensitive, nothing else. No fuzzy matching — that would let a
    fabricated quote pass verification.
    """
    norm_quote = _normalize(quote)
    if not norm_quote:
        return None
    for chunk in chunks:
        found = _normalized_find(chunk.text, norm_quote)
        if found is None:
            continue
        start, end = found
        return chunk, chunk.char_start + start, chunk.char_start + end
    return None


def _normalize(text: str) -> str:
    return re.sub(r"\s+", "", text).lower()


def _normalized_find(text: str, norm_query: str) -> tuple[int, int] | None:
    """Locate the normalized query in raw text, returning raw offsets (both bounds)."""
    # Index of each non-whitespace char in text, lowercased, with its raw position.
    pairs = [(i, ch.lower()) for i, ch in enumerate(text) if not ch.isspace()]
    window = len(norm_query)
    for n in range(len(pairs) - window + 1):
        candidate = "".join(ch for _, ch in pairs[n : n + window])
        if candidate == norm_query:
            return pairs[n][0], pairs[n + window - 1][0] + 1
    return None


# --- Stage 5: cross-validate --------------------------------------------------
def _cross_validate(db: Session, run: Run, spec: PackSpec) -> None:
    run.stage = "cross-validate"
    db.commit()
    _bump(db, run.id)

    for case in run.cases:
        facts = db.query(Fact).filter(Fact.run_id == run.id, Fact.case_id == case.id).all()
        by_field = {f.field: f for f in facts}
        doc_types = {
            rd.doc_type
            for rd in db.query(RunDocument).filter(RunDocument.case_id == case.id).all()
            if rd.doc_type
        }
        for rule in spec.rules:
            rule_dict = rule.model_dump()
            verdict = _evaluate_rule(rule_dict, by_field, doc_types)
            state = {
                "pass": "verified",
                "unsupported": "unsupported",
                "missing": "missing",
            }.get(verdict, "unsupported")
            rule_fact = Fact(
                run_id=run.id,
                case_id=case.id,
                field=f"rule:{rule.id}",
                value=verdict,
                state=state,
            )
            db.add(rule_fact)
            db.flush()
            if state == "verified":
                _attach_rule_evidence(db, case.id, rule_dict, by_field, rule_fact.id)
        db.commit()
    _bump(db, run.id)


def _attach_rule_evidence(
    db: Session,
    case_id: uuid.UUID,
    rule: dict[str, object],
    by_field: dict[str, Fact],
    fact_id: uuid.UUID,
) -> None:
    """A rule result, like a field result, has the 'no citation, no result' guarantee.
    A passing rule carries the citation of the field fact that satisfied it; a presence
    rule satisfied by a document carries that document's first chunk as evidence."""
    raw_description = rule.get("description")
    description = raw_description.lower() if isinstance(raw_description, str) else ""
    field_tokens = list(by_field)
    target = next((f for f in field_tokens if f.replace("_", " ") in description), None)

    if target is not None:
        src = by_field.get(target)
        if src is not None and src.citations:
            for c in src.citations:
                db.add(
                    Citation(
                        fact_id=fact_id,
                        chunk_id=c.chunk_id,
                        quote=c.quote,
                        page=c.page,
                        char_start=c.char_start,
                        char_end=c.char_end,
                    )
                )
            return

    matching = (
        db.query(RunDocument)
        .filter(
            RunDocument.case_id == case_id,
            RunDocument.doc_type.isnot(None),
        )
        .all()
    )
    for rd in matching:
        if rd.doc_type and rd.doc_type.lower() in description:
            chunk = (
                db.query(Chunk)
                .filter(Chunk.document_id == rd.document_id)
                .order_by(Chunk.page)
                .first()
            )
            if chunk is not None:
                db.add(
                    Citation(
                        fact_id=fact_id,
                        chunk_id=chunk.id,
                        quote=chunk.text[:200],
                        page=chunk.page,
                        char_start=chunk.char_start,
                        char_end=chunk.char_start + min(200, len(chunk.text)),
                    )
                )
            return


def _evaluate_rule(rule: dict[str, object], by_field: dict[str, Fact], doc_types: set[str]) -> str:
    """A deliberately small rule interpreter. Extend it when a real Pack needs a
    predicate shape this doesn't cover; the alternation here is the whole logic."""
    raw_description = rule.get("description")
    description = raw_description.lower() if isinstance(raw_description, str) else ""
    field_tokens = list(by_field)

    target = next((f for f in field_tokens if f.replace("_", " ") in description), None)

    # Presence rules: "a signed DPA must be present", "proof of address is required".
    if ("must" in description or "required" in description) and any(
        w in description for w in ("present", "provided", "included", "required")
    ):
        if target is not None:
            return by_field[target].state
        for dt in doc_types:
            if dt and dt.lower() in description:
                return "pass"
        return "missing"

    # Threshold rules: "liability cap must be at least $250,000".
    m = re.search(r"(at least|>=)\s*([$€£])?\s*([\d][\d,]*)", description)
    if m:
        threshold = float(m.group(3).replace(",", ""))
        fact = by_field.get(target) if target else None
        if fact is None or fact.value is None:
            return "missing"
        if fact.state != "verified":
            return fact.state
        numeric = re.sub(r"[^\d.]", "", fact.value)
        if not numeric:
            return "unsupported"
        return "pass" if float(numeric) >= threshold else "unsupported"

    # Unspecific rule: satisfied when the fields it touches are all verified.
    if target is not None:
        return by_field[target].state
    return "pass" if all(f.state == "verified" for f in by_field.values()) else "missing"


# --- Stage 6: report ----------------------------------------------------------
def _report(db: Session, run: Run, spec: PackSpec) -> dict[str, object]:
    facts = db.query(Fact).filter(Fact.run_id == run.id).all()
    counts = {"verified": 0, "unsupported": 0, "missing": 0}
    per_case: dict[str, dict[str, int]] = {}
    for f in facts:
        if f.field.startswith("rule:"):
            continue
        counts[f.state] = counts[f.state] + 1
        per_case.setdefault(str(f.case_id), {"verified": 0, "unsupported": 0, "missing": 0})[
            f.state
        ] += 1
    return {"facts": sum(counts.values()), "counts": counts, "per_case": per_case}


# --- helpers -----------------------------------------------------------------
def _bump(db: Session, run_id: uuid.UUID) -> None:
    run = db.get(Run, run_id)
    if run is not None:
        run.updated_at = datetime.now()
        db.commit()


def _case_documents(db: Session, run_id: uuid.UUID, case_id: uuid.UUID) -> list[RunDocument]:
    return (
        db.query(RunDocument)
        .filter(RunDocument.run_id == run_id, RunDocument.case_id == case_id)
        .order_by(RunDocument.document_id)
        .all()
    )


def preview_document(
    db: Session, spec: PackSpec, document_ids: list[uuid.UUID]
) -> list[dict[str, object]]:
    """Dry-run a *draft* spec against documents without writing a Run or an immutable
    version — the preview-before-approve gate (README principle 3). Returns a fact-list
    shape exactly like the run serialization, minus the DB rows."""
    chunks = (
        db.query(Chunk).filter(or_(*[Chunk.document_id == d for d in document_ids])).all()
        if document_ids
        else []
    )
    results: list[dict[str, object]] = []
    for field in spec.fields:
        query = f"{field.name}: {field.description}"
        ranked = search(db, query, document_ids, k=3)
        candidates = [c for c in chunks if c.id in ranked] or chunks[:3]
        state, value, located = _extract_and_verify_field(
            db, candidates, field.name, field.description
        )
        if located is None:
            results.append({"field": field.name, "value": value, "state": state, "citations": []})
            continue
        chunk, start, end = located
        quote = chunk.text[start - chunk.char_start : end - chunk.char_start]
        results.append(
            {
                "field": field.name,
                "value": value,
                "state": state,
                "citations": [
                    {
                        "chunk_id": str(chunk.id),
                        "quote": quote,
                        "document_id": str(chunk.document_id),
                        "document_name": chunk.document.name,
                        "page": chunk.page,
                        "char_start": start,
                        "char_end": end,
                    }
                ],
            }
        )
    return results
