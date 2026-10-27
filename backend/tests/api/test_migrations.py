from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from flask_migrate import downgrade, upgrade
from sqlalchemy import inspect

from src.api.extensions import db


def test_migration_matches_models_and_can_roundtrip(app):
    with app.app_context():
        with db.engine.connect() as connection:
            context = MigrationContext.configure(connection, opts={"compare_type": True})
            assert compare_metadata(context, db.metadata) == []
        downgrade()
        assert "users" not in inspect(db.engine).get_table_names()
        upgrade()
        assert {"users", "auth_sessions", "auth_tokens"}.issubset(inspect(db.engine).get_table_names())
