"""Registration and serialization no longer expose a user display-name field."""
import uuid
from unittest.mock import Mock

from src.api import create_app
from src.api.models import User
from src.api.models.auth import utcnow


def test_user_model_and_response_have_no_name():
    user = User(id=uuid.uuid4(), email="doctor@example.com", password_hash="not-returned",
                created_at=utcnow())
    assert "name" not in User.__table__.columns
    assert set(user.to_dict()) == {"id", "email", "email_verified", "created_at"}


def test_registration_requires_only_email_and_password(monkeypatch):
    app = create_app({"TESTING": True, "DATABASE_AUTH_MODE": "password", "RATELIMIT_ENABLED": False})
    user = User(id=uuid.uuid4(), email="doctor@example.com", password_hash="not-returned",
                created_at=utcnow())
    register = Mock(return_value=user)
    monkeypatch.setattr("src.api.auth.service.register", register)
    response = app.test_client().post("/auth/register", json={
        "email": "doctor@example.com", "password": "a-long-test-password",
    })
    assert response.status_code == 201
    register.assert_called_once_with("doctor@example.com", "a-long-test-password")
    assert "name" not in response.json["user"]
