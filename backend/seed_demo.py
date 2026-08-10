"""Seed a demo account, a Pack, and two workspaces so the UI has something to show.

Idempotent: re-running updates nothing and creates nothing twice — it exits early if the
demo user already exists. Run with `make seed` or `uv run python seed_demo.py`.

This is dev scaffolding, not a fixture library. It exists because a prototype with an
empty database looks broken rather than new.
"""

from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import Pack, PackAsset, PackVersion, User, Workspace, WorkspaceSession

DEMO_EMAIL = "ada@papermind.io"
DEMO_PASSWORD = "papermind123"  # noqa: S105 # dev seed credential, never a deployed secret

KYC_SPEC: dict[str, object] = {
    "name": "KYC Checker",
    "document_types": ["passport", "utility bill", "bank statement"],
    "fields": [
        {"name": "full_name", "description": "The subject's full legal name", "type": "string"},
        {"name": "date_of_birth", "description": "The subject's date of birth", "type": "date"},
        {
            "name": "document_number",
            "description": "Passport or ID document number",
            "type": "string",
        },
        {"name": "address", "description": "Current residential address", "type": "string"},
    ],
    "rules": [
        {"id": "poa_present", "description": "A proof of address must be present"},
        {"id": "id_valid", "description": "The identity document must be provided"},
    ],
}

ASSETS = [
    ("kyc_report.docx", "Word template · 4 pages"),
    ("policy_handbook_v4.pdf", "Reference · 62 pages"),
    ("kyc_subject.json", "Schema · 12 fields"),
    ("watchlists.csv", "Reference · 8.2k rows"),
]


def main() -> int:
    db = SessionLocal()
    try:
        if db.scalar(select(User).where(User.email == DEMO_EMAIL)):
            print(f"demo user {DEMO_EMAIL} already exists — nothing to do")
            return 0

        user = User(
            email=DEMO_EMAIL,
            name="Ada Lovelace",
            password_hash=hash_password(DEMO_PASSWORD),
            role="examiner",
        )
        db.add(user)
        db.flush()

        pack = Pack(name="KYC Checker")
        db.add(pack)
        db.flush()

        version = PackVersion(pack_id=pack.id, version=1, spec=KYC_SPEC)
        db.add(version)
        db.flush()

        for name, meta in ASSETS:
            db.add(
                PackAsset(
                    pack_version_id=version.id,
                    name=name,
                    blob_path=f"seed/{name}",
                    meta=meta,
                )
            )

        onboarding = Workspace(
            owner_id=user.id,
            name="Onboarding Compliance",
            goal=(
                "Validates onboarding documents, extracts identity data, applies the firm "
                "policy and fills the verification report."
            ),
            pack_id=pack.id,
        )
        vendor = Workspace(
            owner_id=user.id,
            name="Vendor Due Diligence",
            goal=(
                "No Pack installed yet. Build one from a description, or install a "
                "published Pack."
            ),
        )
        db.add_all([onboarding, vendor])
        db.flush()

        db.add_all(
            [
                WorkspaceSession(
                    workspace_id=onboarding.id,
                    title="Nordwind Logistics GmbH",
                    status="draft",
                    subject="Nordwind Logistics GmbH",
                    messages=[],
                ),
                WorkspaceSession(
                    workspace_id=onboarding.id,
                    title="Acme Freight Ltd",
                    status="draft",
                    subject="Acme Freight Ltd",
                    messages=[],
                ),
            ]
        )
        db.commit()

        print(f"seeded: {DEMO_EMAIL} / {DEMO_PASSWORD}")
        print("  pack       KYC Checker v1 (4 assets)")
        print("  workspaces Onboarding Compliance (2 sessions), Vendor Due Diligence (no pack)")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
