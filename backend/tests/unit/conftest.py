"""Unit tests must use doubles instead of opening a PostgreSQL connection."""

import psycopg
import pytest


@pytest.fixture(autouse=True)
def prevent_database_connections(monkeypatch):
    def fail_connection(*args, **kwargs):
        pytest.fail("Unit tests must mock database access; a real connection was attempted.")

    monkeypatch.setattr(psycopg, "connect", fail_connection)
