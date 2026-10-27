"""Create the configured local database without changing existing databases."""
from pathlib import Path
import os

from dotenv import load_dotenv
import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url


def main():
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    raw = os.getenv("DATABASE_URL")
    if not raw:
        raise SystemExit("Add DATABASE_URL to backend/.env first.")
    url = make_url(raw)
    if url.get_backend_name() not in ("postgresql", "postgres"):
        raise SystemExit("DATABASE_URL must reference PostgreSQL.")
    name = url.database
    if not name or name in {"postgres", "template0", "template1"}:
        raise SystemExit("Use a dedicated application database name.")
    params = dict(url.query)
    params.update(host=url.host or "localhost", port=url.port or 5432,
                  user=url.username, password=url.password, dbname="postgres", connect_timeout=5)
    try:
        with psycopg.connect(**params, autocommit=True) as connection:
            exists = connection.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone()
            if exists:
                print("The configured application database already exists; no changes made.")
            else:
                connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
                print("Created the configured application database.")
    except psycopg.Error:
        raise SystemExit("Database creation failed. Check DATABASE_URL and the role's CREATEDB privilege.") from None


if __name__ == "__main__":
    main()
