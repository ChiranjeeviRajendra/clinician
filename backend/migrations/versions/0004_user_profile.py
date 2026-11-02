"""Add optional user details in a one-to-one profile table.

Revision ID: 0004_user_profile
Revises: 0003_stateless_jwt
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_user_profile"
down_revision = "0003_stateless_jwt"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_profile",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("full_name", sa.String(200)),
        sa.Column("age", sa.Integer()),
        sa.Column("gender", sa.String(50)),
        sa.Column("height_cm", sa.Numeric(5, 2)),
        sa.Column("weight_kg", sa.Numeric(6, 2)),
        sa.Column("ethnicity", sa.String(100)),
        sa.CheckConstraint("age >= 0 AND age <= 150", name=op.f("ck_user_profile_valid_age")),
        sa.CheckConstraint("height_cm > 0 AND height_cm <= 300", name=op.f("ck_user_profile_valid_height_cm")),
        sa.CheckConstraint("weight_kg > 0 AND weight_kg <= 1000", name=op.f("ck_user_profile_valid_weight_kg")),
        sa.ForeignKeyConstraint(["id"], ["users.id"], name=op.f("fk_user_profile_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_profile")),
    )


def downgrade():
    op.drop_table("user_profile")
