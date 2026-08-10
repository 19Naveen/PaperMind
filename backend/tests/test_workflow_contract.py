"""Workflow contract tests: pure-domain validation, compile, adapt, diff, digest."""

from __future__ import annotations

import pytest

from app.services.workflow_contract import (
    CYCLE,
    DUPLICATE_NODE_ID,
    DUPLICATE_OUTPUT,
    INTEGRATION_UNAVAILABLE,
    INVALID_CONDITION,
    INVALID_CONFIG,
    INVALID_FAILURE_POLICY,
    INVALID_OUTPUT_CONTRACT,
    INVALID_RETRY_POLICY,
    MISSING_EVIDENCE,
    NULL_OUTPUT_NOT_CONSUMABLE,
    PORT_TYPE_MISMATCH,
    UNKNOWN_NODE_KIND,
    UNKNOWN_PORT,
    UNMET_REQUIRED_INPUT,
    CompiledWorkflow,
    Condition,
    ConditionEquals,
    ConditionEqualsBody,
    Edge,
    Integration,
    Node,
    NodeKind,
    OnFailure,
    Output,
    OutputContract,
    PortRef,
    RetryPolicy,
    ValidationError,
    WorkflowSpecV1,
    adapt_legacy,
    compile_workflow,
    diff_workflows,
    digest,
    validate,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _valid_spec() -> WorkflowSpecV1:
    return adapt_legacy(
        "Vendor Due Diligence",
        document_types=["Vendor Contract", "DPA"],
        fields=[
            {"name": "cap", "description": "Liability cap", "type": "currency"},
            {"name": "jurisdiction", "description": "Governing law", "type": "string"},
        ],
        rules=[{"id": "r1", "description": "A signed DPA must be present"}],
    )


def _codes(result) -> list[str]:
    return [e.code for e in result.errors]


def _edge(src_node: str, src_port: str, dst_node: str, dst_port: str) -> Edge:
    return Edge(
        from_=PortRef(node_id=src_node, port=src_port),
        to=PortRef(node_id=dst_node, port=dst_port),
    )


# These tests are pure domain logic: no DB, no providers. Override the autouse
# DB fixtures from conftest.py with module-local no-ops so this file runs without
# a live PostgreSQL.
@pytest.fixture(scope="session", autouse=True)
def _prepare_database() -> None:
    yield


@pytest.fixture(autouse=True)
def _clean_tables() -> None:
    yield


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_adapt_legacy_produces_valid_spec() -> None:
    spec = _valid_spec()
    result = validate(spec)
    assert result.ok, result.errors


def test_validate_accepts_adapted_spec() -> None:
    assert validate(_valid_spec()).ok


def test_compile_is_deterministic_and_topological() -> None:
    spec = _valid_spec()
    a = compile_workflow(spec)
    b = compile_workflow(spec)
    assert a.order
    assert a.order == b.order
    # classify has no inputs; it must come first.
    assert a.order[0] == "classify"
    # report is a pure sink; it must come last.
    assert a.order[-1] == "report"
    # Topological invariant: every from-node precedes its to-node.
    pos = {nid: i for i, nid in enumerate(a.order)}
    for (to_node, _to_port), (from_node, _from_port) in a.bindings.items():
        assert pos[from_node] < pos[to_node]


def test_compile_bindings_populated() -> None:
    spec = _valid_spec()
    compiled = compile_workflow(spec)
    # At minimum, the binding for the report's "report" output node's facts port
    # exists (one of many fact edges).
    assert any(key[0] == "report" for key in compiled.bindings)
    assert isinstance(compiled, CompiledWorkflow)


def test_digest_is_stable() -> None:
    spec = _valid_spec()
    d1 = digest(spec)
    d2 = digest(spec)
    assert d1 == d2
    assert len(d1) == 64


def test_diff_empty_vs_self() -> None:
    spec = _valid_spec()
    assert diff_workflows(spec, spec) == []


def test_diff_nonempty_on_change() -> None:
    parent = _valid_spec()
    child = _valid_spec()
    child.nodes[0].config["document_types"].append("NDA")
    diff = diff_workflows(parent, child)
    assert diff
    # document_types is a list (compared as a leaf); the change surfaces as
    # a replace at the classify node's config.
    assert any(d.op == "replace" for d in diff)
    assert any("document_types" in d.path for d in diff)


def test_diff_add_remove_node() -> None:
    parent = _valid_spec()
    child = _valid_spec()
    # Remove one node id from child to force a remove entry on the nodes map.
    child.nodes = [n for n in child.nodes if n.id != "rule-r1"]
    diff = diff_workflows(parent, child)
    assert any(d.op == "remove" and "rule-r1" in d.path for d in diff)


def test_compile_raises_on_invalid() -> None:
    spec = _valid_spec()
    spec.nodes[0].config = {}  # drop document_types -> INVALID_CONFIG
    with pytest.raises(ValidationError):
        compile_workflow(spec)


# ---------------------------------------------------------------------------
# Negative cases
# ---------------------------------------------------------------------------


def _clone(spec: WorkflowSpecV1) -> WorkflowSpecV1:
    return WorkflowSpecV1.model_validate(spec.model_dump(mode="json"))


def test_duplicate_node_id() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    # Force a duplicate id by renaming a later node to "classify".
    for n in spec.nodes:
        if n.id == "report":
            n.id = "classify"
    assert DUPLICATE_NODE_ID in _codes(validate(spec))


def test_unknown_node_kind() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    spec.nodes[0].kind = "bogus_kind"
    assert UNKNOWN_NODE_KIND in _codes(validate(spec))


def test_invalid_config_key() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    spec.nodes[0].config = {"document_types": ["X"], "rogue_key": 1}
    assert INVALID_CONFIG in _codes(validate(spec))


def test_invalid_config_missing_required() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    spec.nodes[0].config = {}  # classify requires document_types
    assert INVALID_CONFIG in _codes(validate(spec))


def test_unknown_port() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    # Rewire the first edge to a nonexistent port.
    spec.edges[0].to.port = "no_such_port"
    assert UNKNOWN_PORT in _codes(validate(spec))


def test_unknown_port_unknown_node() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    spec.edges[0].from_ = PortRef(node_id="ghost", port="classified_documents")
    assert UNKNOWN_PORT in _codes(validate(spec))


def test_port_type_mismatch() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    # candidate -> facts : "candidate" vs "facts" — incompatible.
    spec.edges.append(_edge("extract-cap", "candidate", "rule-r1", "facts"))
    assert PORT_TYPE_MISMATCH in _codes(validate(spec))


def test_unmet_required_input() -> None:
    # Build a minimal spec where a node's required input has no edge.
    nodes = [
        Node(id="c", kind=NodeKind.classify_documents.value, config={"document_types": ["A"]}),
        # extract_field needs an "evidence" input that is never wired.
        Node(
            id="e",
            kind=NodeKind.extract_field.value,
            config={"field": "f", "description": "d", "type": "string"},
        ),
    ]
    spec = WorkflowSpecV1(name="t", nodes=nodes, edges=[])
    assert UNMET_REQUIRED_INPUT in _codes(validate(spec))


def test_cycle() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    # Add a back-edge: report -> classify (creating a cycle through the graph).
    spec.edges.append(_edge("report", "report", "classify", "classified_documents"))
    assert CYCLE in _codes(validate(spec))


def test_duplicate_output() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    spec.outputs.append(spec.outputs[0].model_copy(deep=True))
    assert DUPLICATE_OUTPUT in _codes(validate(spec))


def test_non_checklist_output_contract() -> None:
    spec = _valid_spec()
    # OutputContract.kind is Literal["checklist"], so to test the code path we
    # construct via model_construct to bypass Literal validation.
    bad_contract = OutputContract.model_construct(kind="report", include_citations=True)
    spec = _clone(spec)
    spec.outputs = [
        Output(name="checklist", node_id="report", port="report", contract=bad_contract)
    ]
    assert INVALID_OUTPUT_CONTRACT in _codes(validate(spec))


def test_verify_field_without_evidence() -> None:
    # verify_field requires candidate + evidence. Provide candidate only.
    nodes = [
        Node(id="c", kind=NodeKind.classify_documents.value, config={"document_types": ["A"]}),
        Node(id="x", kind=NodeKind.extract_field.value,
             config={"field": "f", "description": "d", "type": "string"}),
        Node(id="v", kind=NodeKind.verify_field.value, config={"field": "f"}),
    ]
    edges = [
        _edge("c", "classified_documents", "x", "evidence"),
        _edge("x", "candidate", "v", "candidate"),
        # evidence input deliberately NOT wired.
    ]
    spec = WorkflowSpecV1(name="t", nodes=nodes, edges=edges)
    assert MISSING_EVIDENCE in _codes(validate(spec))


def test_invalid_retry_max_attempts() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    spec.nodes[0].retry = RetryPolicy(max_attempts=5, timeout_seconds=30)
    assert INVALID_RETRY_POLICY in _codes(validate(spec))


def test_invalid_retry_timeout() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    spec.nodes[0].retry = RetryPolicy(max_attempts=1, timeout_seconds=1)
    assert INVALID_RETRY_POLICY in _codes(validate(spec))


def test_continue_with_null_rejected() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    spec.nodes[0].on_failure = OnFailure.continue_with_null.value
    assert NULL_OUTPUT_NOT_CONSUMABLE in _codes(validate(spec))


def test_invalid_failure_policy() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    spec.nodes[0].on_failure = "explode"
    assert INVALID_FAILURE_POLICY in _codes(validate(spec))


def test_malformed_condition_unknown_key() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    # A well-formed Condition that references a port the source node ("classify",
    # whose only output is "classified_documents") does not own. validate() must
    # flag it via INVALID_CONDITION because the path prefix is not a source output.
    bad_when = Condition(
        root=ConditionEquals(equals=ConditionEqualsBody(path="evidence.flag", value=1))
    )
    spec.edges.append(
        Edge(
            from_=PortRef(node_id="classify", port="classified_documents"),
            to=PortRef(node_id="retrieve-cap", port="classified_documents"),
            when=bad_when,
        )
    )
    assert INVALID_CONDITION in _codes(validate(spec))


def test_condition_unknown_ast_key_rejected() -> None:
    # Pydantic rejects unknown AST keys at construction time.
    with pytest.raises(Exception):  # noqa: B017
        Condition.model_validate({"banana": []})


def test_integration_present_rejected() -> None:
    spec = _valid_spec()
    spec = _clone(spec)
    spec.integrations.append(Integration(name="slack", operation="post_message"))
    assert INTEGRATION_UNAVAILABLE in _codes(validate(spec))
