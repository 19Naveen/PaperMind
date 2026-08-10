"""Workflow DAG executor: topological compile, condition-based skips, retry with
node-local rollback, the fabricated-quote invariant, and the full fact/report flow."""

from __future__ import annotations

from app.models import Case, Fact, Pack, PackVersion, Run, RunDocument, RunNodeAttempt
from app.services import workflow_runtime
from app.services.workflow_contract import (
    Condition,
    ConditionFactState,
    ConditionFactStateBody,
    Edge,
    Node,
    NodeKind,
    PortRef,
    RetryPolicy,
    WorkflowSpecV1,
    adapt_legacy,
)
from app.services.workflow_runtime import execute_workflow, prepare_workflow
from tests.util import ingest_text

DOC_TEXT = (
    "MASTER SERVICES AGREEMENT between Acme Data Systems and the Customer.\n"
    "LIABILITY. The aggregate liability of either party shall not exceed five hundred "
    "thousand dollars (USD 500,000) under this Agreement.\n"
    "SIGNED by the duly authorised representatives on this day, here in the City of "
    "Ankara, by the duly authorised representatives of both parties."
)

GENUINE_QUOTE = (
    "aggregate liability of either party shall not exceed five hundred thousand dollars"
)


def _make_run(db, spec: WorkflowSpecV1, document_ids: list, subject: str = "Acme Data Systems Ltd"):
    pack = Pack(name=spec.name)
    db.add(pack)
    db.flush()
    pv = PackVersion(pack_id=pack.id, version=1, spec=spec.model_dump(mode="json"))
    db.add(pv)
    db.flush()
    run = Run(pack_version_id=pv.id, model_id="fake:local", status="pending")
    db.add(run)
    db.flush()
    case = Case(run_id=run.id, subject=subject)
    db.add(case)
    db.flush()
    for document_id in document_ids:
        db.add(RunDocument(run_id=run.id, case_id=case.id, document_id=document_id))
    db.commit()
    db.refresh(run)
    return run


def _edge(source_node: str, source_port: str, target_node: str, target_port: str) -> Edge:
    return Edge(
        from_=PortRef(node_id=source_node, port=source_port),
        to=PortRef(node_id=target_node, port=target_port),
    )


def _classify_node() -> Node:
    return Node(
        id="classify",
        kind=NodeKind.classify_documents,
        config={"document_types": ["Vendor Contract"]},
    )


def _retrieve_node() -> Node:
    return Node(id="retrieve", kind=NodeKind.retrieve_evidence, config={})


def _extract_node() -> Node:
    return Node(
        id="extract",
        kind=NodeKind.extract_field,
        config={"field": "cap", "description": "Liability cap", "type": "currency"},
    )


def _extract_spec() -> WorkflowSpecV1:
    return WorkflowSpecV1(
        name="extract-only",
        document_types=["Vendor Contract"],
        nodes=[_classify_node(), _retrieve_node(), _extract_node()],
        edges=[
            _edge("classify", "classified_documents", "retrieve", "classified_documents"),
            _edge("retrieve", "evidence", "extract", "evidence"),
        ],
    )


def _retry_spec() -> WorkflowSpecV1:
    return WorkflowSpecV1(
        name="retry",
        document_types=["Vendor Contract"],
        nodes=[
            _classify_node(),
            _retrieve_node(),
            Node(
                id="extract",
                kind=NodeKind.extract_field,
                config={"field": "cap", "description": "Liability cap", "type": "currency"},
                retry=RetryPolicy(max_attempts=2, timeout_seconds=30),
            ),
        ],
        edges=[
            _edge("classify", "classified_documents", "retrieve", "classified_documents"),
            _edge("retrieve", "evidence", "extract", "evidence"),
        ],
    )


def _condition_spec() -> WorkflowSpecV1:
    return WorkflowSpecV1(
        name="condition-skip",
        document_types=["Vendor Contract"],
        nodes=[
            _classify_node(),
            _retrieve_node(),
            _extract_node(),
            Node(id="verify", kind=NodeKind.verify_field, config={"field": "cap"}),
        ],
        edges=[
            _edge("classify", "classified_documents", "retrieve", "classified_documents"),
            _edge("retrieve", "evidence", "extract", "evidence"),
            _edge("classify", "classified_documents", "verify", "evidence"),
            Edge(
                from_=PortRef(node_id="extract", port="candidate"),
                to=PortRef(node_id="verify", port="candidate"),
                when=Condition(
                    root=ConditionFactState(
                        fact_state_is=ConditionFactStateBody(
                            path="candidate.state", state="verified"
                        )
                    )
                ),
            ),
        ],
    )


def test_compile_orders_topologically():
    spec = adapt_legacy(
        "Vendor Due Diligence",
        ["Vendor Contract", "DPA"],
        [{"name": "cap", "description": "Liability cap", "type": "currency"}],
        [{"id": "r1", "description": "A signed DPA must be present"}],
    )
    plan = prepare_workflow(spec)
    plan2 = prepare_workflow(spec)
    assert plan.order == plan2.order
    assert plan.order[0] == "classify"
    assert plan.order[-1] == "report"
    position = {node_id: i for i, node_id in enumerate(plan.order)}
    for (to_node, _to_port), (from_node, _from_port) in plan.bindings.items():
        assert position[from_node] < position[to_node]


def test_condition_false_skips_node(db, providers):
    doc = ingest_text(db, "acme_msa.txt", [DOC_TEXT])
    providers.update(
        {
            "Document name:": {"doc_type": "Vendor Contract"},
            # Fabricated quote: extract yields state "unsupported", so the
            # fact_state_is "verified" edge condition into verify is false.
            "field: cap": {
                "found": True,
                "value": "USD 1",
                "quote": "This sentence is nowhere in the source",
            },
        }
    )
    spec = _condition_spec()
    run = _make_run(db, spec, [doc.id])
    outcome = execute_workflow(db, run, spec)
    assert outcome["status"] == "complete"

    attempts = (
        db.query(RunNodeAttempt)
        .filter(RunNodeAttempt.run_id == run.id)
        .order_by(RunNodeAttempt.node_id, RunNodeAttempt.attempt_no)
        .all()
    )
    verify_rows = [a for a in attempts if a.node_id == "verify"]
    assert len(verify_rows) == 1
    assert verify_rows[0].status == "skipped"
    assert verify_rows[0].branch_reason is not None
    # The verify handler must never have completed.
    assert not any(a.node_id == "verify" and a.status == "completed" for a in attempts)
    # extract still ran.
    assert any(a.node_id == "extract" and a.status == "completed" for a in attempts)


def test_retry_then_success(db, providers, monkeypatch):
    doc = ingest_text(db, "acme_msa.txt", [DOC_TEXT])
    providers.update(
        {
            "Document name:": {"doc_type": "Vendor Contract"},
            "field: cap": {"found": True, "value": "USD 500,000", "quote": GENUINE_QUOTE},
        }
    )
    spec = _retry_spec()
    run = _make_run(db, spec, [doc.id])

    original = workflow_runtime.NODE_HANDLERS[NodeKind.extract_field]
    calls = {"n": 0}

    def flaky(context, node):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient failure")
        return original(context, node)

    monkeypatch.setitem(workflow_runtime.NODE_HANDLERS, NodeKind.extract_field, flaky)
    outcome = execute_workflow(db, run, spec)

    assert outcome["status"] == "complete"
    assert calls["n"] == 2
    attempts = (
        db.query(RunNodeAttempt)
        .filter(RunNodeAttempt.run_id == run.id, RunNodeAttempt.node_id == "extract")
        .order_by(RunNodeAttempt.attempt_no)
        .all()
    )
    assert [a.status for a in attempts] == ["failed", "completed"]
    assert attempts[0].error_code == "NODE_ERROR"
    assert attempts[1].output_digest is not None
    # Exactly ONE fact despite two attempts — the failed attempt's rows rolled back.
    facts = db.query(Fact).filter(Fact.run_id == run.id, Fact.field == "cap").all()
    assert len(facts) == 1
    assert facts[0].state == "verified"


def test_fabricated_quote_stays_unsupported(db, providers):
    doc = ingest_text(db, "acme_msa.txt", [DOC_TEXT])
    providers.update(
        {
            "Document name:": {"doc_type": "Vendor Contract"},
            "field: cap": {
                "found": True,
                "value": "USD 1",
                "quote": "This sentence does not appear in the source document at all",
            },
        }
    )
    spec = _extract_spec()
    run = _make_run(db, spec, [doc.id])
    outcome = execute_workflow(db, run, spec)
    assert outcome["status"] == "complete"
    facts = db.query(Fact).filter(Fact.run_id == run.id).all()
    assert len(facts) == 1
    assert facts[0].field == "cap"
    assert facts[0].state == "unsupported"
    assert facts[0].citations == []


def test_execute_produces_facts_and_report(db, providers):
    doc = ingest_text(db, "acme_msa.txt", [DOC_TEXT])
    providers.update(
        {
            "Document name:": {"doc_type": "Vendor Contract"},
            "field: cap": {"found": True, "value": "USD 500,000", "quote": GENUINE_QUOTE},
        }
    )
    spec = adapt_legacy(
        "Vendor Due Diligence",
        ["Vendor Contract"],
        [
            {
                "name": "cap",
                "description": "Contractual cap on aggregate liability",
                "type": "currency",
            }
        ],
        [{"id": "cap_min", "description": "Liability cap must be at least $250,000"}],
    )
    run = _make_run(db, spec, [doc.id])
    outcome = execute_workflow(db, run, spec)
    assert outcome["status"] == "complete"

    facts = db.query(Fact).filter(Fact.run_id == run.id).all()
    by_field = {f.field: f for f in facts}
    assert by_field["cap"].state == "verified"
    assert len(by_field["cap"].citations) == 1
    # A verified rule result carries the satisfied fact's citation.
    assert by_field["rule:cap_min"].state == "verified"
    assert len(by_field["rule:cap_min"].citations) >= 1

    report = outcome["report"]
    assert report is not None
    assert "checklist" in report
    fields_in_report = {entry["field"] for entry in report["checklist"]}
    assert "cap" in fields_in_report
    assert "rule:cap_min" in fields_in_report
