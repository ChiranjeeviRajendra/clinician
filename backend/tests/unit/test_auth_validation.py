"""Validation errors are returned before any database or email work."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.api import create_app
from src.api.auth.errors import AuthError
from src.api.auth.validation import email_address, password
from src.api.extensions import db


@pytest.fixture
def validation_client(monkeypatch):
    app = create_app({"TESTING": True, "DATABASE_AUTH_MODE": "password", "RATELIMIT_ENABLED": False})
    monkeypatch.setattr(db.session, "rollback", Mock())
    services = {}
    for operation in ("register", "login", "forgot_password", "reset_password"):
        services[operation] = Mock()
        monkeypatch.setattr("src.api.auth.service." + operation, services[operation])
    return app.test_client(), services


@pytest.mark.parametrize("route", ["register", "login", "forgot-password"])
@pytest.mark.parametrize("email", [None, "", "   ", "doctor", "doctor@@example.com", "a..b@example.com", "doctor@localhost", 123, "x" * 255 + "@example.com"])
def test_invalid_email_is_identified_without_calling_services(validation_client, route, email):
    client, services = validation_client
    response = client.post("/auth/" + route, json={"email": email, "password": "12345678"})
    assert response.status_code == 400
    assert response.json == {"error": {"code": "invalid_email", "message": "Enter a valid email address."}}
    for service in services.values():
        service.assert_not_called()


@pytest.mark.parametrize("route", ["register", "reset-password"])
@pytest.mark.parametrize("value", ["", "short", "1234567"])
def test_short_password_has_specific_error_without_calling_services(validation_client, route, value):
    client, services = validation_client
    response = client.post("/auth/" + route, json={
        "email": "doctor@example.com", "token": "reset-token", "password": value,
    })
    assert response.status_code == 400
    assert response.json == {"error": {
        "code": "weak_password", "message": "Password is too weak. Use at least 8 characters.",
    }}
    for service in services.values():
        service.assert_not_called()


def test_eight_character_password_reaches_registration_service(validation_client):
    client, services = validation_client
    services["register"].return_value = SimpleNamespace(to_dict=lambda: {"email": "doctor@example.com"})
    response = client.post("/auth/register", json={"email": " Doctor@Example.com ", "password": "12345678"})
    assert response.status_code == 201
    services["register"].assert_called_once_with("doctor@example.com", "12345678")


def test_eight_character_password_reaches_reset_service(validation_client):
    client, services = validation_client
    response = client.post("/auth/reset-password", json={"token": "reset-token", "password": "12345678"})
    assert response.status_code == 200
    services["reset_password"].assert_called_once_with("reset-token", "12345678")


@pytest.mark.parametrize("value", ["12345678", "x" * 128, "😀" * 8])
def test_password_accepts_the_supported_length_boundaries(value):
    assert password({"password": value}) == value


@pytest.mark.parametrize("value", [None, 12345678, ["password"], "x" * 129])
def test_invalid_password_types_and_excessive_length_are_rejected(value):
    with pytest.raises(AuthError) as caught:
        password({"password": value})
    assert caught.value.code == "invalid_input"


def test_email_validation_normalizes_and_does_not_check_deliverability(monkeypatch):
    validator = Mock(return_value=SimpleNamespace(normalized="Doctor@example.com"))
    monkeypatch.setattr("src.api.auth.validation.validate_email", validator)
    assert email_address({"email": " Doctor@example.com "}) == "doctor@example.com"
    validator.assert_called_once_with("Doctor@example.com", check_deliverability=False)
