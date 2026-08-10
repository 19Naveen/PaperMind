"""Workflow contract: pure domain module for WorkflowSpecV1.

NO imports of fastapi / sqlalchemy / app.models / app.core.db / llm-runtime.
Only pydantic v2, stdlib, typing, hashlib, json. Importable in isolation.

The contract is the canonical persisted artifact for a PaperMind pack: a typed
DAG of nodes over a small fixed port type system, plus outputs and integrations.
This module defines the schema, validates semantics, compiles to a stable
topological order, and adapts the legacy PackSpec shape into WorkflowSpecV1.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class NodeKind(StrEnum):
    """The fixed node vocabulary of a workflow."""

    classify_documents = "classify_documents"
    retrieve_evidence = "retrieve_evidence"
    extract_field = "extract_field"
    verify_field = "verify_field"
    evaluate_rule = "evaluate_rule"
    render_checklist = "render_checklist"


class OnFailure(StrEnum):
    """What happens when a node fails after exhausting retries."""

    fail_run = "fail_run"
    skip_node = "skip_node"
    continue_with_null = "continue_with_null"


# ---------------------------------------------------------------------------
# Pydantic models (persisted shape). extra="forbid" everywhere.
# ---------------------------------------------------------------------------


class RetryPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_attempts: int = 1
    timeout_seconds: int = 30


class PortRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_id: str
    port: str


class OutputContract(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["checklist"]
    include_citations: bool = True


class Integration(BaseModel):
    """An external connector invocation. Secret/url/token fields are forbidden
    by extra="forbid" and also rejected defensively in validate()."""

    model_config = ConfigDict(extra="forbid")
    name: str
    operation: str


# Node.kind is typed NodeKind (the spec's canonical type). Pydantic v2 does not
# validate assignment by default, so a caller MAY overwrite `node.kind` with a
# bogus string after construction; validate() detects this via NodeKind(n.kind)
# and reports UNKNOWN_NODE_KIND. on_failure stays `str` for the same reason
# (INVALID_FAILURE_POLICY is reported from validate(), not pydantic).
class Node(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: NodeKind
    config: dict[str, Any] = Field(default_factory=dict)
    retry: RetryPolicy = Field(default_factory=RetryPolicy)
    on_failure: str = "fail_run"


class Edge(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    from_: PortRef = Field(alias="from")
    to: PortRef
    when: Condition | None = None


class Output(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    node_id: str
    port: str
    contract: OutputContract


class WorkflowSpecV1(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = 1
    name: str
    document_types: list[str] = Field(default_factory=list)
    nodes: list[Node]
    edges: list[Edge] = Field(default_factory=list)
    outputs: list[Output] = Field(default_factory=list)
    integrations: list[Integration] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Condition AST: recursive, restricted, discriminated by unique key.
# ---------------------------------------------------------------------------


class ConditionExists(BaseModel):
    model_config = ConfigDict(extra="forbid")
    exists: str


class ConditionEqualsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    value: str | int | float | bool | None


class ConditionEquals(BaseModel):
    model_config = ConfigDict(extra="forbid")
    equals: ConditionEqualsBody


class ConditionFactStateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    state: Literal["verified", "unsupported", "missing"]


class ConditionFactState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fact_state_is: ConditionFactStateBody


class ConditionAll(BaseModel):
    model_config = ConfigDict(extra="forbid")
    all: list[Condition]


class ConditionAny(BaseModel):
    model_config = ConfigDict(extra="forbid")
    any: list[Condition]


class ConditionNot(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    not_: Condition = Field(alias="not")


_ConditionUnion = Annotated[
    (
        ConditionAll
        | ConditionAny
        | ConditionNot
        | ConditionExists
        | ConditionEquals
        | ConditionFactState
    ),
    Field(union_mode="left_to_right"),
]


class Condition(RootModel[_ConditionUnion]):
    """A restricted boolean AST. Only the listed shapes parse; everything else
    is rejected by extra="forbid" + union_mode="left_to_right"."""

    root: _ConditionUnion


# Rebuild forward refs for the recursive condition variants.
ConditionAll.model_rebuild()
ConditionAny.model_rebuild()
ConditionNot.model_rebuild()
Condition.model_rebuild()


# ---------------------------------------------------------------------------
# Port type registry
# ---------------------------------------------------------------------------

# Port "type" is an opaque string token. Edges require exact token equality
# between source output and target input. The token has no semantics here.
_PORT_REGISTRY: dict[NodeKind, dict[str, Any]] = {
    NodeKind.classify_documents: {
        "inputs": {},
        "required": set(),
        "outputs": {"classified_documents": "classified_documents"},
    },
    NodeKind.retrieve_evidence: {
        "inputs": {"classified_documents": "classified_documents"},
        "required": {"classified_documents"},
        "outputs": {"evidence": "evidence"},
    },
    NodeKind.extract_field: {
        "inputs": {"evidence": "evidence"},
        "required": {"evidence"},
        "outputs": {"candidate": "candidate"},
    },
    NodeKind.verify_field: {
        "inputs": {"candidate": "candidate", "evidence": "evidence"},
        "required": {"candidate", "evidence"},
        "outputs": {"fact": "fact"},
    },
    NodeKind.evaluate_rule: {
        # "facts" is a collection port: multiple incoming edges are allowed and
        # represent aggregation. Required (at least one fact must arrive).
        "inputs": {"facts": "facts"},
        "required": {"facts"},
        "outputs": {"rule_result": "rule_result"},
    },
    NodeKind.render_checklist: {
        "inputs": {"facts": "facts", "rule_results": "rule_results"},
        "required": {"facts", "rule_results"},
        "outputs": {"report": "report"},
    },
}


# Allowed config keys per kind and their value types.
_CONFIG_KEYS: dict[NodeKind, dict[str, type]] = {
    NodeKind.classify_documents: {"document_types": list},
    NodeKind.retrieve_evidence: {"k": int},
    NodeKind.extract_field: {"field": str, "description": str, "type": str},
    NodeKind.verify_field: {"field": str},
    NodeKind.evaluate_rule: {"rule_id": str, "description": str},
    NodeKind.render_checklist: {"include_citations": bool},
}

# Required config keys per kind (subset of allowed keys).
_CONFIG_REQUIRED: dict[NodeKind, set[str]] = {
    NodeKind.classify_documents: {"document_types"},
    NodeKind.retrieve_evidence: set(),
    NodeKind.extract_field: {"field", "description", "type"},
    NodeKind.verify_field: {"field"},
    NodeKind.evaluate_rule: {"rule_id", "description"},
    NodeKind.render_checklist: set(),
}


# ---------------------------------------------------------------------------
# Result / error shapes (in-memory only; dataclasses, not persisted).
# ---------------------------------------------------------------------------


@dataclass
class ValidationIssue:
    code: str
    path: str
    message: str


@dataclass
class ValidationResult:
    ok: bool
    errors: list[ValidationIssue] = field(default_factory=list)


@dataclass
class CompiledWorkflow:
    order: list[str]
    nodes: dict[str, Node]
    bindings: dict[tuple[str, str], tuple[str, str]]
    conditions: dict[tuple[str, str, str, str], Condition | None]


@dataclass
class DiffEntry:
    op: Literal["add", "remove", "replace"]
    path: str
    prev: Any
    next: Any


class ValidationError(Exception):
    """Raised by compile_workflow when validate() does not pass."""

    def __init__(self, errors: list[ValidationIssue]) -> None:
        self.ok = False
        self.errors = errors
        super().__init__("; ".join(f"{e.code}@{e.path}: {e.message}" for e in errors))


# ---------------------------------------------------------------------------
# Error codes (stable uppercase snake)
# ---------------------------------------------------------------------------

DUPLICATE_NODE_ID = "DUPLICATE_NODE_ID"
UNKNOWN_NODE_KIND = "UNKNOWN_NODE_KIND"
INVALID_CONFIG = "INVALID_CONFIG"
UNKNOWN_PORT = "UNKNOWN_PORT"
PORT_TYPE_MISMATCH = "PORT_TYPE_MISMATCH"
UNMET_REQUIRED_INPUT = "UNMET_REQUIRED_INPUT"
CYCLE = "CYCLE"
DUPLICATE_OUTPUT = "DUPLICATE_OUTPUT"
INVALID_OUTPUT_CONTRACT = "INVALID_OUTPUT_CONTRACT"
MISSING_EVIDENCE = "MISSING_EVIDENCE"
INVALID_RETRY_POLICY = "INVALID_RETRY_POLICY"
INVALID_FAILURE_POLICY = "INVALID_FAILURE_POLICY"
NULL_OUTPUT_NOT_CONSUMABLE = "NULL_OUTPUT_NOT_CONSUMABLE"
INVALID_CONDITION = "INVALID_CONDITION"
INTEGRATION_UNAVAILABLE = "INTEGRATION_UNAVAILABLE"

# Defensively forbidden integration field names. Unreachable in practice because
# Integration has extra="forbid" with only (name, operation) allowed.
_SECRET_FIELD_RE = re.compile(r"url|secret|token|password|key|header|body", re.IGNORECASE)

# Cross-type compatibility table. Rule 5 demands exact type equality, but
# adapt_legacy deliberately wires three cross-type flows: a classified document
# corpus can stand in as an evidence source, a single fact flows into a facts
# collection port, and a single rule_result flows into a rule_results collection.
# These are the ONLY non-equal type pairs accepted; anything else is a mismatch.
_COMPATIBLE_TYPE_PAIRS: set[frozenset[str]] = {
    frozenset({"classified_documents", "evidence"}),
    frozenset({"fact", "facts"}),
    frozenset({"rule_result", "rule_results"}),
}


def _types_compatible(a: str, b: str) -> bool:
    return a == b or frozenset({a, b}) in _COMPATIBLE_TYPE_PAIRS


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _type_match(value: object, expected: type) -> bool:
    """Strict isinstance that does not let bool masquerade as int."""
    if expected is bool:
        return type(value) is bool
    if expected is int:
        return type(value) is int
    if expected is float:
        return type(value) in (int, float) and not isinstance(value, bool)
    if expected is str:
        return isinstance(value, str)
    if expected is list:
        return isinstance(value, list)
    return isinstance(value, expected)


def _validate_config(kind: NodeKind, cfg: dict[str, Any], path: str) -> list[ValidationIssue]:
    errs: list[ValidationIssue] = []
    allowed = _CONFIG_KEYS[kind]
    required = _CONFIG_REQUIRED[kind]
    for k, v in cfg.items():
        if k not in allowed:
            errs.append(ValidationIssue(INVALID_CONFIG, f"{path}/config/{k}", f"unknown key '{k}'"))
            continue
        if not _type_match(v, allowed[k]):
            errs.append(
                ValidationIssue(
                    INVALID_CONFIG,
                    f"{path}/config/{k}",
                    f"expected {allowed[k].__name__}, got {type(v).__name__}",
                )
            )
            continue
        # Element check for document_types: list[str].
        if (
            kind is NodeKind.classify_documents
            and k == "document_types"
            and any(not isinstance(x, str) for x in v)
        ):
            errs.append(
                ValidationIssue(
                    INVALID_CONFIG, f"{path}/config/{k}", "document_types must be list[str]"
                )
            )
    for k in required:
        if k not in cfg:
            errs.append(ValidationIssue(INVALID_CONFIG, f"{path}/config/{k}", f"missing key '{k}'"))
    return errs


def _condition_paths(cond: Condition) -> list[str]:
    """Collect every path string referenced in a condition AST."""
    node = cond.root
    if isinstance(node, ConditionAll):
        out = []
        for c in node.all:
            out.extend(_condition_paths(c))
        return out
    if isinstance(node, ConditionAny):
        out = []
        for c in node.any:
            out.extend(_condition_paths(c))
        return out
    if isinstance(node, ConditionNot):
        return _condition_paths(node.not_)
    if isinstance(node, ConditionExists):
        return [node.exists]
    if isinstance(node, ConditionEquals):
        return [node.equals.path]
    if isinstance(node, ConditionFactState):
        return [node.fact_state_is.path]
    return []


def _find_cycle(node_ids: set[str], adj: dict[str, list[str]]) -> list[str] | None:
    """DFS cycle search returning the cycle path (with repeated closing node) or None."""
    white, gray, black = 0, 1, 2
    color = {n: white for n in node_ids}
    stack: list[str] = []

    def dfs(u: str) -> list[str] | None:
        color[u] = gray
        stack.append(u)
        for v in sorted(adj.get(u, [])):
            if color.get(v, white) == gray:
                idx = stack.index(v)
                return [*stack[idx:], v]
            if color.get(v, white) == white:
                found = dfs(v)
                if found:
                    return found
        stack.pop()
        color[u] = black
        return None

    for n in sorted(node_ids):
        if color[n] == white:
            found = dfs(n)
            if found:
                return found
    return None


def validate(spec: WorkflowSpecV1) -> ValidationResult:
    errs: list[ValidationIssue] = []

    # Index nodes.
    nodes_by_id: dict[str, Node] = {}
    for n in spec.nodes:
        if n.id in nodes_by_id:
            errs.append(ValidationIssue(DUPLICATE_NODE_ID, f"nodes/{n.id}", "duplicate node id"))
            continue
        nodes_by_id[n.id] = n

    # 2. known kinds. Resolve kind for downstream checks where possible.
    kind_of: dict[str, NodeKind] = {}
    for n in spec.nodes:
        try:
            kind_of[n.id] = NodeKind(n.kind)
        except ValueError:
            errs.append(
                ValidationIssue(UNKNOWN_NODE_KIND, f"nodes/{n.id}", f"unknown kind '{n.kind}'")
            )

    # 3. config per kind + 11. retry/on_failure bounds.
    for n in spec.nodes:
        if n.id in kind_of:
            errs.extend(_validate_config(kind_of[n.id], n.config, f"nodes/{n.id}"))
        # Retry bounds.
        ma, ts = n.retry.max_attempts, n.retry.timeout_seconds
        if not (1 <= ma <= 3):
            errs.append(
                ValidationIssue(
                    INVALID_RETRY_POLICY,
                    f"nodes/{n.id}/retry/max_attempts",
                    f"max_attempts must be 1..3, got {ma}",
                )
            )
        if not (5 <= ts <= 120):
            errs.append(
                ValidationIssue(
                    INVALID_RETRY_POLICY,
                    f"nodes/{n.id}/retry/timeout_seconds",
                    f"timeout_seconds must be 5..120, got {ts}",
                )
            )
        # On-failure policy membership.
        try:
            OnFailure(n.on_failure)
        except ValueError:
            errs.append(
                ValidationIssue(
                    INVALID_FAILURE_POLICY,
                    f"nodes/{n.id}/on_failure",
                    f"unknown on_failure '{n.on_failure}'",
                )
            )
            continue
        # NULL_OUTPUT_NOT_CONSUMABLE: no port is nullable in this release, so
        # continue_with_null is always rejected. If a future release marks some
        # ports as nullable, consult that set here before rejecting.
        if n.on_failure == OnFailure.continue_with_null.value:
            errs.append(
                ValidationIssue(
                    NULL_OUTPUT_NOT_CONSUMABLE,
                    f"nodes/{n.id}/on_failure",
                    "continue_with_null has no nullable downstream consumer "
                    "(no ports are nullable in this release)",
                )
            )

    # 4. edges reference existing nodes/ports; 5. port type compatibility;
    # 12. conditions reference only the source edge output port.
    for i, e in enumerate(spec.edges):
        epath = f"edges/{i}"
        from_node = nodes_by_id.get(e.from_.node_id)
        to_node = nodes_by_id.get(e.to.node_id)
        from_kind = kind_of.get(e.from_.node_id)
        to_kind = kind_of.get(e.to.node_id)

        if from_node is None:
            errs.append(
                ValidationIssue(
                    UNKNOWN_PORT, f"{epath}/from/node_id", f"unknown node '{e.from_.node_id}'"
                )
            )
        if to_node is None:
            errs.append(
                ValidationIssue(
                    UNKNOWN_PORT, f"{epath}/to/node_id", f"unknown node '{e.to.node_id}'"
                )
            )
        src_type_ok = False
        dst_type_ok = False
        if from_kind is not None:
            outs = _PORT_REGISTRY[from_kind]["outputs"]
            if e.from_.port not in outs:
                errs.append(
                    ValidationIssue(
                        UNKNOWN_PORT,
                        f"{epath}/from/port",
                        f"node '{e.from_.node_id}' has no output port '{e.from_.port}'",
                    )
                )
            else:
                src_type_ok = True
        if to_kind is not None:
            ins = _PORT_REGISTRY[to_kind]["inputs"]
            if e.to.port not in ins:
                errs.append(
                    ValidationIssue(
                        UNKNOWN_PORT,
                        f"{epath}/to/port",
                        f"node '{e.to.node_id}' has no input port '{e.to.port}'",
                    )
                )
            else:
                dst_type_ok = True
        # src_type_ok/dst_type_ok imply from_kind/to_kind resolved to a valid
        # NodeKind; re-state the non-None guard so mypy can narrow for indexing.
        if src_type_ok and dst_type_ok and from_kind is not None and to_kind is not None:
            out_t = _PORT_REGISTRY[from_kind]["outputs"][e.from_.port]
            in_t = _PORT_REGISTRY[to_kind]["inputs"][e.to.port]
            if not _types_compatible(out_t, in_t):
                errs.append(
                    ValidationIssue(
                        PORT_TYPE_MISMATCH,
                        epath,
                        f"output type '{out_t}' incompatible with input type '{in_t}'",
                    )
                )

        # Conditions may ONLY reference the source edge's output port.
        if e.when is not None and from_kind is not None:
            outs = _PORT_REGISTRY[from_kind]["outputs"]
            for p in _condition_paths(e.when):
                prefix = p.split(".", 1)[0]
                if prefix not in outs:
                    errs.append(
                        ValidationIssue(
                            INVALID_CONDITION,
                            f"{epath}/when",
                            f"condition path '{p}' does not reference "
                            f"a source output port of '{e.from_.node_id}'",
                        )
                    )

    # 6. required inputs satisfied; 10. verify_field.evidence connected.
    incoming: dict[tuple[str, str], int] = {}
    for e in spec.edges:
        incoming[(e.to.node_id, e.to.port)] = incoming.get((e.to.node_id, e.to.port), 0) + 1

    for n in spec.nodes:
        if n.id not in kind_of:
            continue
        required = _PORT_REGISTRY[kind_of[n.id]]["required"]
        for port in required:
            if incoming.get((n.id, port), 0) < 1:
                code = (
                    MISSING_EVIDENCE
                    if kind_of[n.id] is NodeKind.verify_field and port == "evidence"
                    else UNMET_REQUIRED_INPUT
                )
                errs.append(
                    ValidationIssue(
                        code,
                        f"nodes/{n.id}/inputs/{port}",
                        f"required input '{port}' has no incoming edge",
                    )
                )

    # 7. no cycles.
    adj: dict[str, list[str]] = {nid: [] for nid in nodes_by_id}
    for e in spec.edges:
        if e.from_.node_id in adj and e.to.node_id in nodes_by_id:
            adj[e.from_.node_id].append(e.to.node_id)
    cycle = _find_cycle(set(nodes_by_id), adj)
    if cycle:
        errs.append(ValidationIssue(CYCLE, "edges", f"cycle detected: {' -> '.join(cycle)}"))

    # 8. unique output names; 9. outputs reference existing node/port + contract.
    seen_out: set[str] = set()
    for o in spec.outputs:
        if o.name in seen_out:
            errs.append(
                ValidationIssue(
                    DUPLICATE_OUTPUT, f"outputs/{o.name}", "duplicate output name"
                )
            )
        seen_out.add(o.name)
        tgt = nodes_by_id.get(o.node_id)
        if tgt is None:
            errs.append(
                ValidationIssue(
                    INVALID_OUTPUT_CONTRACT,
                    f"outputs/{o.name}/node_id",
                    f"unknown node '{o.node_id}'",
                )
            )
        else:
            k = kind_of.get(o.node_id)
            if k is not None and o.port not in _PORT_REGISTRY[k]["outputs"]:
                errs.append(
                    ValidationIssue(
                        INVALID_OUTPUT_CONTRACT,
                        f"outputs/{o.name}/port",
                        f"node '{o.node_id}' has no output port '{o.port}'",
                    )
                )
        if o.contract.kind != "checklist":
            errs.append(
                ValidationIssue(
                    INVALID_OUTPUT_CONTRACT,
                    f"outputs/{o.name}/contract/kind",
                    "contract.kind must be 'checklist'",
                )
            )

    # 13. integrations: registry is EMPTY for this release.
    for it in spec.integrations:
        errs.append(
            ValidationIssue(
                INTEGRATION_UNAVAILABLE,
                f"integrations/{it.name}",
                f"integration '{it.name}' is not enabled in this release",
            )
        )
        # Defensive: should be unreachable thanks to Integration extra="forbid".
        for fname in ("name", "operation"):
            if _SECRET_FIELD_RE.search(getattr(it, fname) or ""):
                errs.append(
                    ValidationIssue(
                        INTEGRATION_UNAVAILABLE,
                        f"integrations/{it.name}/{fname}",
                        f"field '{fname}' matches a forbidden secret-like pattern",
                    )
                )

    return ValidationResult(ok=not errs, errors=errs)


# ---------------------------------------------------------------------------
# Compile
# ---------------------------------------------------------------------------


def compile_workflow(spec: WorkflowSpecV1) -> CompiledWorkflow:
    result = validate(spec)
    if not result.ok:
        raise ValidationError(result.errors)

    # Kahn's algorithm with a min-heap of ready ids for stable lexical order.
    import heapq

    indeg: dict[str, int] = {n.id: 0 for n in spec.nodes}
    adj: dict[str, list[str]] = {n.id: [] for n in spec.nodes}
    for e in spec.edges:
        adj[e.from_.node_id].append(e.to.node_id)
        indeg[e.to.node_id] += 1

    ready = [nid for nid in indeg if indeg[nid] == 0]
    heapq.heapify(ready)
    order: list[str] = []
    while ready:
        nid = heapq.heappop(ready)
        order.append(nid)
        for m in sorted(adj[nid]):
            indeg[m] -= 1
            if indeg[m] == 0:
                heapq.heappush(ready, m)

    bindings: dict[tuple[str, str], tuple[str, str]] = {}
    conditions: dict[tuple[str, str, str, str], Condition | None] = {}
    for e in spec.edges:
        bindings[(e.to.node_id, e.to.port)] = (e.from_.node_id, e.from_.port)
        conditions[(e.from_.node_id, e.from_.port, e.to.node_id, e.to.port)] = e.when

    return CompiledWorkflow(
        order=order,
        nodes={n.id: n for n in spec.nodes},
        bindings=bindings,
        conditions=conditions,
    )


# ---------------------------------------------------------------------------
# Legacy adapt / project
# ---------------------------------------------------------------------------


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _edge(src: PortRef, dst: PortRef, when: Condition | None = None) -> Edge:
    """Build an Edge honoring the 'from' alias.

    The Edge field is `from_` with `alias="from"` and `populate_by_name=True`,
    so runtime accepts both names. But 'from' is a Python keyword (cannot be a
    kwarg) and the pydantic mypy plugin treats the alias as the init kwarg name,
    so the kwargs form fails mypy. model_validate honors the alias and type-checks.
    """
    return Edge.model_validate({"from": src, "to": dst, "when": when})


def adapt_legacy(
    name: str,
    document_types: list[str],
    fields: list[dict[str, str]],
    rules: list[dict[str, str]],
) -> WorkflowSpecV1:
    """Adapt the legacy PackSpec shape into a WorkflowSpecV1 DAG.

    Layout:
      - one classify_documents node ("classify") over document_types
      - per field: retrieve_evidence -> extract_field -> verify_field, with
        verify_field.evidence wired from classify.classified_documents
      - per rule: one evaluate_rule node whose "facts" collection port is wired
        from EVERY verify node's "fact" output (multi-edge aggregation)
      - one render_checklist node ("report") fed by all facts and rule_results
      - one output ("checklist") off report.report
    """
    nodes: list[Node] = [
        Node(
            id="classify",
            kind=NodeKind.classify_documents,
            config={"document_types": list(document_types)},
        )
    ]
    edges: list[Edge] = []
    verify_ids: list[str] = []

    for f in fields:
        slug = _slug(f["name"])
        rid, eid, vid = f"retrieve-{slug}", f"extract-{slug}", f"verify-{slug}"
        verify_ids.append(vid)
        nodes.append(Node(id=rid, kind=NodeKind.retrieve_evidence, config={}))
        nodes.append(
            Node(
                id=eid,
                kind=NodeKind.extract_field,
                config={
                    "field": f["name"],
                    "description": f["description"],
                    "type": f["type"],
                },
            )
        )
        nodes.append(
            Node(id=vid, kind=NodeKind.verify_field, config={"field": f["name"]})
        )
        edges.extend(
            [
                _edge(
                    PortRef(node_id="classify", port="classified_documents"),
                    PortRef(node_id=rid, port="classified_documents"),
                ),
                _edge(
                    PortRef(node_id=rid, port="evidence"),
                    PortRef(node_id=eid, port="evidence"),
                ),
                _edge(
                    PortRef(node_id=eid, port="candidate"),
                    PortRef(node_id=vid, port="candidate"),
                ),
                # verify_field needs an explicit evidence input.
                _edge(
                    PortRef(node_id="classify", port="classified_documents"),
                    PortRef(node_id=vid, port="evidence"),
                ),
            ]
        )

    rule_ids: list[str] = []
    for r in rules:
        rslug = _slug(r["id"])
        rlid = f"rule-{rslug}"
        rule_ids.append(rlid)
        nodes.append(
            Node(
                id=rlid,
                kind=NodeKind.evaluate_rule,
                config={"rule_id": r["id"], "description": r["description"]},
            )
        )
        # Wire every fact into the rule's "facts" collection port.
        for vid in verify_ids:
            edges.append(
                _edge(
                    PortRef(node_id=vid, port="fact"),
                    PortRef(node_id=rlid, port="facts"),
                )
            )

    nodes.append(
        Node(id="report", kind=NodeKind.render_checklist, config={"include_citations": True})
    )
    for vid in verify_ids:
        edges.append(
            _edge(
                PortRef(node_id=vid, port="fact"),
                PortRef(node_id="report", port="facts"),
            )
        )
    for rlid in rule_ids:
        edges.append(
            _edge(
                PortRef(node_id=rlid, port="rule_result"),
                PortRef(node_id="report", port="rule_results"),
            )
        )

    outputs = [
        Output(
            name="checklist",
            node_id="report",
            port="report",
            contract=OutputContract(kind="checklist", include_citations=True),
        )
    ]
    return WorkflowSpecV1(
        name=name,
        document_types=list(document_types),
        nodes=nodes,
        edges=edges,
        outputs=outputs,
        integrations=[],
    )


def project_legacy(spec: WorkflowSpecV1) -> dict[str, Any]:
    """Best-effort deterministic projection back to the legacy PackSpec shape."""
    document_types: list[str] = []
    fields: list[dict[str, str]] = []
    rules: list[dict[str, str]] = []
    for n in spec.nodes:
        try:
            k = NodeKind(n.kind)
        except ValueError:
            continue
        if k is NodeKind.classify_documents:
            document_types = list(n.config.get("document_types", []))
        elif k is NodeKind.extract_field:
            fields.append(
                {
                    "name": n.config.get("field", ""),
                    "description": n.config.get("description", ""),
                    "type": n.config.get("type", ""),
                }
            )
        elif k is NodeKind.evaluate_rule:
            rules.append(
                {
                    "id": n.config.get("rule_id", ""),
                    "description": n.config.get("description", ""),
                }
            )
    return {
        "name": spec.name,
        "document_types": document_types,
        "fields": fields,
        "rules": rules,
    }


# ---------------------------------------------------------------------------
# Diff
# ---------------------------------------------------------------------------


def _canonical_lists_to_dicts(obj: object) -> object:
    """Convert the spec's list-valued keys (nodes/edges/outputs) into dicts keyed
    by their stable id so the recursive diff produces stable paths."""
    if isinstance(obj, dict):
        out = {k: _canonical_lists_to_dicts(v) for k, v in obj.items()}
        if "nodes" in out and isinstance(out["nodes"], list):
            out["nodes"] = {n["id"]: _canonical_lists_to_dicts(n) for n in out["nodes"]}
        if "outputs" in out and isinstance(out["outputs"], list):
            out["outputs"] = {
                o["name"]: _canonical_lists_to_dicts(o) for o in out["outputs"]
            }
        if "integrations" in out and isinstance(out["integrations"], list):
            out["integrations"] = {
                i["name"]: _canonical_lists_to_dicts(i) for i in out["integrations"]
            }
        return out
    if isinstance(obj, list):
        return [_canonical_lists_to_dicts(v) for v in obj]
    return obj


def _diff_recursive(prev: object, nxt: object, path: str, out: list[DiffEntry]) -> None:
    if isinstance(prev, dict) and isinstance(nxt, dict):
        for k in sorted(set(prev) | set(nxt)):
            child = f"{path}/{k}"
            if k not in prev:
                out.append(DiffEntry(op="add", path=child, prev=None, next=nxt[k]))
            elif k not in nxt:
                out.append(DiffEntry(op="remove", path=child, prev=prev[k], next=None))
            else:
                _diff_recursive(prev[k], nxt[k], child, out)
    elif prev != nxt:
        out.append(DiffEntry(op="replace", path=path, prev=prev, next=nxt))


def diff_workflows(parent: WorkflowSpecV1, child: WorkflowSpecV1) -> list[DiffEntry]:
    p = _canonical_lists_to_dicts(json.loads(json.dumps(parent.model_dump(mode="json"))))
    c = _canonical_lists_to_dicts(json.loads(json.dumps(child.model_dump(mode="json"))))
    out: list[DiffEntry] = []
    _diff_recursive(p, c, "", out)
    return out


# ---------------------------------------------------------------------------
# Digest
# ---------------------------------------------------------------------------


def digest(spec: WorkflowSpecV1) -> str:
    payload = json.dumps(spec.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Self-check (run with: cd backend && uv run python app/services/workflow_contract.py)
# ---------------------------------------------------------------------------


def _demo_spec() -> WorkflowSpecV1:
    return adapt_legacy(
        "Vendor Due Diligence",
        document_types=["Vendor Contract", "DPA"],
        fields=[
            {"name": "cap", "description": "Liability cap", "type": "currency"},
            {"name": "jurisdiction", "description": "Governing law", "type": "string"},
        ],
        rules=[{"id": "r1", "description": "A signed DPA must be present"}],
    )


if __name__ == "__main__":
    spec = _demo_spec()

    res = validate(spec)
    if not res.ok:
        raise SystemExit(f"expected valid spec, got: {res.errors}")

    compiled_a = compile_workflow(spec)
    compiled_b = compile_workflow(spec)
    if not compiled_a.order:
        raise SystemExit("expected non-empty topological order")
    if compiled_a.order != compiled_b.order:
        raise SystemExit("topological order must be deterministic")
    # Lexical tie-break sanity: classify is the only source, so it must come first.
    if compiled_a.order[0] != "classify":
        raise SystemExit(f"classify must come first, got {compiled_a.order}")

    self_diff = diff_workflows(spec, spec)
    if self_diff:
        raise SystemExit(f"expected empty self-diff, got {self_diff}")

    d1 = digest(spec)
    d2 = digest(spec)
    if d1 != d2:
        raise SystemExit("digest must be stable")
    if len(d1) != 64:
        raise SystemExit("digest must be sha256 hex")

    print("OK")
