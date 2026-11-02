"""Minimal user information contracts with mocked reads, no database writes."""
import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.exc import OperationalError

from src.api import create_app
from src.api.auth.jwt_tokens import issue_access_token
from src.api.extensions import db


@pytest.fixture
def client(monkeypatch):
    app = create_app({"TESTING": True, "RATELIMIT_ENABLED": False, "DATABASE_AUTH_MODE": "password"})
    with app.app_context():
        monkeypatch.setattr(db.engine, "connect", Mock(side_effect=AssertionError("Unexpected database connection")))
        yield app.test_client()


@pytest.mark.parametrize("authorization", [None, "", "Basic abc", "Bearer", "Bearer a b", "Bearer opaque-token"])
def test_missing_or_invalid_token_is_unauthorized(client, monkeypatch, authorization):
    read = Mock()
    monkeypatch.setattr(db.session, "get", read)
    response = client.get("/userInfo", headers={} if authorization is None else {"Authorization": authorization})
    assert response.status_code == 401
    assert response.json["error"]["code"] == "unauthorized"
    assert response.headers["Cache-Control"] == "no-store"
    read.assert_not_called()


@pytest.mark.parametrize("verified", [False, True])
def test_user_info_returns_only_email_verification_and_expiry(client, monkeypatch, verified):
    user = SimpleNamespace(email="doctor@example.com", email_verified_at=object() if verified else None)
    monkeypatch.setattr(db.session, "get", Mock(return_value=user))
    raw, expiry = issue_access_token(uuid.uuid4())
    response = client.get("/userInfo", headers={"Authorization": f"Bearer {raw}"})
    assert response.status_code == 200
    assert response.json == {"email": "doctor@example.com", "email_verified": verified,
                             "expires_at": expiry.isoformat()}
    assert response.headers["Cache-Control"] == "no-store"


def test_old_app_info_endpoint_is_removed(client, monkeypatch):
    read = Mock()
    monkeypatch.setattr(db.session, "get", read)
    assert client.get("/appInfo").status_code == 404
    read.assert_not_called()


def test_deleted_account_cannot_read_user_info(client, monkeypatch):
    monkeypatch.setattr(db.session, "get", Mock(return_value=None))
    raw, _ = issue_access_token(uuid.uuid4())
    assert client.get("/userInfo", headers={"Authorization": f"Bearer {raw}"}).status_code == 401


def test_database_failure_is_not_invalid_authentication(client, monkeypatch):
    monkeypatch.setattr(db.session, "get", Mock(side_effect=OperationalError("SELECT", {}, Exception("private connection details"))))
    raw, _ = issue_access_token(uuid.uuid4())
    response = client.get("/userInfo", headers={"Authorization": f"Bearer {raw}"})
    assert response.status_code == 503
    assert response.json["error"]["code"] == "service_unavailable"
    assert "private" not in response.get_data(as_text=True)
