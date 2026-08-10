"""Enrich the demo seed with a completed run (facts + citations) and more marketplace packs.

Idempotent and safe to re-run: exits early if a seed run already exists. Run with
`uv run python seed_rich.py` against the dev database. This exists because the base
seed_demo.py leaves sessions in 'draft' with no runs — so the UI's session checklist,
workspace verified-rate, and home progress bars have nothing real to show.
"""

from __future__ import annotations

import sys

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models import (
    Case,
    Chunk,
    Citation,
    Document,
    Fact,
    Pack,
    PackVersion,
    Run,
    RunDocument,
    User,
    Workspace,
    WorkspaceSession,
)

DEMO_EMAIL = "ada@papermind.io"
SEED_MODEL = "seed-demo"  # marks runs this script created, for idempotency

# A small synthetic case file. Quotes cited below are verbatim substrings of this text.
DOC_TEXT = (
    "This statement confirms that the supplier is Northwind Traders Limited, "
    "registered office at 221B Baker Street, London NW1 6XE, company number 08512347. "
    "The Data Processing Agreement is effective as of 2 January 2025 and requires "
    "breach notification within 72 hours of becoming aware. "
    "Aggregate liability shall not exceed one million five hundred thousand euros."
)

# field, value, state, quote (verbatim substring, or None for missing)
FACTS: list[tuple[str, str | None, str, str | None]] = [
    ("full_name", "Northwind Traders Limited", "verified", "Northwind Traders Limited"),
    ("registered_address", "221B Baker Street, London NW1 6XE", "verified", "221B Baker Street, London NW1 6XE"),
    ("dpa_effective_date", "2 January 2025", "verified", "effective as of 2 January 2025"),
    ("breach_notification_window", "within 72 hours", "verified", "within 72 hours"),
    ("liability_cap", "€1,500,000", "verified", "one million five hundred thousand euros"),
    ("penetration_test_summary", None, "missing", None),
]

EXTRA_PACKS: list[tuple[str, list[str], list[str], list[str]]] = [
    (
        "NDA Quick Screen",
        ["mutual NDA"],
        ["term", "governing_law", "residuals_clause"],
        ["An execution version is signed by both parties", "A residuals clause is present"],
    ),
    (
        "Commercial Lease Abstraction",
        ["commercial lease"],
        ["commencement_date", "rent", "renewal_option", "exclusive_use"],
        ["Rent is stated as an annual amount", "A renewal option is documented"],
    ),
    (
        "RFP Mandatory Compliance",
        ["RFP", "proposal"],
        ["submitted_on_time", "mandatory_sections_present"],
        ["Every mandatory RFP section is addressed"],
    ),
]


def _spec(name: str, docs: list[str], fields: list[str], rules: list[str]) -> dict[str, object]:
    return {
        "name": name,
        "document_types": docs,
        "fields": [
            {"name": f, "description": f.replace("_", " ").capitalize(), "type": "string"} for f in fields
        ],
        "rules": [{"id": f"r{i}", "description": r} for i, r in enumerate(rules)],
    }


def main() -> int:
    settings = get_settings()
    dim = settings.embedding_dim
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
        if not user:
            print(f"no demo user {DEMO_EMAIL} — run seed_demo.py first")
            return 1

        # Extra marketplace packs (idempotent by unique name).
        added_packs = 0
        for name, docs, fields, rules in EXTRA_PACKS:
            if db.scalar(select(Pack).where(Pack.name == name)):
                continue
            pack = Pack(name=name)
            db.add(pack)
            db.flush()
            db.add(PackVersion(pack_id=pack.id, version=1, spec=_spec(name, docs, fields, rules)))
            added_packs += 1

        # Find a workspace whose Pack is installed (prefer "Onboarding Compliance").
        onboarding = db.scalar(
            select(Workspace).where(Workspace.owner_id == user.id, Workspace.pack_id.is_not(None))
        )
        if not onboarding or not onboarding.pack_id:
            print("no workspace with an installed Pack — nothing to seed a run against")
            db.commit()
            return 0

        version = db.scalar(
            select(PackVersion).where(PackVersion.pack_id == onboarding.pack_id).order_by(PackVersion.version.desc())
        )
        if not version:
            print("installed Pack has no version — cannot seed a run")
            db.commit()
            return 0

        # Idempotent: a seed run already here means we're done.
        existing = db.scalar(select(Run).where(Run.pack_version_id == version.id, Run.model_id == SEED_MODEL))
        if existing:
            print(f"seed run already exists (run {existing.id}) — nothing to do")
            return 0

        # A draft session to attach the run to.
        session = db.scalar(
            select(WorkspaceSession).where(
                WorkspaceSession.workspace_id == onboarding.id,
                WorkspaceSession.status == "draft",
            ).order_by(WorkspaceSession.created_at)
        ) or db.scalar(select(WorkspaceSession).where(WorkspaceSession.workspace_id == onboarding.id))
        if not session:
            print("no session to attach the run to")
            db.commit()
            return 0

        # Document + one chunk (zero-vector embedding, real tsvector; retrieval isn't used
        # for an already-complete run, but the NOT NULL constraints must be satisfied).
        doc = Document(name="northwind-vendor-summary.txt", content_type="text/plain", blob_path="seed/northwind.txt", text=DOC_TEXT, pages=[{"page": 1, "char_start": 0}])
        db.add(doc)
        db.flush()
        chunk = Chunk(
            document_id=doc.id,
            position=0,
            page=1,
            char_start=0,
            char_end=len(DOC_TEXT),
            text=DOC_TEXT,
            embedding=[0.0] * dim,
            tsv=func.to_tsvector("english", DOC_TEXT),
        )
        db.add(chunk)
        db.flush()

        run = Run(pack_version_id=version.id, status="complete", stage="report", model_id=SEED_MODEL)
        db.add(run)
        db.flush()
        case = Case(run_id=run.id, subject="Northwind Traders")
        db.add(case)
        db.flush()
        db.add(RunDocument(run_id=run.id, case_id=case.id, document_id=doc.id, doc_type="vendor summary"))

        for field, value, state, quote in FACTS:
            fact = Fact(run_id=run.id, case_id=case.id, field=field, value=value, state=state)
            db.add(fact)
            db.flush()
            if state == "verified" and quote and (start := DOC_TEXT.find(quote)) >= 0:
                db.add(
                    Citation(
                        fact_id=fact.id,
                        chunk_id=chunk.id,
                        quote=quote,
                        char_start=start,
                        char_end=start + len(quote),
                        page=1,
                    )
                )

        session.run_id = run.id
        session.status = "complete"
        session.subject = "Northwind Traders"
        db.commit()

        print(f"seeded: run {run.id} ({len(FACTS)} facts) on session {session.id}; +{added_packs} marketplace pack(s)")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
