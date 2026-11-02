import pytest


@pytest.fixture(autouse=True)
def jwt_test_configuration(monkeypatch):
    # Never use the deployment's signing secret in tests.
    monkeypatch.setenv("JWT_SECRET_KEY", "unit-tests-only-signing-secret-0123456789abcdef-0123456789abcdef")
    monkeypatch.setenv("JWT_ISSUER", "clinician-api")
    monkeypatch.setenv("JWT_AUDIENCE", "clinician-web")
