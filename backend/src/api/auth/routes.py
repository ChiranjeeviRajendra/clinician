from functools import wraps

from flask import Blueprint, g, jsonify, request

from ..extensions import db, limiter
from ..models.auth import utcnow
from . import service
from .errors import AuthError
from .validation import email_address, json_body, password, text

auth = Blueprint("auth", __name__, url_prefix="/auth")


def require_auth(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        parts = request.headers.get("Authorization", "").split()
        if len(parts) != 2 or parts[0].lower() != "bearer" or len(parts[1]) > 512:
            raise AuthError("unauthorized", "A Bearer session token is required.", 401)
        g.auth_session, g.user = service.authenticated_session(parts[1])
        return view(*args, **kwargs)
    return wrapped


@auth.post("/register")
@limiter.limit("5 per hour")
def register():
    body = json_body()
    name = None
    if "name" in body:
        name = text(body, "name", maximum=100).strip()
        if not name:
            raise AuthError("invalid_input", "name must not be blank.")
    user = service.register(email_address(body), password(body), name)
    return jsonify(user=user.to_dict(), message="Account created. Check your email to verify your account."), 201


@auth.post("/login")
@limiter.limit("10 per minute")
def login():
    body = json_body()
    user, token, expires_at = service.login(email_address(body), text(body, "password", maximum=128))
    return jsonify(user=user.to_dict(), session_token=token, token_type="Bearer",
                   expires_at=expires_at.isoformat())


@auth.post("/logout")
@require_auth
def logout():
    g.auth_session.revoked_at = utcnow()
    db.session.commit()
    return "", 204


@auth.get("/me")
@require_auth
def me():
    return jsonify(user=g.user.to_dict())


@auth.post("/verify-email")
@limiter.limit("10 per minute")
def verify_email():
    service.verify_email(text(json_body(), "token"))
    return jsonify(message="Email verified. You can now log in.")


@auth.post("/forgot-password")
@limiter.limit("5 per hour")
def forgot_password():
    service.forgot_password(email_address(json_body()))
    return jsonify(message="If an account exists, you will receive a password-reset email."), 202


@auth.post("/reset-password")
@limiter.limit("10 per minute")
def reset_password():
    body = json_body()
    service.reset_password(text(body, "token"), password(body))
    return jsonify(message="Password reset. Please log in again.")
