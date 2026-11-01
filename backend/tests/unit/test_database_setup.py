"""The setup command must use IAM too, without running cloud database writes."""
import importlib.util
from pathlib import Path
from unittest.mock import Mock

import pytest
from sqlalchemy.dialects.postgresql import dialect


@pytest.mark.parametrize("exists", [False, True])
def test_setup_uses_shared_iam_hook_and_quotes_database_name(monkeypatch, exists):
    path = Path(__file__).resolve().parents[2] / "scripts" / "create_database.py"
    spec = importlib.util.spec_from_file_location("database_setup", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setenv("DATABASE_URL", 'postgresql+psycopg://postgres@database.example.com/a"db')
    monkeypatch.setenv("DATABASE_AUTH_MODE", "iam")
    connection = Mock()
    connection.execute.return_value.fetchone.return_value = (1,) if exists else None
    engine = Mock()
    engine.connect.return_value.__enter__ = Mock(return_value=connection)
    engine.connect.return_value.__exit__ = Mock(return_value=False)
    engine.dialect = dialect()
    factory = Mock(return_value=engine)
    hook = Mock()
    monkeypatch.setattr(module, "create_engine", factory)
    monkeypatch.setattr(module, "configure_database_engine", hook)
    module.main()
    assert factory.call_args.args[0].database == "postgres"
    assert factory.call_args.kwargs["isolation_level"] == "AUTOCOMMIT"
    assert hook.call_args.args[1]["DATABASE_AUTH_MODE"] == "iam"
    assert connection.execute.call_args.args[1] == {"name": 'a"db'}
    if exists:
        connection.exec_driver_sql.assert_not_called()
    else:
        connection.exec_driver_sql.assert_called_once_with('CREATE DATABASE "a""db"')
    engine.dispose.assert_called_once()
