"""Thin persistence helpers for node-attempt telemetry (run_node_attempts).

One row per (run, node, attempt). `start_attempt` opens the row as "running";
`finish_attempt` closes it with the terminal status. Higher-level DAG execution
lives in app/services/workflow_runtime.py.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import RunNodeAttempt


def start_attempt(
    db: Session, *, run_id: uuid.UUID, node_id: str, attempt_no: int
) -> RunNodeAttempt:
    attempt = RunNodeAttempt(
        run_id=run_id,
        node_id=node_id,
        attempt_no=attempt_no,
        status="running",
        started_at=datetime.now(),
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return attempt


def finish_attempt(
    db: Session,
    attempt_id: uuid.UUID,
    *,
    status: str,
    error_code: str | None = None,
    error_message: str | None = None,
    output_digest: str | None = None,
    branch_reason: str | None = None,
) -> RunNodeAttempt:
    attempt = db.get(RunNodeAttempt, attempt_id)
    if attempt is None:
        raise ValueError(f"no RunNodeAttempt with id {attempt_id}")
    attempt.status = status
    attempt.finished_at = datetime.now()
    attempt.error_code = error_code
    attempt.error_message = error_message
    attempt.output_digest = output_digest
    attempt.branch_reason = branch_reason
    db.commit()
    db.refresh(attempt)
    return attempt


def list_attempts(db: Session, run_id: uuid.UUID) -> list[RunNodeAttempt]:
    return (
        db.query(RunNodeAttempt)
        .filter(RunNodeAttempt.run_id == run_id)
        .order_by(RunNodeAttempt.started_at, RunNodeAttempt.attempt_no)
        .all()
    )


def count_attempts(db: Session, run_id: uuid.UUID, node_id: str) -> int:
    return (
        db.query(RunNodeAttempt)
        .filter(RunNodeAttempt.run_id == run_id, RunNodeAttempt.node_id == node_id)
        .count()
    )
