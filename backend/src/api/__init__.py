"""Flask application factory for the HTTP API layer."""

from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request

from .config import load_config
from .database import configure_database_engine
from .errors import register_error_handlers
from .extensions import db, limiter, migrate


def create_app(test_config=None):
    root = Path(__file__).resolve().parents[2]
    load_dotenv(root / ".env")
    app = Flask(
        __name__, template_folder=None, static_folder=None, instance_path=str(root / "instance")
    )
    app.config.from_mapping(load_config())
    if test_config:
        app.config.update(test_config)
    if len(app.config["JWT_SECRET_KEY"].encode("utf-8")) < 32:
        raise ValueError(
            "Set JWT_SECRET_KEY to a persistent random secret of at least 32 bytes in backend/.env."
        )
    if app.config["SESSION_TTL_SECONDS"] <= 0:
        raise ValueError("SESSION_TTL_SECONDS must be positive.")
    if not app.config["SQLALCHEMY_DATABASE_URI"].startswith("postgresql+psycopg://"):
        raise ValueError("DATABASE_URL must use PostgreSQL with the psycopg driver.")

    db.init_app(app)
    with app.app_context():
        configure_database_engine(db.engine, app.config)
    migrate.init_app(app, db, directory=str(root / "migrations"))
    limiter.init_app(app)

    from .auth.routes import auth
    from .auth.session import session
    from .chat.routes import chat
    from .profile.routes import profile

    app.register_blueprint(auth)
    app.register_blueprint(chat)
    app.register_blueprint(profile)
    app.register_blueprint(session)
    register_error_handlers(app)

    @app.get("/")
    def service_info():
        return jsonify(service="clinician-api", status="ok")

    @app.after_request
    def auth_headers(response):
        if request.blueprint in {"auth", "session", "profile"}:
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
        return response

    return app
