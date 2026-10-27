from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import re

import pytest
from sqlalchemy import select
from werkzeug.security import check_password_hash

from src.api.auth.service import hash_token
from src.api.extensions import db
from src.api.models import AuthSession, AuthToken, User
from src.api.models.auth import utcnow

EMAIL = "doctor@example.com"
PASSWORD = "correct-horse-battery-123"
NEW_PASSWORD = "another-secure-password-456"


def token_from_email(mailbox):
    return re.search(r"#token=([\w-]+)", mailbox[-1][2]).group(1)


def register(client):
    return client.post("/auth/register", json={"email": EMAIL, "password": PASSWORD, "name": "Doctor"})


def verified_user(client, mailbox):
    assert register(client).status_code == 201
    token = token_from_email(mailbox)
    assert client.post("/auth/verify-email", json={"token": token}).status_code == 200


def login(client, password=PASSWORD):
    return client.post("/auth/login", json={"email": EMAIL, "password": password})


def bearer(response):
    assert response.status_code == 200
    return {"Authorization": "Bearer " + response.json["session_token"]}


def test_register_verify_login_me_logout(client, mailbox, app):
    response = register(client)
    assert response.status_code == 201
    assert response.json["user"]["email_verified"] is False
    assert "password_hash" not in response.json["user"]
    assert response.headers["Cache-Control"] == "no-store"
    assert login(client).status_code == 403
    token = token_from_email(mailbox)
    with app.app_context():
        user = db.session.scalar(select(User))
        assert user.password_hash != PASSWORD
        assert check_password_hash(user.password_hash, PASSWORD)
        assert db.session.scalar(select(AuthToken)).token_hash == hash_token(token)
    assert client.post("/auth/verify-email", json={"token": token}).status_code == 200
    assert client.post("/auth/verify-email", json={"token": token}).status_code == 400
    response = login(client)
    headers = bearer(response)
    with app.app_context():
        assert db.session.scalar(select(AuthSession)).token_hash == hash_token(response.json["session_token"])
    assert client.get("/auth/me", headers=headers).json["user"]["email_verified"] is True
    assert client.post("/auth/logout", headers=headers).status_code == 204
    assert client.get("/auth/me", headers=headers).status_code == 401
    assert client.post("/auth/logout", headers=headers).status_code == 401


def test_duplicate_email_is_case_insensitive(client, mailbox):
    assert register(client).status_code == 201
    response = client.post("/auth/register", json={"email": EMAIL.upper(), "password": PASSWORD})
    assert response.status_code == 409
    assert len(mailbox) == 1


def test_password_reset_revokes_all_sessions_and_rejects_reuse(client, mailbox):
    verified_user(client, mailbox)
    first = bearer(login(client))
    second = bearer(login(client))
    assert client.post("/auth/forgot-password", json={"email": EMAIL}).status_code == 202
    token = token_from_email(mailbox)
    assert client.post("/auth/reset-password", json={"token": token, "password": NEW_PASSWORD}).status_code == 200
    assert client.get("/auth/me", headers=first).status_code == 401
    assert client.get("/auth/me", headers=second).status_code == 401
    assert login(client).status_code == 401
    assert login(client, NEW_PASSWORD).status_code == 200
    assert client.post("/auth/reset-password", json={"token": token, "password": PASSWORD}).status_code == 400


def test_forgot_password_does_not_disclose_accounts(client, mailbox):
    known = client.post("/auth/forgot-password", json={"email": EMAIL})
    assert register(client).status_code == 201
    present = client.post("/auth/forgot-password", json={"email": EMAIL})
    assert known.status_code == present.status_code == 202
    assert known.json == present.json


def test_new_reset_request_invalidates_previous_token(client, mailbox):
    verified_user(client, mailbox)
    client.post("/auth/forgot-password", json={"email": EMAIL})
    old = token_from_email(mailbox)
    client.post("/auth/forgot-password", json={"email": EMAIL})
    new = token_from_email(mailbox)
    assert client.post("/auth/reset-password", json={"token": old, "password": NEW_PASSWORD}).status_code == 400
    assert client.post("/auth/reset-password", json={"token": new, "password": NEW_PASSWORD}).status_code == 200


@pytest.mark.parametrize("purpose,endpoint", [
    ("verify_email", "/auth/verify-email"), ("reset_password", "/auth/reset-password"),
])
def test_expired_email_tokens(client, mailbox, app, purpose, endpoint):
    register(client)
    if purpose == "reset_password":
        client.post("/auth/forgot-password", json={"email": EMAIL})
    token = token_from_email(mailbox)
    with app.app_context():
        row = db.session.scalar(select(AuthToken).where(AuthToken.token_hash == hash_token(token)))
        row.expires_at = utcnow() - timedelta(seconds=1)
        db.session.commit()
    assert client.post(endpoint, json={"token": token, "password": NEW_PASSWORD}).status_code == 400


def test_expired_session(client, mailbox, app):
    verified_user(client, mailbox)
    headers = bearer(login(client))
    with app.app_context():
        db.session.scalar(select(AuthSession)).expires_at = utcnow() - timedelta(seconds=1)
        db.session.commit()
    assert client.get("/auth/me", headers=headers).status_code == 401


def test_token_purposes_cannot_be_swapped(client, mailbox):
    register(client)
    verify = token_from_email(mailbox)
    assert client.post("/auth/reset-password", json={"token": verify, "password": NEW_PASSWORD}).status_code == 400
    client.post("/auth/forgot-password", json={"email": EMAIL})
    reset = token_from_email(mailbox)
    assert client.post("/auth/verify-email", json={"token": reset}).status_code == 400


@pytest.mark.parametrize("payload", [None, [], {}, {"email": "bad", "password": PASSWORD},
    {"email": EMAIL, "password": "short"}, {"email": EMAIL, "password": 123},
    {"email": EMAIL, "password": "x" * 129}, {"email": EMAIL, "password": PASSWORD, "name": " "},
])
def test_register_rejects_invalid_inputs(client, payload):
    assert client.post("/auth/register", json=payload).status_code in (400, 415)


@pytest.mark.parametrize("authorization", ["", "Basic abc", "Bearer invalid", "Bearer a b"])
def test_me_requires_valid_bearer_token(client, authorization):
    assert client.get("/auth/me", headers={"Authorization": authorization}).status_code == 401


def test_unknown_user_and_wrong_password_have_same_response(client, mailbox):
    unknown = login(client)
    register(client)
    wrong = login(client, "wrong-password")
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json == wrong.json


def test_mail_failure_rolls_back_registration(client, monkeypatch, app):
    def fail(*args):
        raise OSError("Delivery unavailable")
    monkeypatch.setattr("src.api.auth.service.send_email", fail)
    assert register(client).status_code == 503
    with app.app_context():
        assert db.session.scalar(select(User)) is None
        assert db.session.scalar(select(AuthToken)) is None


def test_concurrent_reset_consumes_token_once(client, mailbox, app):
    verified_user(client, mailbox)
    client.post("/auth/forgot-password", json={"email": EMAIL})
    token = token_from_email(mailbox)
    def reset(_):
        with app.test_client() as thread_client:
            return thread_client.post("/auth/reset-password", json={"token": token, "password": NEW_PASSWORD}).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(reset, range(2))) == [200, 400]


def test_reset_mail_failure_does_not_disclose_account(client, mailbox, monkeypatch, app):
    verified_user(client, mailbox)
    missing = client.post("/auth/forgot-password", json={"email": "missing@example.com"})
    def fail(*args):
        raise OSError("Delivery unavailable")
    monkeypatch.setattr("src.api.auth.service.send_email", fail)
    failed = client.post("/auth/forgot-password", json={"email": EMAIL})
    assert failed.status_code == missing.status_code == 202
    assert failed.json == missing.json
    with app.app_context():
        assert db.session.scalar(select(AuthToken).where(AuthToken.purpose == "reset_password")) is None


def test_file_email_contains_usable_verification_token(client, app, monkeypatch, tmp_path):
    monkeypatch.setattr(app, "instance_path", str(tmp_path))
    assert register(client).status_code == 201
    files = list((tmp_path / "mail").glob("*.eml"))
    assert len(files) == 1
    content = files[0].read_text()
    token = re.search(r"#token=([\w-]+)", content).group(1)
    assert client.post("/auth/verify-email", json={"token": token}).status_code == 200


def test_forged_email_token(client):
    assert client.post("/auth/verify-email", json={"token": "not-a-real-token"}).status_code == 400
    assert client.post("/auth/reset-password", json={"token": "not-a-real-token", "password": NEW_PASSWORD}).status_code == 400
