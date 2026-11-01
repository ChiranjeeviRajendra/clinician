"""Create the configured database without changing existing databases."""
from pathlib import Path
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from src.api.config import load_config
from src.api.database import configure_database_engine


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
    settings = load_config()
    admin_url = make_url(settings["SQLALCHEMY_DATABASE_URI"]).set(database="postgres")
    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT", pool_pre_ping=True,
                           connect_args={"connect_timeout": 5})
    configure_database_engine(engine, settings)
    try:
        with engine.connect() as connection:
            exists = connection.execute(text("SELECT 1 FROM pg_database WHERE datname = :name"),
                                        {"name": name}).fetchone()
            if exists:
                print("The configured application database already exists; no changes made.")
            else:
                quoted_name = engine.dialect.identifier_preparer.quote_identifier(name)
                connection.exec_driver_sql("CREATE DATABASE " + quoted_name)
                print("Created the configured application database.")
    except SQLAlchemyError:
        raise SystemExit("Database creation failed. Check DATABASE_URL, AWS credentials for IAM mode, "
                         "and the role's CREATEDB privilege.") from None
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
