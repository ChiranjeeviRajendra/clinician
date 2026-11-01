"""Session expiry and revocation classifications without a database connection."""
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.api import create_app
from src.api.auth.errors import AuthError
from src.api.auth.service import authenticated_session
from src.api.extensions import db
from src.api.models.auth import utcnow


@pytest.fixture
def context():
    app = create_app({"TESTING": True, "DATABASE_AUTH_MODE": "password", "RATELIMIT_ENABLED": False})
    with app.app_context():
        yield


@pytest.mark.parametrize("state,expected", [
    ("unknown", "unauthorized"), ("revoked", "unauthorized"),
    ("expired", "session_expired"), ("maximum_age", "session_expired"),
    ("revoked_and_expired", "unauthorized"),
])
def test_rejected_session_reason(context, monkeypatch, state, expected):
    now = utcnow()
    row = SimpleNamespace(user_id="doctor", revoked_at=None, created_at=now,
                          expires_at=now + timedelta(hours=1))
    if "revoked" in state:
        row.revoked_at = now
    if "expired" in state:
        row.expires_at = now - timedelta(seconds=1)
    if state == "maximum_age":
        row.created_at = now - timedelta(hours=13)
    monkeypatch.setattr(db.session, "scalar", Mock(return_value=None if state == "unknown" else row))
    get_user = Mock()
    monkeypatch.setattr(db.session, "get", get_user)
    with pytest.raises(AuthError) as caught:
        authenticated_session("opaque-token")
    assert caught.value.code == expected
    assert caught.value.status == 401
    get_user.assert_not_called()


def test_valid_session_returns_its_user(context, monkeypatch):
    now = utcnow()
    row = SimpleNamespace(user_id="doctor", revoked_at=None, created_at=now,
                          expires_at=now + timedelta(hours=1))
    user = object()
    monkeypatch.setattr(db.session, "scalar", Mock(return_value=row))
    monkeypatch.setattr(db.session, "get", Mock(return_value=user))
    assert authenticated_session("opaque-token") == (row, user)
