"""Exercise physical connection hooks without AWS or PostgreSQL network calls."""
from types import SimpleNamespace
from unittest.mock import Mock

import boto3
import certifi
import pytest
from botocore.exceptions import NoCredentialsError, NoRegionError, TokenRetrievalError
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError

from src.api import create_app
from src.api.config import load_config
from src.api.database import configure_database_engine
from src.api.extensions import db


URL = "postgresql+psycopg://postgres@database.example.com:5432/clinician"


@pytest.fixture
def aws(monkeypatch):
    client = Mock()
    client.meta.region_name = "ap-southeast-2"
    client.generate_db_auth_token.side_effect = ["fresh-token-1", "fresh-token-2"]
    session = Mock()
    session.client.return_value = client
    factory = Mock(return_value=session)
    monkeypatch.setattr(boto3, "Session", factory)
    return SimpleNamespace(client=client, session=session, factory=factory)


def fake_database(engine, monkeypatch):
    # Skip dialect discovery SQL while retaining SQLAlchemy's real pool/events.
    monkeypatch.setattr(engine.dialect, "initialize", Mock())
    connect = Mock(side_effect=[Mock(), Mock()])
    monkeypatch.setattr(engine.dialect, "connect", connect)
    return connect


def test_fresh_tokens_on_new_connections_but_not_pool_reuse(aws, monkeypatch):
    engine = create_engine(URL + "?application_name=clinician&sslmode=require")
    configure_database_engine(engine, {"DATABASE_AUTH_MODE": "iam", "AWS_REGION": "ap-southeast-2"})
    connect = fake_database(engine, monkeypatch)
    aws.factory.assert_not_called()
    try:
        with engine.connect():
            pass
        with engine.connect():
            pass
        assert connect.call_count == 1
        assert aws.client.generate_db_auth_token.call_count == 1
        engine.dispose()
        with engine.connect():
            pass
        assert connect.call_count == 2
        assert aws.client.generate_db_auth_token.call_count == 2
        assert connect.call_args_list[0].kwargs["password"] == "fresh-token-1"
        assert connect.call_args_list[1].kwargs["password"] == "fresh-token-2"
        params = connect.call_args.kwargs
        assert params["application_name"] == "clinician"
        assert params["sslmode"] == "verify-full"
        assert params["sslrootcert"] == certifi.where()
        assert params["connect_timeout"] == 10
        assert engine.url.password is None
        aws.session.client.assert_called_once_with("rds", region_name="ap-southeast-2")
        aws.client.generate_db_auth_token.assert_called_with(
            DBHostname="database.example.com", Port=5432, DBUsername="postgres", Region="ap-southeast-2",
        )
    finally:
        engine.dispose()


def test_signs_actual_connection_parameters_and_preserves_custom_ca(aws, monkeypatch, tmp_path):
    ca = tmp_path / "rds-ca.pem"
    ca.write_text("test CA file")
    engine = create_engine(URL, connect_args={
        "host": "actual.example.com", "port": 5444, "user": "iam_user",
        "connect_timeout": 5, "sslrootcert": "another-ca.pem",
    })
    configure_database_engine(engine, {"DATABASE_AUTH_MODE": "iam", "DATABASE_SSL_ROOT_CERT": str(ca)})
    connect = fake_database(engine, monkeypatch)
    try:
        with engine.connect():
            pass
        aws.client.generate_db_auth_token.assert_called_once_with(
            DBHostname="actual.example.com", Port=5444, DBUsername="iam_user", Region="ap-southeast-2",
        )
        assert connect.call_args.kwargs["sslrootcert"] == str(ca)
        assert connect.call_args.kwargs["connect_timeout"] == 5
    finally:
        engine.dispose()


def test_password_mode_does_not_use_aws_or_change_local_connection(aws, monkeypatch):
    engine = create_engine("postgresql+psycopg://local:local-password@localhost/clinician")
    configure_database_engine(engine, {"DATABASE_AUTH_MODE": "password"})
    connect = fake_database(engine, monkeypatch)
    try:
        with engine.connect():
            pass
        assert connect.call_args.kwargs["password"] == "local-password"
        assert "sslrootcert" not in connect.call_args.kwargs
        aws.factory.assert_not_called()
    finally:
        engine.dispose()


def test_failed_aws_client_initialization_can_recover_on_the_next_connection(aws, monkeypatch):
    engine = create_engine(URL)
    configure_database_engine(engine, {"DATABASE_AUTH_MODE": "iam"})
    connect = fake_database(engine, monkeypatch)
    aws.session.client.side_effect = NoCredentialsError()
    try:
        with pytest.raises(OperationalError):
            engine.connect()
        connect.assert_not_called()
        aws.session.client.side_effect = None
        with engine.connect():
            pass
        assert connect.call_args.kwargs["password"] == "fresh-token-1"
    finally:
        engine.dispose()


@pytest.mark.parametrize("failure", [
    NoCredentialsError(), NoRegionError(), TokenRetrievalError(provider="SSO", error_msg="private details"),
])
def test_aws_credential_errors_use_safe_database_error_path(aws, monkeypatch, failure):
    aws.client.generate_db_auth_token.side_effect = failure
    engine = create_engine(URL)
    configure_database_engine(engine, {"DATABASE_AUTH_MODE": "iam"})
    connect = fake_database(engine, monkeypatch)
    try:
        with pytest.raises(OperationalError) as caught:
            engine.connect()
        assert type(failure).__name__ in str(caught.value)
        assert "private details" not in str(caught.value)
        connect.assert_not_called()
    finally:
        engine.dispose()


def test_flask_registers_iam_for_app_and_migration_engine_without_contacting_aws(aws):
    app = create_app({
        "TESTING": True, "DATABASE_AUTH_MODE": "iam", "AWS_REGION": "ap-southeast-2",
        "SQLALCHEMY_DATABASE_URI": URL, "RATELIMIT_ENABLED": False,
    })
    aws.factory.assert_not_called()
    client = app.test_client()
    assert client.get("/").status_code == 200
    assert client.get("/userInfo").status_code == 401
    aws.client.generate_db_auth_token.side_effect = NoCredentialsError()
    import uuid
    from src.api.auth.jwt_tokens import issue_access_token
    with app.app_context():
        token, _ = issue_access_token(uuid.uuid4())
    # A valid JWT succeeds without AWS; account data still needs the database.
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/authenticate", headers=headers).status_code == 200
    response = client.get("/userInfo", headers=headers)
    assert response.status_code == 503
    assert "AWS" not in response.get_data(as_text=True)
    with app.app_context():
        assert app.extensions["migrate"].db.engine is db.engine
        assert db.engine.pool._pre_ping is True
        db.engine.dispose()


@pytest.mark.parametrize("settings", [
    {"DATABASE_AUTH_MODE": "invalid"},
    {"DATABASE_AUTH_MODE": "iam", "DATABASE_SSL_ROOT_CERT": "missing-ca-file.pem"},
])
def test_invalid_database_settings_fail_at_startup(settings):
    engine = create_engine(URL)
    try:
        with pytest.raises(ValueError):
            configure_database_engine(engine, settings)
    finally:
        engine.dispose()


def test_database_auth_settings_and_default_region(monkeypatch):
    monkeypatch.setenv("DATABASE_AUTH_MODE", " IAM ")
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-southeast-2")
    settings = load_config()
    assert settings["DATABASE_AUTH_MODE"] == "iam"
    assert settings["AWS_REGION"] == "ap-southeast-2"
