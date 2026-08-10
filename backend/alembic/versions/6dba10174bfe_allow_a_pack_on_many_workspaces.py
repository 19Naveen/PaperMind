"""allow a pack on many workspaces

A marketplace Pack is a shared, frozen artifact; the UNIQUE on workspaces.pack_id
made it single-tenant, so installing a published Pack onto a second workspace
always conflicted. Drop it — a workspace still holds one Pack (route-enforced),
but any number of workspaces may use the same one.

Revision ID: 6dba10174bfe
Revises: 8f21c4a7b013
Create Date: 2026-08-08 20:32:28.467870

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '6dba10174bfe'
down_revision: str | None = '8f21c4a7b013'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("workspaces_pack_id_key", "workspaces", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint("workspaces_pack_id_key", "workspaces", ["pack_id"])