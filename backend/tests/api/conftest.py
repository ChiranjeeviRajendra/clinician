import os
import uuid

import pytest
from dotenv import load_dotenv
from flask_migrate import upgrade
from sqlalchemy import create_engine, text

from src.api import create_app
from src.api.extensions import db


@pytest.fixture(scope="session")
def app():
    load_dotenv()
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to run PostgreSQL integration tests.")
    if not url.startswith("postgresql+psycopg://"):
        pytest.fail("TEST_DATABASE_URL must use postgresql+psycopg://")
    # Each run owns a new schema. No production/application tables are truncated.
    schema = "auth_test_" + uuid.uuid4().hex
    admin_engine = create_engine(url)
    with admin_engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    application = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": url,
        "SQLALCHEMY_ENGINE_OPTIONS": {
            "connect_args": {"options": f"-csearch_path={schema}"},
            "pool_pre_ping": True,
        },
        "RATELIMIT_ENABLED": False,
    })
    try:
        with application.app_context():
            upgrade()
        yield application
    finally:
        with application.app_context():
            db.session.remove()
            db.engine.dispose()
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin_engine.dispose()


@pytest.fixture(autouse=True)
def clean_database(app):
    with app.app_context():
        db.session.execute(text("TRUNCATE auth_tokens, auth_sessions, users CASCADE"))
        db.session.commit()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def mailbox(monkeypatch):
    messages = []
    monkeypatch.setattr("src.api.auth.service.send_email", lambda *args: messages.append(args))
    return messages
