"""Flask application factory for the HTTP API layer."""

from pathlib import Path
from smtplib import SMTPException

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import HTTPException

from .config import load_config
from .database import configure_database_engine
from .extensions import db, limiter, migrate


def create_app(test_config=None):
    root = Path(__file__).resolve().parents[2]
    load_dotenv(root / ".env")
    app = Flask(__name__, template_folder=None, static_folder=None,
                instance_path=str(root / "instance"))
    app.config.from_mapping(load_config())
    if test_config:
        app.config.update(test_config)
    if len(app.config["JWT_SECRET_KEY"].encode("utf-8")) < 32:
        raise ValueError("Set JWT_SECRET_KEY to a persistent random secret of at least 32 bytes in backend/.env.")
    if app.config["SESSION_TTL_SECONDS"] <= 0:
        raise ValueError("SESSION_TTL_SECONDS must be positive.")
    if not app.config["SQLALCHEMY_DATABASE_URI"].startswith("postgresql+psycopg://"):
        raise ValueError("DATABASE_URL must use PostgreSQL with the psycopg driver.")

    db.init_app(app)
    with app.app_context():
        configure_database_engine(db.engine, app.config)
    migrate.init_app(app, db, directory=str(root / "migrations"))
    limiter.init_app(app)

    from . import models  # Register metadata for migrations.
    from .auth.routes import auth, require_auth
    from .chat.routes import chat
    from .profile.routes import profile
    from .auth.errors import AuthError
    from .auth.jwt_tokens import token_expiry
    from .auth.service import authenticated_user

    app.register_blueprint(auth)
    app.register_blueprint(chat)
    app.register_blueprint(profile)

    @app.get("/")
    def service_info():
        return jsonify(service="clinician-api", status="ok")

    @app.get("/userInfo")
    @require_auth
    def user_info():
        user = authenticated_user(g.auth_claims)
        return jsonify(email=user.email, email_verified=user.email_verified_at is not None,
                       expires_at=token_expiry(g.auth_claims))

    @app.get("/authenticate")
    @require_auth
    def authenticate():
        return jsonify(status="valid", expires_at=token_expiry(g.auth_claims))

    @app.errorhandler(AuthError)
    def auth_error(error):
        db.session.rollback()
        payload = {"error": {"code": error.code, "message": error.message}}
        if request.path == "/authenticate" and error.status == 401:
            payload["status"] = "expired" if error.code == "session_expired" else "invalid"
        return jsonify(payload), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error={"code": error.name.lower().replace(" ", "_"),
                              "message": error.description}), error.code

    @app.errorhandler(SQLAlchemyError)
    def database_error(error):
        db.session.rollback()
        app.logger.error("Database operation failed (%s)", type(error).__name__)
        return jsonify(error={"code": "service_unavailable",
                              "message": "The database is temporarily unavailable."}), 503

    @app.errorhandler(SMTPException)
    @app.errorhandler(OSError)
    def mail_error(error):
        db.session.rollback()
        app.logger.error("Mail delivery failed (%s)", type(error).__name__)
        return jsonify(error={"code": "mail_unavailable",
                              "message": "Email could not be sent. Please try again."}), 503

    @app.after_request
    def auth_headers(response):
        if request.path.startswith("/auth/") or request.path in (
            "/userInfo", "/authenticate", "/getUserProfile", "/updateUserProfile",
            "/getEthnicities",
        ):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
        return response

    return app

