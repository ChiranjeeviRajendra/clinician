"""Endpoint contract tests that do not connect to the configured database."""
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.exc import OperationalError

from src.api import create_app
from src.api.auth.errors import AuthError
from src.api.models.auth import utcnow


@pytest.fixture
def client():
    return create_app({"TESTING": True, "RATELIMIT_ENABLED": False,
                       "DATABASE_AUTH_MODE": "password"}).test_client()


@pytest.mark.parametrize("authorization", [None, "", "Basic abc", "Bearer", "Bearer a b"])
def test_missing_or_malformed_token_is_unauthorized(client, monkeypatch, authorization):
    validator = Mock()
    monkeypatch.setattr("src.api.auth.service.authenticated_session", validator)
    headers = {} if authorization is None else {"Authorization": authorization}
    response = client.get("/appInfo", headers=headers)
    assert response.status_code == 401
    assert response.json["error"]["code"] == "unauthorized"
    assert response.headers["Cache-Control"] == "no-store"
    validator.assert_not_called()


def test_app_info_validates_session_and_returns_only_public_information(client, monkeypatch):
    now = utcnow()
    session = SimpleNamespace(created_at=now, expires_at=now + timedelta(hours=24))
    user = Mock()
    user.to_dict.return_value = {"id": "doctor", "email": "doctor@example.com"}
    validator = Mock(return_value=(session, user))
    monkeypatch.setattr("src.api.auth.service.authenticated_session", validator)
    response = client.get("/appInfo", headers={"Authorization": "Bearer valid-token"})
    assert response.status_code == 200
    assert response.json == {
        "name": "Clinician", "service": "clinician-api", "status": "ok",
        "user": user.to_dict.return_value,
        "expires_at": (now + timedelta(hours=12)).isoformat(),
    }
    validator.assert_called_once_with("valid-token")
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("code", ["unauthorized", "session_expired"])
def test_rejected_session_cannot_read_app_info(client, monkeypatch, code):
    monkeypatch.setattr("src.api.auth.service.authenticated_session", Mock(
        side_effect=AuthError(code, "A valid session is required.", 401),
    ))
    response = client.get("/appInfo", headers={"Authorization": "Bearer rejected-token"})
    assert response.status_code == 401
    assert response.json["error"]["code"] == code
    assert "user" not in response.json


def test_database_failure_is_not_reported_as_invalid_authentication(client, monkeypatch):
    monkeypatch.setattr("src.api.auth.service.authenticated_session", Mock(
        side_effect=OperationalError("SELECT", {}, Exception("private connection details")),
    ))
    response = client.get("/appInfo", headers={"Authorization": "Bearer saved-token"})
    assert response.status_code == 503
    assert response.json["error"]["code"] == "service_unavailable"
    assert "private" not in response.get_data(as_text=True)
