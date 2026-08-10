"""DAG executor over WorkflowSpecV1: topological node execution with retries,
edge conditions, and per-node attempt telemetry (run_node_attempts).

Reuses the deterministic evidence primitives from app.services.runtime — no
business logic is reimplemented here. Handlers write Facts/Citations with the
same verified -> citation invariant the six-stage engine enforces; a failed
attempt's partial rows are rolled back on a savepoint before a retry.
"""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Case, Chunk, Citation, Document, Fact, Run, RunDocument, RunNodeAttempt
from app.repositories import runs as runs_repo
from app.services.llm import get_providers
from app.services.retrieval import search
from app.services.runtime import (
    _attach_rule_evidence,
    _classify_schema,
    _evaluate_rule,
    _extract_and_verify_field,
    _locate_quote,
)
from app.services.workflow_contract import (
    CompiledWorkflow,
    Condition,
    ConditionAll,
    ConditionAny,
    ConditionEquals,
    ConditionExists,
    ConditionFactState,
    ConditionNot,
    Node,
    NodeKind,
    OnFailure,
    WorkflowSpecV1,
    adapt_legacy,
    compile_workflow,
    validate,
)


class WorkflowRunError(Exception):
    """Raised when a node fails and on_failure=fail_run (or the policy is unknown)."""


def prepare_workflow(spec: WorkflowSpecV1 | dict[str, Any]) -> CompiledWorkflow:
    """Validate (adapting a legacy PackSpec dict first) and compile the DAG."""
    if isinstance(spec, dict):
        if "nodes" in spec:
            normalized: WorkflowSpecV1 = WorkflowSpecV1.model_validate(spec)
        else:
            normalized = adapt_legacy(
                name=str(spec.get("name", "untitled")),
                document_types=[str(t) for t in spec.get("document_types", [])],
                fields=[dict(f) for f in spec.get("fields", [])],
                rules=[dict(r) for r in spec.get("rules", [])],
            )
    else:
        normalized = spec
    result = validate(normalized)
    if not result.ok:
        first = result.errors[0]
        raise ValueError(f"{first.code}@{first.path}: {first.message}")
    return compile_workflow(normalized)


@dataclass
class ExecutionContext:
    """Per-(run, case) state for one DAG execution."""

    db: Session
    run: Run
    case: Case
    plan: CompiledWorkflow
    record_attempt: Callable[..., None]
    output_store: dict[tuple[str, str], Any] = field(default_factory=dict)
    chunks_cache: dict[uuid.UUID, Chunk] = field(default_factory=dict)

    def input_value(self, node: Node, port: str) -> object:
        binding = self.plan.bindings.get((node.id, port))
        if binding is None:
            return None
        from_node, from_port = binding
        return self.output_store.get((from_node, from_port))

    def input_collection(self, node: Node, port: str) -> list[Any]:
        # Collection ports aggregate multiple edges; enumerate the full edge index
        # because the bindings dict only keeps the last edge per (to_node, to_port).
        return [
            self.output_store[(from_node, from_port)]
            for (from_node, from_port, to_node, to_port) in self.plan.conditions
            if (
                to_node == node.id
                and to_port == port
                and (from_node, from_port) in self.output_store
            )
        ]


def _case_documents(db: Session, run_id: uuid.UUID, case_id: uuid.UUID) -> list[RunDocument]:
    return (
        db.query(RunDocument)
        .filter(RunDocument.run_id == run_id, RunDocument.case_id == case_id)
        .order_by(RunDocument.document_id)
        .all()
    )


def _load_chunks(context: ExecutionContext, chunk_ids: list[uuid.UUID]) -> list[Chunk]:
    if not chunk_ids:
        return []
    missing = [cid for cid in chunk_ids if cid not in context.chunks_cache]
    if missing:
        rows = context.db.query(Chunk).filter(or_(*[Chunk.id == cid for cid in missing])).all()
        for chunk in rows:
            context.chunks_cache[chunk.id] = chunk
    return [context.chunks_cache[cid] for cid in chunk_ids if cid in context.chunks_cache]


def _as_chunks(context: ExecutionContext, evidence: list[Any]) -> list[Chunk]:
    """Evidence arrives as Chunks (from retrieve) or as RunDocuments (classify's
    classified_documents output, which the contract lets stand in for evidence)."""
    if not evidence:
        return []
    if isinstance(evidence[0], Chunk):
        return [c for c in evidence if isinstance(c, Chunk)]
    doc_ids = [rd.document_id for rd in evidence if isinstance(rd, RunDocument)]
    if not doc_ids:
        return []
    return (
        context.db.query(Chunk)
        .filter(or_(*[Chunk.document_id == d for d in doc_ids]))
        .all()
    )


# --- Node handlers -----------------------------------------------------------


def _handle_classify(context: ExecutionContext, node: Node) -> dict[str, Any]:
    allowed = node.config["document_types"]
    schema = _classify_schema(allowed)
    classified: list[RunDocument] = []
    for rd in _case_documents(context.db, context.run.id, context.case.id):
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
            doc_type = result.get("doc_type")
            rd.doc_type = doc_type if isinstance(doc_type, str) and doc_type in allowed else None
        except Exception:
            rd.doc_type = None
        classified.append(rd)
    context.db.flush()
    return {"classified_documents": classified}


def _handle_retrieve(context: ExecutionContext, node: Node) -> dict[str, Any]:
    classified = context.input_value(node, "classified_documents")
    if not isinstance(classified, list):
        raise WorkflowRunError(
            f"node '{node.id}': expected classified_documents list, "
            f"got {type(classified).__name__}"
        )
    doc_ids = [rd.document_id for rd in classified if isinstance(rd, RunDocument)]
    cfg = node.config
    query = ""
    if isinstance(cfg.get("field"), str) and isinstance(cfg.get("description"), str):
        query = f"{cfg['field']}: {cfg['description']}"
    query = query or context.case.subject or "evidence"
    chunk_ids = search(context.db, query, doc_ids, k=int(cfg.get("k", 3)))
    return {"evidence": _load_chunks(context, chunk_ids)}


def _handle_extract(context: ExecutionContext, node: Node) -> dict[str, Any]:
    evidence = context.input_value(node, "evidence")
    if not isinstance(evidence, list):
        raise WorkflowRunError(
            f"node '{node.id}': expected evidence list, got {type(evidence).__name__}"
        )
    field = node.config["field"]
    description = node.config["description"]
    typ = node.config["type"]
    state, value, located = _extract_and_verify_field(
        context.db, _as_chunks(context, evidence), field, description
    )
    candidate: dict[str, Any] = {
        "field": field,
        "description": description,
        "type": typ,
        "value": value,
        "state": state,
        "quote": None,
    }
    fact = Fact(
        run_id=context.run.id,
        case_id=context.case.id,
        field=field,
        value=value,
        state=state,
    )
    context.db.add(fact)
    context.db.flush()
    if located is not None:
        chunk, start, end = located
        quote = chunk.text[start - chunk.char_start : end - chunk.char_start]
        candidate["quote"] = quote
        context.db.add(
            Citation(
                fact_id=fact.id,
                chunk_id=chunk.id,
                quote=quote,
                page=chunk.page,
                char_start=start,
                char_end=end,
            )
        )
    return {"candidate": candidate}


def _handle_verify(context: ExecutionContext, node: Node) -> dict[str, Any]:
    candidate = context.input_value(node, "candidate")
    evidence = context.input_value(node, "evidence")
    if not isinstance(candidate, dict) or not isinstance(evidence, list):
        raise WorkflowRunError(
            f"node '{node.id}': verify requires a candidate dict and an evidence list"
        )
    field = node.config["field"]
    state = candidate.get("state", "unsupported")
    value = candidate.get("value")
    quote = candidate.get("quote")
    located = None
    if quote and state == "verified":
        located = _locate_quote(_as_chunks(context, evidence), quote)
        if located is None:
            state = "unsupported"
    fact = _fact_for_field(context, field)
    if fact is None:
        fact = Fact(
            run_id=context.run.id,
            case_id=context.case.id,
            field=field,
            value=value,
            state=state,
        )
        context.db.add(fact)
        context.db.flush()
    else:
        fact.value = value
        fact.state = state
        context.db.flush()
    if state == "verified" and located is not None and not fact.citations:
        chunk, start, end = located
        context.db.add(
            Citation(
                fact_id=fact.id,
                chunk_id=chunk.id,
                quote=chunk.text[start - chunk.char_start : end - chunk.char_start],
                page=chunk.page,
                char_start=start,
                char_end=end,
            )
        )
    return {"fact": fact}


def _fact_for_field(context: ExecutionContext, field: str) -> Fact | None:
    return (
        context.db.query(Fact)
        .filter(
            Fact.run_id == context.run.id,
            Fact.case_id == context.case.id,
            Fact.field == field,
        )
        .order_by(Fact.created_at)
        .first()
    )


def _handle_rule(context: ExecutionContext, node: Node) -> dict[str, Any]:
    rule_id = node.config["rule_id"]
    description = node.config["description"]
    by_field: dict[str, Fact] = {}
    for fact in context.input_collection(node, "facts"):
        if isinstance(fact, Fact):
            by_field[fact.field] = fact
    doc_types = {
        rd.doc_type
        for rd in _case_documents(context.db, context.run.id, context.case.id)
        if rd.doc_type
    }
    verdict = _evaluate_rule({"id": rule_id, "description": description}, by_field, doc_types)
    state = {"pass": "verified", "unsupported": "unsupported", "missing": "missing"}.get(
        verdict, "unsupported"
    )
    fact = Fact(
        run_id=context.run.id,
        case_id=context.case.id,
        field=f"rule:{rule_id}",
        value=verdict,
        state=state,
    )
    context.db.add(fact)
    context.db.flush()
    if state == "verified":
        _attach_rule_evidence(
            context.db,
            context.case.id,
            {"id": rule_id, "description": description},
            by_field,
            fact.id,
        )
    return {"rule_result": verdict}


def _handle_render(context: ExecutionContext, node: Node) -> dict[str, Any]:
    include_citations = bool(node.config.get("include_citations", True))
    facts = (
        context.db.query(Fact)
        .filter(Fact.run_id == context.run.id, Fact.case_id == context.case.id)
        .order_by(Fact.field)
        .all()
    )
    checklist: list[dict[str, Any]] = []
    for fact in facts:
        citations: list[dict[str, Any]] = []
        if include_citations:
            citations = [
                {
                    "chunk_id": str(citation.chunk_id),
                    "quote": citation.quote,
                    "page": citation.page,
                    "char_start": citation.char_start,
                    "char_end": citation.char_end,
                }
                for citation in fact.citations
            ]
        checklist.append(
            {"field": fact.field, "value": fact.value, "state": fact.state, "citations": citations}
        )
    counts: dict[str, int] = {"verified": 0, "unsupported": 0, "missing": 0}
    for fact in facts:
        if not fact.field.startswith("rule:"):
            counts[fact.state] += 1
    return {"report": {"checklist": checklist, "counts": counts}}


NODE_HANDLERS: dict[NodeKind, Callable[[ExecutionContext, Node], dict[str, Any]]] = {
    NodeKind.classify_documents: _handle_classify,
    NodeKind.retrieve_evidence: _handle_retrieve,
    NodeKind.extract_field: _handle_extract,
    NodeKind.verify_field: _handle_verify,
    NodeKind.evaluate_rule: _handle_rule,
    NodeKind.render_checklist: _handle_render,
}


# --- Condition evaluation -----------------------------------------------------


def _path_value(value: object, path: str) -> object:
    # The contract guarantees the path starts with the source output port name;
    # we already hold that port's value, so the leading segment is redundant.
    current: object = value
    for part in path.split(".")[1:]:
        if isinstance(current, dict):
            if part not in current:
                return None
            current = current[part]
        elif isinstance(current, (list, tuple)):
            if part.isdigit() and int(part) < len(current):
                current = current[int(part)]
            else:
                return None
        else:
            current = getattr(current, part, None)
        if current is None:
            return None
    return current


def eval_condition(cond: Condition, source_value: object) -> bool:
    node = cond.root
    if isinstance(node, ConditionAll):
        return all(eval_condition(child, source_value) for child in node.all)
    if isinstance(node, ConditionAny):
        return any(eval_condition(child, source_value) for child in node.any)
    if isinstance(node, ConditionNot):
        return not eval_condition(node.not_, source_value)
    if isinstance(node, ConditionExists):
        return bool(_path_value(source_value, node.exists))
    if isinstance(node, ConditionEquals):
        return _path_value(source_value, node.equals.path) == node.equals.value
    if isinstance(node, ConditionFactState):
        return _path_value(source_value, node.fact_state_is.path) == node.fact_state_is.state
    return False


# --- Execution loop -----------------------------------------------------------


def _missing_input(context: ExecutionContext, node_id: str) -> tuple[str, str] | None:
    by_port: dict[str, list[tuple[str, str]]] = {}
    for from_node, from_port, to_node, to_port in context.plan.conditions:
        if to_node == node_id:
            by_port.setdefault(to_port, []).append((from_node, from_port))
    for sources in by_port.values():
        if not any((fn, fp) in context.output_store for (fn, fp) in sources):
            return sources[0]
    return None


def _conditions_pass(context: ExecutionContext, node_id: str) -> bool:
    for (from_node, from_port, to_node, _to_port), condition in context.plan.conditions.items():
        if to_node == node_id and condition is not None:
            source = context.output_store.get((from_node, from_port))
            if source is None:
                return False
            if not eval_condition(condition, source):
                return False
    return True


def _record_skip(context: ExecutionContext, node: Node, branch_reason: str) -> None:
    attempt = runs_repo.start_attempt(
        context.db, run_id=context.run.id, node_id=node.id, attempt_no=1
    )
    context.record_attempt(attempt.id, status="skipped", branch_reason=branch_reason)


def _apply_failure(
    context: ExecutionContext,
    node: Node,
    attempt: RunNodeAttempt,
    message: str,
    error_code: str,
) -> None:
    policy = OnFailure(node.on_failure)
    if policy is OnFailure.fail_run:
        raise WorkflowRunError(message)
    if policy is OnFailure.skip_node:
        context.record_attempt(
            attempt.id,
            status="skipped",
            branch_reason=f"on_failure=skip_node after {attempt.attempt_no} attempt(s)",
            error_code=error_code,
            error_message=message,
        )
        return
    # continue_with_null is rejected by the contract for this release; failing the
    # run is the only safe behavior for an unknown policy.
    raise WorkflowRunError(message)


def _run_node(context: ExecutionContext, node: Node) -> None:
    handler = NODE_HANDLERS.get(NodeKind(node.kind))
    if handler is None:
        raise WorkflowRunError(f"no handler registered for node kind '{node.kind}'")
    start = time.monotonic()
    for attempt_no in range(1, node.retry.max_attempts + 1):
        if time.monotonic() - start > node.retry.timeout_seconds:
            attempt = runs_repo.start_attempt(
                context.db, run_id=context.run.id, node_id=node.id, attempt_no=attempt_no
            )
            context.record_attempt(
                attempt.id,
                status="timed_out",
                error_code="NODE_TIMEOUT",
                error_message=f"node exceeded timeout of {node.retry.timeout_seconds}s",
            )
            _apply_failure(
                context,
                node,
                attempt,
                f"node '{node.id}' exceeded timeout of {node.retry.timeout_seconds}s",
                "NODE_TIMEOUT",
            )
            return
        attempt = runs_repo.start_attempt(
            context.db, run_id=context.run.id, node_id=node.id, attempt_no=attempt_no
        )
        try:
            with context.db.begin_nested():
                outputs = handler(context, node)
        except Exception as exc:
            context.record_attempt(
                attempt.id,
                status="failed",
                error_code="NODE_ERROR",
                error_message=_sanitize(str(exc)),
            )
            if attempt_no >= node.retry.max_attempts:
                _apply_failure(
                    context,
                    node,
                    attempt,
                    f"node '{node.id}' failed: {_sanitize(str(exc))}",
                    "NODE_ERROR",
                )
                return
            continue
        context.record_attempt(
            attempt.id,
            status="completed",
            output_digest=_output_digest(outputs),
        )
        for port, value in outputs.items():
            context.output_store[(node.id, port)] = value
        return


def _execute_case(db: Session, run: Run, case: Case, plan: CompiledWorkflow) -> ExecutionContext:
    def record(
        attempt_id: uuid.UUID,
        *,
        status: str,
        error_code: str | None = None,
        error_message: str | None = None,
        output_digest: str | None = None,
        branch_reason: str | None = None,
    ) -> None:
        runs_repo.finish_attempt(
            db,
            attempt_id,
            status=status,
            error_code=error_code,
            error_message=error_message,
            output_digest=output_digest,
            branch_reason=branch_reason,
        )

    context = ExecutionContext(db=db, run=run, case=case, plan=plan, record_attempt=record)
    for node_id in plan.order:
        node = plan.nodes[node_id]
        missing = _missing_input(context, node_id)
        if missing is not None:
            _record_skip(
                context,
                node,
                f"upstream output {missing[0]}.{missing[1]} was skipped",
            )
            continue
        if not _conditions_pass(context, node_id):
            _record_skip(context, node, f"edge condition into '{node_id}' was false")
            continue
        _run_node(context, node)
    return context


def execute_workflow(
    db: Session, run: Run, spec: WorkflowSpecV1 | dict[str, Any]
) -> dict[str, Any]:
    plan = prepare_workflow(spec)
    run.status = "running"
    db.commit()
    reports: list[dict[str, Any]] = []
    try:
        for case in run.cases:
            context = _execute_case(db, run, case, plan)
            for node_id in plan.order:
                node = plan.nodes[node_id]
                if NodeKind(node.kind) is NodeKind.render_checklist:
                    report = context.output_store.get((node_id, "report"))
                    if isinstance(report, dict):
                        reports.append(report)
        run.status = "complete"
        run.report = reports[0] if reports else None
        db.commit()
    except Exception as exc:
        db.rollback()
        run.status = "failed"
        run.error = str(exc)
        db.commit()
    return {"status": run.status, "stage": run.stage, "error": run.error, "report": run.report}


def sanitize_error(exc: Exception | str) -> str:
    """Clean an error message for storage/display: printable chars only, capped length."""
    return _sanitize(str(exc))


def execute_workflow_preview(
    db: Session,
    spec: WorkflowSpecV1 | dict[str, Any],
    *,
    case_subject: str,
    document_ids: list[uuid.UUID],
) -> dict[str, Any]:
    """Dry-run the DAG for a draft spec against documents, writing nothing.

    Mirrors the node handlers in-memory: no Run/Fact/Citation/RunNodeAttempt rows are
    created, so the Studio test pane can iterate on a draft without freezing a version.
    Returns per-node outcome dicts, a fact list, and the render report.
    """
    plan = prepare_workflow(spec)
    output: dict[tuple[str, str], Any] = {}
    facts: list[dict[str, Any]] = []
    doc_types: set[str] = set()

    def input_value(node_id: str, port: str) -> object:
        binding = plan.bindings.get((node_id, port))
        if binding is None:
            return None
        return output.get(binding)

    def input_collection(node_id: str, port: str) -> list[Any]:
        return [
            output[(from_node, from_port)]
            for (from_node, from_port, to_node, to_port) in plan.conditions
            if (to_node == node_id and to_port == port and (from_node, from_port) in output)
        ]

    def missing_input(node_id: str) -> tuple[str, str] | None:
        by_port: dict[str, list[tuple[str, str]]] = {}
        for from_node, from_port, to_node, to_port in plan.conditions:
            if to_node == node_id:
                by_port.setdefault(to_port, []).append((from_node, from_port))
        for sources in by_port.values():
            if not any((fn, fp) in output for (fn, fp) in sources):
                return sources[0]
        return None

    def conditions_pass(node_id: str) -> bool:
        for (from_node, from_port, to_node, _to_port), condition in plan.conditions.items():
            if to_node == node_id and condition is not None:
                source = output.get((from_node, from_port))
                if source is None or not eval_condition(condition, source):
                    return False
        return True

    def upsert_fact(fact: dict[str, Any]) -> None:
        for i, existing in enumerate(facts):
            if existing["field"] == fact["field"]:
                facts[i] = fact
                return
        facts.append(fact)

    def citation_dicts(chunk: Chunk, start: int, end: int) -> dict[str, Any]:
        return {
            "chunk_id": str(chunk.id),
            "document_id": str(chunk.document_id),
            "quote": chunk.text[start - chunk.char_start : end - chunk.char_start],
            "page": chunk.page,
            "char_start": start,
            "char_end": end,
        }

    def evidence_chunks(evidence: list[Any]) -> list[Chunk]:
        """Classified documents may stand in for evidence (the legacy contract allows
        it); resolve any document dicts to their chunks, like the real `_as_chunks`."""
        chunks = [c for c in evidence if isinstance(c, Chunk)]
        doc_ids = [c["document_id"] for c in evidence if isinstance(c, dict)]
        if doc_ids:
            chunks += db.query(Chunk).filter(Chunk.document_id.in_(doc_ids)).all()
        return chunks

    for node_id in plan.order:
        node = plan.nodes[node_id]
        kind = NodeKind(node.kind)
        missing = missing_input(node_id)
        if missing is not None:
            output[(node_id, "_skip")] = f"upstream output {missing[0]}.{missing[1]} was skipped"
            continue
        if not conditions_pass(node_id):
            output[(node_id, "_skip")] = f"edge condition into '{node_id}' was false"
            continue

        if kind is NodeKind.classify_documents:
            allowed = node.config["document_types"]
            schema = _classify_schema(allowed)
            classified: list[dict[str, Any]] = []
            for document_id in document_ids:
                doc = db.get(Document, document_id)
                if doc is None:
                    continue
                try:
                    result = get_providers().llm.structured(
                        schema,
                        system=(
                            "You classify a document into one of the declared types. "
                            f"Allowed types: {allowed or 'none'}. When no type clearly "
                            "fits, doc_type must be null — never a guess."
                        ),
                        user=f"Document name: {doc.name}\n\n{doc.text[:2000]}",
                        temperature=0.0,
                    )
                    doc_type = result.get("doc_type")
                except Exception:
                    doc_type = None
                doc_type = doc_type if isinstance(doc_type, str) and doc_type in allowed else None
                if doc_type:
                    doc_types.add(doc_type)
                classified.append({"document_id": doc.id, "name": doc.name, "doc_type": doc_type})
            output[(node_id, "classified_documents")] = classified

        elif kind is NodeKind.retrieve_evidence:
            classified_docs = input_value(node_id, "classified_documents")
            if not isinstance(classified_docs, list):
                output[(node_id, "_skip")] = "retrieve requires classified_documents"
                continue
            doc_ids = [c["document_id"] for c in classified_docs if isinstance(c, dict)]
            cfg = node.config
            query = ""
            if isinstance(cfg.get("field"), str) and isinstance(cfg.get("description"), str):
                query = f"{cfg['field']}: {cfg['description']}"
            query = query or case_subject or "evidence"
            chunk_ids = search(db, query, doc_ids, k=int(cfg.get("k", 3)))
            chunks = db.query(Chunk).filter(Chunk.id.in_(chunk_ids)).all() if chunk_ids else []
            output[(node_id, "evidence")] = chunks

        elif kind is NodeKind.extract_field:
            evidence = input_value(node_id, "evidence")
            if not isinstance(evidence, list):
                output[(node_id, "_skip")] = "extract requires evidence"
                continue
            field = node.config["field"]
            description = node.config["description"]
            typ = node.config["type"]
            state, value, located = _extract_and_verify_field(
                db, evidence_chunks(evidence), field, description
            )
            candidate: dict[str, Any] = {
                "field": field,
                "description": description,
                "type": typ,
                "value": value,
                "state": state,
                "quote": None,
            }
            citations: list[dict[str, Any]] = []
            if located is not None:
                chunk, start, end = located
                candidate["quote"] = chunk.text[start - chunk.char_start : end - chunk.char_start]
                citations = [citation_dicts(chunk, start, end)]
            output[(node_id, "candidate")] = candidate
            upsert_fact({"field": field, "value": value, "state": state, "citations": citations})

        elif kind is NodeKind.verify_field:
            candidate_dict = input_value(node_id, "candidate")
            evidence = input_value(node_id, "evidence")
            if not isinstance(candidate_dict, dict) or not isinstance(evidence, list):
                output[(node_id, "_skip")] = "verify requires candidate and evidence"
                continue
            field = node.config["field"]
            state = candidate_dict.get("state", "unsupported")
            value = candidate_dict.get("value")
            quote = candidate_dict.get("quote")
            located = None
            if quote and state == "verified":
                located = _locate_quote(evidence_chunks(evidence), quote)
                if located is None:
                    state = "unsupported"
            citations = (
                [citation_dicts(*located)] if state == "verified" and located is not None else []
            )
            fact = {"field": field, "value": value, "state": state, "citations": citations}
            upsert_fact(fact)
            output[(node_id, "fact")] = fact

        elif kind is NodeKind.evaluate_rule:
            rule_id = node.config["rule_id"]
            description = node.config["description"]
            by_field: dict[str, Fact] = {}
            for f in input_collection(node_id, "facts"):
                if isinstance(f, dict):
                    by_field[f["field"]] = Fact(
                        run_id=uuid.uuid4(),
                        case_id=uuid.uuid4(),
                        field=f["field"],
                        value=f.get("value"),
                        state=f.get("state", "unsupported"),
                    )
            verdict = _evaluate_rule(
                {"id": rule_id, "description": description}, by_field, doc_types
            )
            state = {"pass": "verified", "unsupported": "unsupported", "missing": "missing"}.get(
                verdict, "unsupported"
            )
            citations = []
            if state == "verified":
                target = next(
                    (name for name in by_field if name.replace("_", " ") in description.lower()),
                    None,
                )
                source = next((f for f in facts if f["field"] == target), None) if target else None
                if source and source["citations"]:
                    citations = list(source["citations"])
            upsert_fact(
                {
                    "field": f"rule:{rule_id}",
                    "value": verdict,
                    "state": state,
                    "citations": citations,
                }
            )
            output[(node_id, "rule_result")] = verdict

        elif kind is NodeKind.render_checklist:
            include_citations = bool(node.config.get("include_citations", True))
            checklist = [
                {
                    "field": f["field"],
                    "value": f["value"],
                    "state": f["state"],
                    "citations": f["citations"] if include_citations else [],
                }
                for f in facts
            ]
            counts = {"verified": 0, "unsupported": 0, "missing": 0}
            for f in facts:
                if not f["field"].startswith("rule:"):
                    counts[f["state"]] += 1
            output[(node_id, "report")] = {"checklist": checklist, "counts": counts}

    report: dict[str, Any] | None = None
    for node_id in plan.order:
        if NodeKind(plan.nodes[node_id].kind) is NodeKind.render_checklist:
            candidate_report = output.get((node_id, "report"))
            if isinstance(candidate_report, dict):
                report = candidate_report
                break

    nodes: dict[str, object] = {}
    for node_id in plan.order:
        outputs = {
            port: _preview_summary(value)
            for (nid, port), value in output.items()
            if nid == node_id and not port.startswith("_")
        }
        skip_reason = output.get((node_id, "_skip"))
        if outputs:
            nodes[node_id] = outputs
        elif skip_reason is not None:
            nodes[node_id] = {"skipped": True, "branch_reason": skip_reason}
        else:
            nodes[node_id] = {}

    return {"status": "complete", "facts": facts, "report": report, "nodes": nodes}


# --- small helpers ------------------------------------------------------------


def _output_digest(outputs: dict[str, Any]) -> str:
    payload = json.dumps(_jsonable(outputs), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _jsonable(obj: object) -> object:
    if isinstance(obj, dict):
        return {str(key): _jsonable(value) for key, value in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(value) for value in obj]
    if isinstance(obj, uuid.UUID):
        return str(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, (Fact, Chunk, RunDocument, RunNodeAttempt)):
        return str(obj.id)
    return obj


def _preview_summary(value: object) -> object:
    """JSON-friendly summary of a node output for the preview pane (no ORM objects)."""
    if isinstance(value, list):
        if value and isinstance(value[0], Chunk):
            return [
                {
                    "chunk_id": str(chunk.id),
                    "document_id": str(chunk.document_id),
                    "page": chunk.page,
                    "char_start": chunk.char_start,
                    "char_end": chunk.char_end,
                    "text": chunk.text,
                }
                for chunk in value
            ]
        return [_preview_summary(v) for v in value]
    if isinstance(value, dict):
        return {str(key): _preview_summary(val) for key, val in value.items()}
    if isinstance(value, (uuid.UUID, datetime)):
        return str(value)
    return value


def _sanitize(message: str, limit: int = 500) -> str:
    cleaned = "".join(ch for ch in message if ch.isprintable() or ch in "\n\t")
    return cleaned[:limit]
