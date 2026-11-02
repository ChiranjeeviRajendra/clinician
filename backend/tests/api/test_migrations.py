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
        assert "name" not in {column["name"] for column in inspect(db.engine).get_columns("users")}
        assert "auth_sessions" not in inspect(db.engine).get_table_names()
        downgrade(revision="0002_remove_user_name")
        assert "auth_sessions" in inspect(db.engine).get_table_names()
        upgrade()
        assert "auth_sessions" not in inspect(db.engine).get_table_names()
        downgrade(revision="0001_auth")
        assert "name" in {column["name"] for column in inspect(db.engine).get_columns("users")}
        upgrade()
        assert "name" not in {column["name"] for column in inspect(db.engine).get_columns("users")}
        downgrade(revision="base")
        assert "users" not in inspect(db.engine).get_table_names()
        upgrade()
        assert {"users", "auth_tokens"}.issubset(inspect(db.engine).get_table_names())
        assert "auth_sessions" not in inspect(db.engine).get_table_names()
        assert "name" not in {column["name"] for column in inspect(db.engine).get_columns("users")}
