"""Remove the account display name.

Revision ID: 0002_remove_user_name
Revises: 0001_auth
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_remove_user_name"
down_revision = "0001_auth"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("users", "name")


def downgrade():
    # Recreate the old schema; deleted name values cannot be recovered.
    op.add_column("users", sa.Column("name", sa.String(100), nullable=True))
