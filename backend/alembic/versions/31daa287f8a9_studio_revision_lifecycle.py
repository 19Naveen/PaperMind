"""studio revision lifecycle

Revision ID: 31daa287f8a9
Revises: e32606184ec1
Create Date: 2026-08-09 01:19:48.449297

Adds the studio revision-lifecycle persistence layer:
  - studio_draft_revisions: frozen WorkflowSpecV1 drafts per session (append-only)
  - studio_turns: the conversation transcript behind a session (append-only)
  - studio_test_runs: dry-run outcomes for a revision (append-only)
  - 4 nullable columns on studio_sessions linking it to a workspace/user/base-version
    and pinning its current draft revision.
All three new tables are append-only via BEFORE UPDATE OR DELETE triggers, installed
from the shared TRIGGERS_SQL_SOURCE (same source conftest's install_triggers() uses).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.models import TRIGGERS_SQL_SOURCE

# revision identifiers, used by Alembic.
revision: str = "31daa287f8a9"
down_revision: str | None = "e32606184ec1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # studio_draft_revisions first: studio_test_runs FKs it.
    op.create_table(
        "studio_draft_revisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("workflow", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("diff", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("validation", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("digest", sa.Text(), nullable=False),
        sa.Column("model_id", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["session_id"], ["studio_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "revision_no", name="uq_studio_revisions_session_no"),
    )
    op.create_table(
        "studio_turns",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("model_id", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), server_default="ok", nullable=False),
        sa.Column("revision_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["session_id"], ["studio_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_studio_turns_session_order", "studio_turns", ["session_id", "created_at"], unique=False
    )
    op.create_table(
        "studio_test_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("revision_id", sa.Uuid(), nullable=False),
        sa.Column("document_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("digest", sa.Text(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["revision_id"], ["studio_draft_revisions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Link studio_sessions into the revision lifecycle. All nullable so historical
    # rows (and existing test inserts) keep working.
    op.add_column(
        "studio_sessions",
        sa.Column("workspace_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "studio_sessions",
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "studio_sessions",
        sa.Column("base_pack_version_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "studio_sessions",
        sa.Column("current_revision_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_studio_sessions_workspace_id_workspaces",
        "studio_sessions",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_studio_sessions_created_by_id_users",
        "studio_sessions",
        "users",
        ["created_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_studio_sessions_base_pack_version_id_pack_versions",
        "studio_sessions",
        "pack_versions",
        ["base_pack_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # current_revision_id has NO FK by design (circular with studio_draft_revisions).

    # Install triggers (idempotent: CREATE OR REPLACE / DROP IF EXISTS). Adds the 3
    # append-only triggers for the new tables; re-runs the existing pack_versions /
    # facts triggers as a no-op refresh, matching the initial migration's style.
    op.get_bind().exec_driver_sql(TRIGGERS_SQL_SOURCE)


def downgrade() -> None:
    # Drop the 3 append-only triggers + their functions first (leave the pack_versions
    # / facts triggers alone — they belong to the initial migration).
    op.execute("DROP TRIGGER IF EXISTS studio_test_runs_no_update ON studio_test_runs")
    op.execute("DROP FUNCTION IF EXISTS f_block_studio_test_runs_mutation()")
    op.execute("DROP TRIGGER IF EXISTS studio_turns_no_update ON studio_turns")
    op.execute("DROP FUNCTION IF EXISTS f_block_studio_turns_mutation()")
    op.execute("DROP TRIGGER IF EXISTS studio_draft_revisions_no_update ON studio_draft_revisions")
    op.execute("DROP FUNCTION IF EXISTS f_block_studio_draft_revisions_mutation()")

    op.drop_constraint(
        "fk_studio_sessions_base_pack_version_id_pack_versions", "studio_sessions", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_studio_sessions_created_by_id_users", "studio_sessions", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_studio_sessions_workspace_id_workspaces", "studio_sessions", type_="foreignkey"
    )
    op.drop_column("studio_sessions", "current_revision_id")
    op.drop_column("studio_sessions", "base_pack_version_id")
    op.drop_column("studio_sessions", "created_by_id")
    op.drop_column("studio_sessions", "workspace_id")

    op.drop_table("studio_test_runs")
    op.drop_index("ix_studio_turns_session_order", table_name="studio_turns")
    op.drop_table("studio_turns")
    op.drop_table("studio_draft_revisions")
