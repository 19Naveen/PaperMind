"""run telemetry and pack release lifecycle

Revision ID: cdb93cb17287
Revises: 31daa287f8a9
Create Date: 2026-08-09 02:00:21.272676

Adds the persistence layer for DAG-run telemetry and the pack release/governance
lifecycle:
  - run_node_attempts: live per-node execution state (mutable, no immutability trigger)
  - pack_reviews: governance reviews; a pending review may be decided, a terminal one
    is frozen (partial immutability trigger)
  - pack_releases: the release log per environment (append-only trigger)
  - pack_audit_events: fully append-only audit trail (append-only trigger)
  - workspaces.environment: deployment target (default 'production', check-constrained)
  - runs.release_id: the release a run executed under (SET NULL on release delete)
All new triggers are installed from the shared TRIGGERS_SQL_SOURCE (same source
conftest's install_triggers() uses).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.models import TRIGGERS_SQL_SOURCE

# revision identifiers, used by Alembic.
revision: str = "cdb93cb17287"
down_revision: str | None = "31daa287f8a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "run_node_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("node_id", sa.Text(), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), server_default="running", nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("branch_reason", sa.Text(), nullable=True),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("output_digest", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "run_id", "node_id", "attempt_no", name="uq_run_node_attempts_run_node_attempt"
        ),
    )
    op.create_index(
        "ix_run_node_attempts_run_id", "run_node_attempts", ["run_id"], unique=False
    )
    op.create_table(
        "pack_reviews",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pack_id", sa.Uuid(), nullable=False),
        sa.Column("revision_id", sa.Uuid(), nullable=True),
        sa.Column("submitted_by", sa.Uuid(), nullable=True),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("approved_by", sa.Uuid(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("state", sa.Text(), server_default="pending", nullable=False),
        sa.Column("validation_digest", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["pack_id"], ["packs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["submitted_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "pack_releases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pack_id", sa.Uuid(), nullable=False),
        sa.Column("pack_version_id", sa.Uuid(), nullable=False),
        sa.Column("environment", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("source_release_id", sa.Uuid(), nullable=True),
        sa.Column("restored_from_release_id", sa.Uuid(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["pack_id"], ["packs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["pack_version_id"], ["pack_versions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_pack_releases_pack_env", "pack_releases", ["pack_id", "environment"], unique=False
    )
    op.create_table(
        "pack_audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pack_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("revision_id", sa.Uuid(), nullable=True),
        sa.Column("version_id", sa.Uuid(), nullable=True),
        sa.Column("release_id", sa.Uuid(), nullable=True),
        sa.Column("environment", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["pack_id"], ["packs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["pack_versions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_pack_audit_events_pack_created",
        "pack_audit_events",
        ["pack_id", "created_at"],
        unique=False,
    )

    # Workspaces gain a deployment environment. server_default backfills existing rows
    # as 'production'; the CHECK pins the allowed set.
    op.add_column(
        "workspaces",
        sa.Column("environment", sa.Text(), server_default="production", nullable=False),
    )
    op.create_check_constraint(
        "ck_workspaces_environment",
        "workspaces",
        "environment IN ('development','staging','production')",
    )

    # Runs may name the release they executed under. SET NULL so the release log stays
    # append-only (a release row is never deleted, but historical runs remain runnable).
    op.add_column("runs", sa.Column("release_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_runs_release_id_pack_releases",
        "runs",
        "pack_releases",
        ["release_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Install triggers (idempotent: CREATE OR REPLACE / DROP IF EXISTS). Adds the
    # pack_audit_events / pack_releases / pack_reviews triggers; re-runs the existing
    # pack_versions / facts / studio triggers as a no-op refresh.
    op.get_bind().exec_driver_sql(TRIGGERS_SQL_SOURCE)


def downgrade() -> None:
    # Drop the 3 new triggers + their functions first (leave the older triggers alone —
    # they belong to earlier migrations).
    op.execute("DROP TRIGGER IF EXISTS pack_audit_events_no_update ON pack_audit_events")
    op.execute("DROP FUNCTION IF EXISTS f_block_pack_audit_event_mutation()")
    op.execute("DROP TRIGGER IF EXISTS pack_releases_no_update ON pack_releases")
    op.execute("DROP FUNCTION IF EXISTS f_block_pack_release_mutation()")
    op.execute("DROP TRIGGER IF EXISTS pack_reviews_no_update ON pack_reviews")
    op.execute("DROP FUNCTION IF EXISTS f_block_pack_review_mutation()")

    op.drop_constraint("fk_runs_release_id_pack_releases", "runs", type_="foreignkey")
    op.drop_column("runs", "release_id")

    op.drop_constraint("ck_workspaces_environment", "workspaces", type_="check")
    op.drop_column("workspaces", "environment")

    op.drop_table("pack_audit_events")
    op.drop_index("ix_pack_releases_pack_env", table_name="pack_releases")
    op.drop_table("pack_releases")
    op.drop_table("pack_reviews")
    op.drop_index("ix_run_node_attempts_run_id", table_name="run_node_attempts")
    op.drop_table("run_node_attempts")
