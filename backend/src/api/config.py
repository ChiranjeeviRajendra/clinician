import os


def load_config():
    database_url = os.getenv(
        "DATABASE_URL", "postgresql+psycopg://clinician:clinician@localhost:5432/clinician"
    )
    for prefix in ("postgres://", "postgresql://"):
        if database_url.startswith(prefix):
            database_url = database_url.replace(prefix, "postgresql+psycopg://", 1)
    return {
        "DATABASE_AUTH_MODE": os.getenv("DATABASE_AUTH_MODE", "password").strip().lower(),
        "AWS_REGION": os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION"),
        "DATABASE_SSL_ROOT_CERT": os.getenv("DATABASE_SSL_ROOT_CERT", ""),
        "SQLALCHEMY_DATABASE_URI": database_url,
        "SQLALCHEMY_TRACK_MODIFICATIONS": False,
        "SQLALCHEMY_ENGINE_OPTIONS": {"pool_pre_ping": True},
        "MAX_CONTENT_LENGTH": 16 * 1024,
        "SESSION_TTL_SECONDS": int(os.getenv("SESSION_TTL_SECONDS", "43200")),
        "JWT_SECRET_KEY": os.getenv("JWT_SECRET_KEY", ""),
        "JWT_ISSUER": os.getenv("JWT_ISSUER", "clinician-api"),
        "JWT_AUDIENCE": os.getenv("JWT_AUDIENCE", "clinician-web"),
        "VERIFY_EMAIL_TTL_SECONDS": int(os.getenv("VERIFY_EMAIL_TTL_SECONDS", "86400")),
        "RESET_PASSWORD_TTL_SECONDS": int(os.getenv("RESET_PASSWORD_TTL_SECONDS", "1800")),
        "FRONTEND_URL": os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/"),
        "MAIL_BACKEND": os.getenv("MAIL_BACKEND", "file"),
        "MAIL_FROM": os.getenv("MAIL_FROM", "Clinician <noreply@clinician.local>"),
        "SMTP_HOST": os.getenv("SMTP_HOST", "localhost"),
        "SMTP_PORT": int(os.getenv("SMTP_PORT", "1025")),
        "SMTP_USERNAME": os.getenv("SMTP_USERNAME", ""),
        "SMTP_PASSWORD": os.getenv("SMTP_PASSWORD", ""),
        "SMTP_STARTTLS": os.getenv("SMTP_STARTTLS", "false").lower() == "true",
        "RATELIMIT_STORAGE_URI": os.getenv("RATELIMIT_STORAGE_URI", "memory://"),
    }
