"""Wiring the DAG executor into the real run path.

These tests exercise the integration: a legacy PackVersion spec runs through the API
(background task -> execute_run -> workflow_runtime.execute_workflow), node-attempt
telemetry is exposed over GET /runs/{id}/attempts, and the dry-run preview writes
nothing.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers.auth import router as auth_router
from app.api.routers.packs import router as packs_router
from app.api.routers.runs import router as runs_router
from app.api.routers.workspaces import router as workspaces_router
from app.core.errors import install_error_handlers
from app.models import Citation, Fact, Run, RunNodeAttempt
from app.services.workflow_runtime import execute_workflow_preview
from tests.util import ingest_text

DOC_TEXT = (
    "MASTER SERVICES AGREEMENT between Acme Data Systems and the Customer.\n"
    "LIABILITY. The aggregate liability of either party shall not exceed five hundred "
    "thousand dollars (USD 500,000) under this Agreement.\n"
)
GENUINE_QUOTE = (
    "aggregate liability of either party shall not exceed five hundred thousand dollars"
)

LEGACY_SPEC = {
    "name": "Wiring Pack",
    "document_types": ["Vendor Contract"],
    "fields": [
        {"name": "cap", "description": "Contractual cap on aggregate liability", "type": "currency"}
    ],
    "rules": [{"id": "cap_min", "description": "Liability cap must be at least $250,000"}],
}


@pytest.fixture
def app_client() -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(workspaces_router)
    app.include_router(packs_router)
    app.include_router(runs_router)
    install_error_handlers(app)
    with TestClient(app) as c:
        yield c


def signup(client: TestClient) -> None:
    r = client.post(
        "/auth/signup",
        json={"email": "a@example.com", "name": "Example", "password": "hunter2hunter2"},
    )
    assert r.status_code == 201, r.text


def make_workspace(client: TestClient) -> dict[str, object]:
    r = client.post("/workspaces", json={"name": "W", "goal": "review"})
    assert r.status_code == 201, r.text
    return r.json()


def make_pack_with_spec(client: TestClient, spec: dict[str, object]) -> dict[str, object]:
    pack = client.post("/packs", json={"name": spec["name"]})
    assert pack.status_code == 201, pack.text
    # Direct spec submission is governance-rejected; freeze a Studio draft instead.
    from app.core.db import SessionLocal
    from tests.util import make_draft_session

    db = SessionLocal()
    try:
        sid = str(make_draft_session(db, spec, title="Wiring draft"))
    finally:
        db.close()
    v = client.post(f"/packs/{pack.json()['id']}/versions", json={"draft_session_id": sid})
    assert v.status_code == 201, v.text
    return pack.json()


def start_run(client: TestClient, document_ids: list[str]) -> uuid.UUID:
    """Install the wiring pack, create a session, and kick off a run. Returns run id."""
    signup(client)
    ws = make_workspace(client)
    pack = make_pack_with_spec(client, LEGACY_SPEC)
    installed = client.post(f"/workspaces/{ws['id']}/pack", json={"pack_id": pack["id"]})
    assert installed.status_code == 200, installed.text
    sess = client.post(
        f"/workspaces/{ws['id']}/sessions", json={"title": "S", "subject": "Acme"}
    ).json()
    r = client.post(
        f"/workspaces/{ws['id']}/sessions/{sess['id']}/run",
        json={"document_ids": document_ids},
    )
    assert r.status_code == 201, r.text
    return uuid.UUID(r.json()["id"])


def poll_run(client: TestClient, run_id: uuid.UUID, timeout: float = 5.0) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = client.get(f"/runs/{run_id}").json()["status"]
        if status in ("complete", "failed"):
            return status
        time.sleep(0.05)
    raise AssertionError(f"run {run_id} did not finish within {timeout}s")


def test_legacy_run_through_executor(app_client, db, providers):
    doc = ingest_text(db, "acme_msa.txt", [DOC_TEXT])
    providers.update(
        {
            "Document name:": {"doc_type": "Vendor Contract"},
            "field: cap": {"found": True, "value": "USD 500,000", "quote": GENUINE_QUOTE},
        }
    )
    run_id = start_run(app_client, [str(doc.id)])
    assert poll_run(app_client, run_id) == "complete"

    facts = db.query(Fact).filter(Fact.run_id == run_id).all()
    by_field = {f.field: f for f in facts}
    assert by_field["cap"].state == "verified"
    assert len(by_field["cap"].citations) == 1
    assert by_field["rule:cap_min"].state == "verified"
    assert len(by_field["rule:cap_min"].citations) >= 1

    run = db.get(Run, run_id)
    assert run.status == "complete"
    assert run.stage is None
    assert isinstance(run.report, dict)
    assert run.report["counts"]["verified"] >= 1


def test_fabricated_quote_stays_unsupported(app_client, db, providers):
    doc = ingest_text(db, "acme_msa.txt", [DOC_TEXT])
    providers.update(
        {
            "Document name:": {"doc_type": "Vendor Contract"},
            "field: cap": {
                "found": True,
                "value": "USD 999,999",
                "quote": "This sentence does not appear in the source document at all",
            },
        }
    )
    run_id = start_run(app_client, [str(doc.id)])
    assert poll_run(app_client, run_id) == "complete"

    fact = db.query(Fact).filter(Fact.run_id == run_id, Fact.field == "cap").one()
    assert fact.state == "unsupported"
    assert fact.citations == []


def test_node_attempts_recorded(app_client, db, providers):
    doc = ingest_text(db, "acme_msa.txt", [DOC_TEXT])
    providers.update(
        {
            "Document name:": {"doc_type": "Vendor Contract"},
            "field: cap": {"found": True, "value": "USD 500,000", "quote": GENUINE_QUOTE},
        }
    )
    run_id = start_run(app_client, [str(doc.id)])
    assert poll_run(app_client, run_id) == "complete"

    r = app_client.get(f"/runs/{run_id}/attempts")
    assert r.status_code == 200
    attempts = r.json()
    assert len(attempts) >= 1
    assert all(a["run_id"] == str(run_id) for a in attempts)
    statuses = {a["status"] for a in attempts}
    assert "completed" in statuses
    assert statuses <= {"completed", "skipped", "failed", "timed_out"}


def test_preview_writes_nothing(db, providers):
    doc = ingest_text(db, "acme_msa.txt", [DOC_TEXT])
    providers.update(
        {
            "Document name:": {"doc_type": "Vendor Contract"},
            "field: cap": {"found": True, "value": "USD 500,000", "quote": GENUINE_QUOTE},
        }
    )
    before = {
        "runs": db.query(Run).count(),
        "facts": db.query(Fact).count(),
        "citations": db.query(Citation).count(),
        "attempts": db.query(RunNodeAttempt).count(),
    }
    result = execute_workflow_preview(
        db, LEGACY_SPEC, case_subject="Acme Data Systems Ltd", document_ids=[doc.id]
    )
    assert result["status"] == "complete"
    assert isinstance(result["facts"], list) and result["facts"]
    assert result["report"] is not None
    assert "checklist" in result["report"]
    assert result["nodes"]
    by_field = {f["field"]: f for f in result["facts"]}
    assert by_field["cap"]["state"] == "verified"
    assert len(by_field["cap"]["citations"]) == 1

    after = {
        "runs": db.query(Run).count(),
        "facts": db.query(Fact).count(),
        "citations": db.query(Citation).count(),
        "attempts": db.query(RunNodeAttempt).count(),
    }
    assert after == before
