"""Public API errors and consistent JSON responses at the HTTP boundary."""

from smtplib import SMTPException

from flask import jsonify, request
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import HTTPException

from .extensions import db


class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def api_error(error):
        db.session.rollback()
        payload = {"error": {"code": error.code, "message": error.message}}
        if request.endpoint == "session.authenticate" and error.status == 401:
            payload["status"] = "expired" if error.code == "session_expired" else "invalid"
        return jsonify(payload), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(
            error={
                "code": error.name.lower().replace(" ", "_"),
                "message": error.description,
            }
        ), error.code

    @app.errorhandler(SQLAlchemyError)
    def database_error(error):
        db.session.rollback()
        app.logger.error("Database operation failed (%s)", type(error).__name__)
        return jsonify(
            error={
                "code": "service_unavailable",
                "message": "The database is temporarily unavailable.",
            }
        ), 503

    @app.errorhandler(SMTPException)
    @app.errorhandler(OSError)
    def mail_error(error):
        db.session.rollback()
        app.logger.error("Mail delivery failed (%s)", type(error).__name__)
        return jsonify(
            error={
                "code": "mail_unavailable",
                "message": "Email could not be sent. Please try again.",
            }
        ), 503
