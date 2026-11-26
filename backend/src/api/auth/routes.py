from flask import Blueprint, g, jsonify

from ..extensions import limiter
from ..validation import json_body, text
from . import service
from .decorators import require_auth
from .validation import email_address, password

auth = Blueprint("auth", __name__, url_prefix="/auth")


@auth.post("/register")
@limiter.limit("5 per hour")
def register():
    body = json_body()
    user = service.register(email_address(body), password(body))
    return jsonify(
        user=user.to_dict(), message="Account created. Check your email to verify your account."
    ), 201


@auth.post("/login")
@limiter.limit("10 per minute")
def login():
    body = json_body()
    user, token, expires_at = service.login(
        email_address(body), text(body, "password", maximum=128)
    )
    return jsonify(
        user=user.to_dict(),
        session_token=token,
        token_type="Bearer",
        expires_at=expires_at.isoformat(),
    )


@auth.post("/logout")
@require_auth
def logout():
    # Stateless tokens are discarded by the client and remain valid until expiry.
    return "", 204


@auth.get("/me")
@require_auth
def me():
    return jsonify(user=service.authenticated_user(g.auth_claims).to_dict())


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
