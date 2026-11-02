"""Store profile gender and ethnicity as numeric choice IDs.

Revision ID: 0005_profile_choice_ids
Revises: 0004_user_profile

Prepared for manual execution only. All sixteen original ethnicity labels map
to distinct stable IDs and can be restored on downgrade. Unsupported gender
labels become NULL; those cleared values cannot be recovered on downgrade.
"""
from alembic import op
import sqlalchemy as sa


revision = "0005_profile_choice_ids"
down_revision = "0004_user_profile"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "user_profile", "gender", existing_type=sa.String(50),
        type_=sa.SmallInteger(), existing_nullable=True,
        postgresql_using="CASE gender WHEN 'Male' THEN 1 WHEN 'Female' THEN 2 ELSE NULL END",
    )
    # Freeze historical labels here; future changes to the catalog must not
    # change the behavior of an already-published migration.
    op.alter_column(
        "user_profile", "ethnicity", existing_type=sa.String(100),
        type_=sa.Integer(), existing_nullable=True,
        postgresql_using="""CASE ethnicity
            WHEN 'Aboriginal or Torres Strait Islander' THEN 1
            WHEN 'Black or African descent' THEN 2
            WHEN 'Caribbean' THEN 3
            WHEN 'Central Asian' THEN 4
            WHEN 'East Asian' THEN 5
            WHEN 'Hispanic or Latino' THEN 6
            WHEN 'Indigenous or First Nations' THEN 7
            WHEN 'Middle Eastern or North African' THEN 8
            WHEN 'Native American or Alaska Native' THEN 9
            WHEN 'Pacific Islander' THEN 10
            WHEN 'South Asian' THEN 11
            WHEN 'Southeast Asian' THEN 12
            WHEN 'White or European descent' THEN 13
            WHEN 'Mixed or multiple ethnicities' THEN 14
            WHEN 'Other' THEN 15
            WHEN 'Prefer not to say' THEN 16
            ELSE NULL END""",
    )
    op.create_check_constraint(op.f("ck_user_profile_valid_gender"), "user_profile", "gender IN (1, 2)")
    op.create_check_constraint(op.f("ck_user_profile_valid_ethnicity"), "user_profile", "ethnicity > 0")


def downgrade():
    op.drop_constraint(op.f("ck_user_profile_valid_ethnicity"), "user_profile", type_="check")
    op.drop_constraint(op.f("ck_user_profile_valid_gender"), "user_profile", type_="check")
    op.alter_column(
        "user_profile", "gender", existing_type=sa.SmallInteger(),
        type_=sa.String(50), existing_nullable=True,
        postgresql_using="CASE gender WHEN 1 THEN 'Male' WHEN 2 THEN 'Female' ELSE NULL END",
    )
    op.alter_column(
        "user_profile", "ethnicity", existing_type=sa.Integer(),
        type_=sa.String(100), existing_nullable=True,
        postgresql_using="""CASE ethnicity
            WHEN 1 THEN 'Aboriginal or Torres Strait Islander'
            WHEN 2 THEN 'Black or African descent'
            WHEN 3 THEN 'Caribbean'
            WHEN 4 THEN 'Central Asian'
            WHEN 5 THEN 'East Asian'
            WHEN 6 THEN 'Hispanic or Latino'
            WHEN 7 THEN 'Indigenous or First Nations'
            WHEN 8 THEN 'Middle Eastern or North African'
            WHEN 9 THEN 'Native American or Alaska Native'
            WHEN 10 THEN 'Pacific Islander'
            WHEN 11 THEN 'South Asian'
            WHEN 12 THEN 'Southeast Asian'
            WHEN 13 THEN 'White or European descent'
            WHEN 14 THEN 'Mixed or multiple ethnicities'
            WHEN 15 THEN 'Other'
            WHEN 16 THEN 'Prefer not to say'
            ELSE NULL END""",
    )
