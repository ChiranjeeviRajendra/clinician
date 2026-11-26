"""Shared HTTP boundaries remain stable without database or provider access."""

import uuid
from smtplib import SMTPException
from unittest.mock import Mock

import pytest
from sqlalchemy.exc import OperationalError

from src.api import create_app
from src.api.auth.jwt_tokens import issue_access_token
from src.api.extensions import db


@pytest.fixture
def client(monkeypatch):
    app = create_app(
        {
            "TESTING": True,
            "DATABASE_AUTH_MODE": "password",
            "RATELIMIT_ENABLED": False,
        }
    )
    monkeypatch.setattr(db.session, "rollback", Mock())
    return app.test_client()


@pytest.mark.parametrize("body", [[], "invalid", 7, True])
def test_non_object_json_is_rejected_before_account_service(client, monkeypatch, body):
    register = Mock()
    monkeypatch.setattr("src.api.auth.service.register", register)
    response = client.post("/auth/register", json=body)
    assert response.status_code == 400
    assert response.json == {
        "error": {"code": "invalid_input", "message": "Request body must be a JSON object."},
    }
    assert response.headers["Cache-Control"] == "no-store"
    register.assert_not_called()


@pytest.mark.parametrize(
    ("failure", "code"),
    [
        (
            OperationalError("SELECT", {}, RuntimeError("private credentials")),
            "service_unavailable",
        ),
        (SMTPException("private credentials"), "mail_unavailable"),
        (OSError("private credentials"), "mail_unavailable"),
    ],
)
def test_service_errors_roll_back_and_hide_internal_details(client, monkeypatch, failure, code):
    monkeypatch.setattr("src.api.auth.service.register", Mock(side_effect=failure))
    response = client.post(
        "/auth/register",
        json={
            "email": "doctor@example.com",
            "password": "long-password",
        },
    )
    assert response.status_code == 503
    assert response.json["error"]["code"] == code
    assert "private credentials" not in response.get_data(as_text=True)
    db.session.rollback.assert_called_once()


def test_unknown_routes_return_json_errors(client):
    response = client.get("/missing")
    assert response.status_code == 404
    assert response.json["error"]["code"] == "not_found"


@pytest.mark.parametrize(
    ("method", "path", "options"),
    [
        ("post", "/chat", {"json": {"message": " question "}}),
        ("get", "/get", {"query_string": {"msg": " question "}}),
        ("post", "/get", {"data": {"msg": " question "}}),
        ("post", "/get", {"json": {"msg": " question "}}),
    ],
)
def test_chat_and_legacy_requests_keep_their_contract(client, monkeypatch, method, path, options):
    chain = Mock()
    chain.invoke.return_value = {"answer": "A reference answer."}
    monkeypatch.setattr("src.api.chat.routes.get_rag_chain", Mock(return_value=chain))
    with client.application.app_context():
        token, _ = issue_access_token(uuid.uuid4())
    response = getattr(client, method)(
        path, headers={"Authorization": f"Bearer {token}"}, **options
    )
    assert response.status_code == 200
    assert response.json == {"answer": "A reference answer."}
    chain.invoke.assert_called_once_with({"input": "question"})
