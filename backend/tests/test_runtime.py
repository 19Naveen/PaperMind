"""Runtime: the six stages run in order on one fixture doc + a 3-field Pack, and the
verified / unsupported / missing states are all reachable. The fabricated-quote check is
load-bearing — a value without a real source sentence must NOT become verified."""

from __future__ import annotations

from app.models import Case, Fact, Pack, PackVersion, Run, RunDocument
from app.runtime import execute_run
from tests.util import ingest_text, make_spec

DOC_TEXT = (
    "MASTER SERVICES AGREEMENT between Acme Data Systems and the Customer.\n"
    "LIABILITY. The aggregate liability of either party shall not exceed five hundred "
    "thousand dollars (USD 500,000) under this Agreement.\n"
    "AUDIT. The independent auditor for the current fiscal year is Mildred Hummingbird LLP.\n"
    "SIGNED by the duly authorised representatives on this day, here in the City of "
    "Ankara, by the duly authorised representatives of both parties."
)

SPEC = make_spec(
    "Vendor Due Diligence",
    document_types=["Vendor Contract"],
    fields=[
        {
            "name": "cap",
            "description": "Contractual cap on aggregate liability",
            "type": "currency",
        },
        {"name": "signed_date", "description": "Execution date of the agreement", "type": "date"},
        {
            "name": "auditor_privacy",
            "description": "Name of the independent auditor",
            "type": "string",
        },
    ],
    rules=[
        {"id": "cap_min", "description": "Liability cap must be at least $250,000"},
        {"id": "dpa_present", "description": "A signed DPA must be present"},
    ],
)

SCRIPT = {
    "Document name:": {"doc_type": "Vendor Contract"},
    "field: cap": {
        "found": True,
        "value": "USD 500,000",
        "quote": (
            "aggregate liability of either party shall not exceed five hundred thousand dollars"
        ),
    },
    "field: signed_date": {
        "found": True,
        "value": "1999-01-01",
        # Fabricated: this sentence does not exist in the source document.
        "quote": (
            "This agreement was signed on the first of january in nineteen"
            " ninety nine remotely by witnesses"
        ),
    },
    "field: auditor_privacy": {"found": False, "value": None, "quote": None},
}


def test_fabricated_quote_is_unsupported_not_verified(db, providers):
    doc = ingest_text(db, "acme_msa.txt", [DOC_TEXT])
    providers.update(SCRIPT)

    pack = Pack(name="vendor")
    db.add(pack)
    db.flush()
    pv = PackVersion(pack_id=pack.id, version=1, spec=SPEC.model_dump())
    db.add(pv)
    db.flush()
    run = Run(pack_version_id=pv.id, model_id="fake:local", status="pending")
    db.add(run)
    db.flush()
    case = Case(run_id=run.id, subject="Acme Data Systems Ltd")
    db.add(case)
    db.flush()
    db.add(RunDocument(run_id=run.id, case_id=case.id, document_id=doc.id))
    db.commit()

    outcome = execute_run(run.id)
    if outcome["status"] != "complete":
        raise AssertionError(f"run failed: {outcome}")
    assert outcome["status"] == "complete"

    db.refresh(run)
    facts = db.query(Fact).filter(Fact.run_id == run.id).all()
    by_field = {f.field: f for f in facts}

    # cap: genuine quote -> verified + a real citation.
    assert by_field["cap"].state == "verified"
    assert len(by_field["cap"].citations) == 1
    citation = by_field["cap"].citations[0]
    assert citation.char_start < citation.char_end
    assert DOC_TEXT[citation.char_start : citation.char_end].strip()
    # The citation's offset must point at real text — the EvidenceViewer guarantee.
    assert "aggregate liability" in DOC_TEXT[citation.char_start : citation.char_end]

    # signed_date: fabricated quote -> unsupported, never verified, never a citation.
    assert by_field["signed_date"].state == "unsupported"
    assert by_field["signed_date"].citations == []

    # auditor_privacy: the model says not present -> missing, no fabricated value.
    assert by_field["auditor_privacy"].state == "missing"

    # cross-validate rules resolved from the verified facts.
    assert by_field["rule:cap_min"].state == "verified"
    assert by_field["rule:dpa_present"].value == "missing"
