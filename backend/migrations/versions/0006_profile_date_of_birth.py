"""Replace profile age with an optional date of birth.

Revision ID: 0006_profile_date_of_birth
Revises: 0005_profile_choice_ids

Prepared for manual execution only. Existing birth dates remain NULL because an
age cannot determine an exact birth date. Dropped ages cannot be recovered by a
downgrade, which recreates an empty nullable age column instead.
"""
from alembic import op
import sqlalchemy as sa


revision = "0006_profile_date_of_birth"
down_revision = "0005_profile_choice_ids"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("user_profile", sa.Column("date_of_birth", sa.Date(), nullable=True))
    op.drop_constraint(op.f("ck_user_profile_valid_age"), "user_profile", type_="check")
    op.drop_column("user_profile", "age")


def downgrade():
    op.add_column("user_profile", sa.Column("age", sa.Integer(), nullable=True))
    op.create_check_constraint(op.f("ck_user_profile_valid_age"), "user_profile", "age >= 0 AND age <= 150")
    op.drop_column("user_profile", "date_of_birth")
