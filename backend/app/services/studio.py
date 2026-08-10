"""Studio authoring engine: turns a user request into a validated WorkflowSpecV1 draft.

Sits between the persistence helpers (app.repositories.studio) and the future FastAPI
router. No FastAPI imports here. The engine is deterministic offline (heuristic_draft)
and structured-output LLM-driven online; either path ends in a persisted draft revision.
"""

from __future__ import annotations

import json
import uuid
from typing import cast

from sqlalchemy.orm import Session

from app.models import PackVersion, StudioSession
from app.repositories import studio as repos
from app.services.llm import get_providers
from app.services.workflow_contract import (
    DiffEntry,
    ValidationIssue,
    ValidationResult,
    WorkflowSpecV1,
    adapt_legacy,
    diff_workflows,
    digest,
    validate,
)

# Hand-written JSON schema for structured output. Deliberately not derived from
# model_json_schema: a hand-written, LLM-friendly schema is more robust than a
# discriminated-union dump for strict structured generation.
AUTHORING_SCHEMA: dict[str, object] = {
    "type": "object",
    "definitions": {
        "port_ref": {
            "type": "object",
            "properties": {
                "node_id": {"type": "string"},
                "port": {"type": "string"},
            },
            "required": ["node_id", "port"],
        }
    },
    "properties": {
        "schema_version": {"type": "integer", "const": 1},
        "name": {"type": "string"},
        "document_types": {"type": "array", "items": {"type": "string"}},
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "kind": {
                        "type": "string",
                        "enum": [
                            "classify_documents",
                            "retrieve_evidence",
                            "extract_field",
                            "verify_field",
                            "evaluate_rule",
                            "render_checklist",
                        ],
                    },
                    "config": {"type": "object"},
                    "retry": {
                        "type": "object",
                        "properties": {
                            "max_attempts": {"type": "integer", "minimum": 1, "maximum": 3},
                            "timeout_seconds": {"type": "integer", "minimum": 5, "maximum": 120},
                        },
                    },
                    "on_failure": {
                        "type": "string",
                        "enum": ["fail_run", "skip_node", "continue_with_null"],
                    },
                },
                "required": ["id", "kind"],
            },
        },
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "from": {"$ref": "#/definitions/port_ref"},
                    "to": {"$ref": "#/definitions/port_ref"},
                    "when": {"anyOf": [{"type": "object"}, {"type": "null"}]},
                },
                "required": ["from", "to"],
            },
        },
        "outputs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "node_id": {"type": "string"},
                    "port": {"type": "string"},
                    "contract": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "const": "checklist"},
                            "include_citations": {"type": "boolean"},
                        },
                        "required": ["kind"],
                    },
                },
                "required": ["name", "node_id", "port", "contract"],
            },
        },
        "integrations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "operation": {"type": "string"},
                },
                "required": ["name", "operation"],
            },
        },
    },
    "required": [
        "schema_version",
        "name",
        "document_types",
        "nodes",
        "edges",
        "outputs",
        "integrations",
    ],
}

AUTHORING_SYSTEM = (
    "You are a compliance Pack workflow authoring assistant. Given the user's request and "
    "the CURRENT workflow draft (if any), produce a COMPLETE updated WorkflowSpecV1 as "
    "strict JSON. Preserve nodes/edges that are still wanted; add/modify per the request. "
    "Return the whole spec, never a diff."
)


# ---------------------------------------------------------------------------
# Offline deterministic drafting
# ---------------------------------------------------------------------------

_INVOICE_FIELDS = [
    {"name": "invoice_number", "description": "Invoice reference number", "type": "string"},
    {"name": "amount", "description": "Total amount on the invoice", "type": "currency"},
    {"name": "vendor", "description": "Payee name", "type": "string"},
    {"name": "due_date", "description": "Payment due date", "type": "date"},
]
_INVOICE_RULES = [
    {"id": "amount_positive", "description": "Invoice amount must be positive"},
    {"id": "due_date_present", "description": "A due date must be present"},
]

_KYC_FIELDS = [
    {"name": "legal_name", "description": "Legal name of the entity", "type": "string"},
    {"name": "registration_number", "description": "Registration / ID number", "type": "string"},
    {"name": "address", "description": "Registered address", "type": "string"},
]
_KYC_RULES = [
    {"id": "identity_present", "description": "Legal name and registration number must be present"},
]

_CONTRACT_FIELDS = [
    {"name": "party", "description": "Contracting party", "type": "string"},
    {"name": "effective_date", "description": "Effective date of the agreement", "type": "date"},
    {"name": "governing_law", "description": "Governing law and jurisdiction", "type": "string"},
]
_CONTRACT_RULES = [
    {"id": "executed", "description": "The agreement must be signed and dated"},
]


def heuristic_draft(text: str, title: str) -> WorkflowSpecV1:
    """Offline deterministic fallback for fake/no-LLM setups. Always valid because it is
    built through the contract's adapt_legacy adapter."""
    low = text.lower()
    if "invoice" in low:
        document_types, fields, rules = ["Invoice"], _INVOICE_FIELDS, _INVOICE_RULES
    elif any(k in low for k in ("kyc", "onboard", "identity", "aml")):
        document_types, fields, rules = ["Customer Onboarding File"], _KYC_FIELDS, _KYC_RULES
    else:
        document_types, fields, rules = ["Contract"], _CONTRACT_FIELDS, _CONTRACT_RULES
    return adapt_legacy(name=title, document_types=document_types, fields=fields, rules=rules)


# ---------------------------------------------------------------------------
# Serialization of the contract's stdlib dataclass results
# ---------------------------------------------------------------------------


def _jsonify(value: object) -> object:
    """Serialize a contract result (stdlib dataclasses) to JSON-safe plain data."""
    if isinstance(value, list):
        return [_jsonify(v) for v in value]
    if isinstance(value, DiffEntry):
        return {"op": value.op, "path": value.path, "prev": value.prev, "next": value.next}
    if isinstance(value, ValidationResult):
        return {"ok": value.ok, "errors": _jsonify(value.errors)}
    if isinstance(value, ValidationIssue):
        return {"code": value.code, "path": value.path, "message": value.message}
    return value


# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------


def workflow_json(db: Session, session_id: uuid.UUID) -> WorkflowSpecV1 | None:
    """The current revision's canonical workflow, or None when there is no draft yet."""
    revision = repos.current_revision(db, session_id)
    if revision is None:
        return None
    return WorkflowSpecV1.model_validate(revision.workflow)


def session_summary(db: Session, session: StudioSession) -> dict[str, object]:
    """Hydrate a session for the router/UI: header fields, current revision, and turns."""
    revision = repos.current_revision(db, session.id)
    turns = repos.list_turns(db, session.id)
    return {
        "id": session.id,
        "title": session.title,
        "status": session.status,
        "pack_id": session.pack_id,
        "base_pack_version_id": session.base_pack_version_id,
        "current_revision": (
            {
                "revision_no": revision.revision_no,
                "digest": revision.digest,
                "validation": revision.validation,
                "diff": revision.diff,
                "workflow": revision.workflow,
            }
            if revision is not None
            else None
        ),
        "turns": [
            {
                "role": turn.role,
                "content": turn.content,
                "status": turn.status,
                "revision_id": turn.revision_id,
                "created_at": turn.created_at.isoformat(),
            }
            for turn in turns
        ],
    }


# ---------------------------------------------------------------------------
# Seeding from a frozen pack version
# ---------------------------------------------------------------------------


def seed_from_pack_version(
    db: Session,
    *,
    pack_id: uuid.UUID,
    base_pack_version_id: uuid.UUID,
    created_by_id: uuid.UUID | None = None,
    title: str | None = None,
) -> StudioSession:
    """Create a session seeded from a frozen PackVersion. The version's spec is the
    legacy {name, document_types, fields, rules} shape; adapt it to the canonical
    WorkflowSpecV1 as revision 1."""
    session = repos.create_session(
        db,
        title=title or "Edit pack",
        pack_id=pack_id,
        base_pack_version_id=base_pack_version_id,
        created_by_id=created_by_id,
    )
    pv = db.get(PackVersion, base_pack_version_id)
    if pv is None:
        return session
    spec = pv.spec
    name = str(spec.get("name") or "Edit pack")
    doc_types_raw = spec.get("document_types")
    document_types = [str(t) for t in doc_types_raw] if isinstance(doc_types_raw, list) else []
    fields_raw = spec.get("fields")
    fields = (
        [
            {
                "name": str(f.get("name")),
                "description": str(f.get("description")),
                "type": str(f.get("type")),
            }
            for f in fields_raw
            if isinstance(f, dict)
        ]
        if isinstance(fields_raw, list)
        else []
    )
    rules_raw = spec.get("rules")
    rules = (
        [
            {"id": str(r.get("id")), "description": str(r.get("description"))}
            for r in rules_raw
            if isinstance(r, dict)
        ]
        if isinstance(rules_raw, list)
        else []
    )
    wf = adapt_legacy(name=name, document_types=document_types, fields=fields, rules=rules)
    repos.create_revision(
        db,
        session_id=session.id,
        workflow=wf.model_dump(mode="json"),
        revision_no=1,
        parent_id=None,
        diff=[],
        validation=cast(dict[str, object], _jsonify(validate(wf))),
        digest=digest(wf),
        created_by_id=created_by_id,
    )
    return session


# ---------------------------------------------------------------------------
# The authoring turn
# ---------------------------------------------------------------------------


def commit_proposal(
    db: Session,
    session: StudioSession,
    proposal: WorkflowSpecV1,
    *,
    created_by_id: uuid.UUID | None = None,
) -> dict[str, object]:
    """Validate a proposal against the session's prior draft and, when valid, advance the
    session to a new revision. On an invalid proposal the prior draft is preserved and a
    failed assistant turn is recorded. Extracted from process_turn so tests can drive an
    arbitrary (in)valid spec directly."""
    current = repos.current_revision(db, session.id)
    prior_wf = workflow_json(db, session.id)
    validation = validate(proposal)
    diff = diff_workflows(prior_wf, proposal) if prior_wf is not None else []
    if not validation.ok:
        repos.create_turn(
            db,
            session_id=session.id,
            role="assistant",
            content="That draft could not be accepted — it fails workflow validation.",
            status="failed",
        )
        return {
            "ok": False,
            "error": "invalid",
            "validation": validation,
            "revision": None,
            "prior_revision": current,
        }
    next_no = current.revision_no + 1 if current else 1
    parent_id = current.id if current else None
    revision = repos.create_revision(
        db,
        session_id=session.id,
        workflow=proposal.model_dump(mode="json"),
        revision_no=next_no,
        parent_id=parent_id,
        diff=cast(list[dict[str, object]], _jsonify(diff)),
        validation=cast(dict[str, object], _jsonify(validation)),
        digest=digest(proposal),
        model_id=get_providers().llm.model_id,
        created_by_id=created_by_id,
    )
    repos.create_turn(
        db,
        session_id=session.id,
        role="assistant",
        content=f"Draft ready — {len(proposal.nodes)} nodes, {len(proposal.edges)} edges.",
        status="ok",
        revision_id=revision.id,
    )
    return {
        "ok": True,
        "revision": revision,
        "validation": validation,
        "diff": diff,
        "digest": digest(proposal),
    }


def process_turn(
    db: Session,
    session: StudioSession,
    user_text: str,
    *,
    created_by_id: uuid.UUID | None = None,
) -> dict[str, object]:
    """Process one authoring turn: draft a complete updated spec, validate it, and advance
    the session to a new revision when valid. Records assistant turns only — the router is
    responsible for persisting the user's message before calling this."""
    prior_wf = workflow_json(db, session.id)
    context_turns = repos.list_turns(db, session.id, limit=8)
    context = "\n".join(f"{t.role.upper()}: {t.content}" for t in context_turns)
    prompt_parts = []
    if prior_wf is not None:
        prompt_parts.append(
            "CURRENT WORKFLOW:\n" + json.dumps(prior_wf.model_dump(mode="json"), indent=2)
        )
    if context:
        prompt_parts.append("RECENT CONVERSATION:\n" + context)
    prompt_parts.append(f"USER: {user_text}")
    prompt = "\n\n".join(prompt_parts)

    llm = get_providers().llm
    try:
        if llm.model_id.startswith("fake:"):
            proposal = heuristic_draft(user_text, session.title)
        else:
            result = llm.structured(
                AUTHORING_SCHEMA, system=AUTHORING_SYSTEM, user=prompt, temperature=0
            )
            proposal = WorkflowSpecV1.model_validate(result)
    except Exception:
        repos.create_turn(
            db,
            session_id=session.id,
            role="assistant",
            content="I could not draft that.",
            status="failed",
        )
        return {"ok": False, "error": "draft_failed", "validation": None, "revision": None}

    return commit_proposal(db, session, proposal, created_by_id=created_by_id)
