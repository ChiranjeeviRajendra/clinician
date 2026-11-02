"""JWT cryptographic and endpoint contracts without database operations."""
import uuid
from datetime import timedelta
from unittest.mock import Mock

import jwt
import pytest

from src.api import create_app
from src.api.auth.errors import AuthError
from src.api.auth.jwt_tokens import issue_access_token, validate_access_token
from src.api.auth import service
from src.api.extensions import db
from src.api.models import User
from src.api.models.auth import utcnow
from werkzeug.security import generate_password_hash


@pytest.fixture
def app(monkeypatch):
    application = create_app({"TESTING": True, "DATABASE_AUTH_MODE": "password", "RATELIMIT_ENABLED": False})
    with application.app_context():
        for operation in ("get", "scalar", "execute", "add", "commit"):
            monkeypatch.setattr(db.session, operation, Mock(side_effect=AssertionError("Authentication touched database")))
        monkeypatch.setattr(db.engine, "connect", Mock(side_effect=AssertionError("Authentication opened database")))
        yield application


def signed(app, **overrides):
    raw, _ = issue_access_token(uuid.uuid4())
    claims = validate_access_token(raw)
    claims.update(overrides)
    return jwt.encode(claims, app.config["JWT_SECRET_KEY"], algorithm="HS256")


def test_valid_jwt_is_signed_and_has_bounded_lifetime(app):
    user_id = uuid.uuid4()
    raw, expiry = issue_access_token(user_id)
    claims = validate_access_token(raw)
    assert raw.count(".") == 2
    assert claims["sub"] == str(user_id)
    assert claims["exp"] - claims["iat"] == 43200
    assert expiry.timestamp() == claims["exp"]
    assert "password" not in claims
    assert "auth_sessions" not in db.metadata.tables


@pytest.mark.parametrize("kind", ["opaque", "signature", "unsigned", "algorithm", "audience", "issuer",
                                   "missing_exp", "subject", "type", "future", "string_exp", "missing_jti"])
def test_invalid_tokens_are_rejected(app, kind):
    token = signed(app)
    claims = validate_access_token(token)
    if kind == "opaque": token = "old-opaque-session-token"
    elif kind == "signature": token = jwt.encode(claims, "a-different-secret-of-at-least-thirty-two-bytes", algorithm="HS256")
    elif kind == "unsigned": token = jwt.encode(claims, "", algorithm="none")
    elif kind == "algorithm": token = jwt.encode(claims, app.config["JWT_SECRET_KEY"], algorithm="HS384")
    else:
        if kind == "audience": claims["aud"] = "another-app"
        if kind == "issuer": claims["iss"] = "another-issuer"
        if kind == "missing_exp": del claims["exp"]
        if kind == "missing_jti": del claims["jti"]
        if kind == "subject": claims["sub"] = "not-a-uuid"
        if kind == "type": claims["token_type"] = "reset_password"
        if kind == "future": claims["iat"] = claims["nbf"] = int((utcnow() + timedelta(hours=1)).timestamp())
        if kind == "string_exp": claims["exp"] = str(claims["exp"])
        token = jwt.encode(claims, app.config["JWT_SECRET_KEY"], algorithm="HS256")
    with pytest.raises(AuthError) as error:
        validate_access_token(token)
    assert error.value.code == "unauthorized"


@pytest.mark.parametrize("expired_by", [0, 1, 3600])
def test_expiry_including_boundary_is_classified(app, expired_by):
    now = int(utcnow().timestamp())
    token = signed(app, iat=now-7200, nbf=now-7200, exp=now-expired_by)
    response = app.test_client().get("/authenticate", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json["status"] == "expired"
    assert response.json["error"]["code"] == "session_expired"


def test_reduced_ttl_applies_to_previously_issued_jwt(app):
    now = int(utcnow().timestamp())
    token = signed(app, iat=now-13*3600, nbf=now-13*3600, exp=now+3600)
    with pytest.raises(AuthError, match="expired"):
        validate_access_token(token)


@pytest.mark.parametrize("authorization", [None, "", "Basic abc", "Bearer", "Bearer a b", "Bearer invalid", "Bearer " + "a"*4097])
def test_authenticate_invalid_response(app, authorization):
    response = app.test_client().get("/authenticate", headers={} if authorization is None else {"Authorization": authorization})
    assert response.status_code == 401
    assert response.json["status"] == "invalid"
    assert response.json["error"]["code"] == "unauthorized"
    assert response.headers["Cache-Control"] == "no-store"


def test_authenticate_and_logout_do_not_use_database_or_revoke_jwt(app):
    token, expiry = issue_access_token(uuid.uuid4())
    headers = {"Authorization": f"Bearer {token}"}
    client = app.test_client()
    for _ in range(2):
        response = client.get("/authenticate", headers=headers)
        assert response.status_code == 200
        assert response.json == {"status": "valid", "expires_at": expiry.isoformat()}
        assert response.headers["Cache-Control"] == "no-store"
        assert client.post("/auth/logout", headers=headers).status_code == 204


def test_login_issues_jwt_without_storing_session(app, monkeypatch):
    user = User(id=uuid.uuid4(), email="doctor@example.com", created_at=utcnow(),
                email_verified_at=utcnow(), password_hash=generate_password_hash("valid-password"))
    monkeypatch.setattr(db.session, "scalar", Mock(return_value=user))
    commit = Mock()
    monkeypatch.setattr(db.session, "commit", commit)
    response = app.test_client().post("/auth/login", json={"email": user.email, "password": "valid-password"})
    assert response.status_code == 200
    claims = validate_access_token(response.json["session_token"])
    assert claims["sub"] == str(user.id)
    assert response.json["token_type"] == "Bearer"
    commit.assert_called_once()
    db.session.add.assert_not_called()
    db.session.execute.assert_not_called()


@pytest.mark.parametrize("state", ["invalid", "expired", "valid"])
def test_chat_validates_its_own_jwt_without_database(app, monkeypatch, state):
    chain = Mock()
    chain.invoke.return_value = {"answer": "An answer"}
    provider = Mock(return_value=chain)
    monkeypatch.setattr("src.api.chat.routes.get_rag_chain", provider)
    token, _ = issue_access_token(uuid.uuid4())
    if state == "invalid":
        token = "fake"
    elif state == "expired":
        now = int(utcnow().timestamp())
        token = signed(app, iat=now-7200, nbf=now-7200, exp=now-1)
    response = app.test_client().post("/chat", json={"message": "hello"}, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == (200 if state == "valid" else 401)
    if state == "valid":
        assert response.json == {"answer": "An answer"}
    else:
        provider.assert_not_called()


def test_password_reset_only_updates_email_tokens_without_session_revocation(app, monkeypatch):
    user = Mock()
    user.id = uuid.uuid4()
    token = Mock()
    monkeypatch.setattr(service, "usable_token", Mock(return_value=(user, token)))
    execute = Mock()
    monkeypatch.setattr(db.session, "execute", execute)
    monkeypatch.setattr(db.session, "commit", Mock())
    service.reset_password("email-reset-token", "new-password")
    assert execute.call_count == 1
    assert execute.call_args.args[0].table.name == "auth_tokens"


@pytest.mark.parametrize("secret", ["", "short"])
def test_missing_or_short_signing_key_fails_at_startup(secret):
    with pytest.raises(ValueError, match="JWT_SECRET_KEY"):
        create_app({"JWT_SECRET_KEY": secret})
