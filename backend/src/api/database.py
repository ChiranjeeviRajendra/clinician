"""Database connection authentication shared by Flask and setup commands."""
from pathlib import Path
from threading import Lock

import certifi
from sqlalchemy import event
from sqlalchemy.exc import OperationalError


def configure_database_engine(engine, config):
    mode = config.get("DATABASE_AUTH_MODE", "password")
    if mode not in {"password", "iam"}:
        raise ValueError("DATABASE_AUTH_MODE must be password or iam.")
    if mode == "password":
        return
    if engine.url.drivername != "postgresql+psycopg" or not engine.url.host or not engine.url.username:
        raise ValueError("IAM DATABASE_URL must specify a PostgreSQL psycopg hostname and username.")

    root_cert = config.get("DATABASE_SSL_ROOT_CERT")
    if root_cert:
        path = Path(root_cert).expanduser()
        if not path.is_absolute():
            path = Path(__file__).resolve().parents[2] / path
        if not path.is_file():
            raise ValueError("DATABASE_SSL_ROOT_CERT must point to an existing CA bundle.")
        root_cert = str(path)

    client = None
    client_lock = Lock()

    @event.listens_for(engine, "do_connect")
    def provide_iam_token(dialect, connection_record, args, params):
        # Resolve credentials only when a connection is requested. Boto3's standard
        # chain supports AWS_PROFILE, SSO, environment credentials, and IAM roles.
        import boto3
        from botocore.exceptions import BotoCoreError, ClientError

        nonlocal client
        try:
            with client_lock:
                if client is None:
                    client = boto3.Session().client("rds", region_name=config.get("AWS_REGION"))
            params["password"] = client.generate_db_auth_token(
                DBHostname=params["host"], Port=int(params.get("port", 5432)),
                DBUsername=params["user"], Region=client.meta.region_name,
            )
        except (BotoCoreError, ClientError) as error:
            # Credential-provider errors must follow the same safe 503 path as
            # database failures. Never propagate AWS credentials or signed tokens.
            reason = RuntimeError(
                f"AWS IAM database authentication failed ({type(error).__name__}). "
                "Check AWS credentials, profile login, and region."
            )
            raise OperationalError(None, None, reason) from None

        params["sslmode"] = "verify-full"
        # Express gateways use public AWS root CAs. Standard RDS instances can
        # supply their RDS CA bundle through the config or URL instead.
        params["sslrootcert"] = root_cert or params.get("sslrootcert") or certifi.where()
        params.setdefault("connect_timeout", 10)
