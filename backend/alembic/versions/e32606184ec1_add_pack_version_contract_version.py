"""add pack_version contract_version

Revision ID: e32606184ec1
Revises: 6dba10174bfe
Create Date: 2026-08-09 00:36:51.167053

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e32606184ec1'
down_revision: str | None = '6dba10174bfe'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Additive only: historical rows stay NULL (NULL == legacy v0). No UPDATE.
    op.add_column("pack_versions", sa.Column("contract_version", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("pack_versions", "contract_version")
