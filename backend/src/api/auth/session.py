"""Session validation and account information for the application shell."""

from flask import Blueprint, g, jsonify

from .decorators import require_auth
from .jwt_tokens import token_expiry
from .service import authenticated_user

session = Blueprint("session", __name__)


@session.get("/userInfo")
@require_auth
def user_info():
    user = authenticated_user(g.auth_claims)
    return jsonify(
        email=user.email,
        email_verified=user.email_verified_at is not None,
        expires_at=token_expiry(g.auth_claims),
    )


@session.get("/authenticate")
@require_auth
def authenticate():
    return jsonify(status="valid", expires_at=token_expiry(g.auth_claims))
