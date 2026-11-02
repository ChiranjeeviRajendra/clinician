"""Signed access tokens; validation never reads or writes the database."""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from flask import current_app

from .errors import AuthError


def issue_access_token(user_id):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    expires_at = now + timedelta(seconds=current_app.config["SESSION_TTL_SECONDS"])
    claims = {
        "sub": str(user_id), "iat": int(now.timestamp()), "nbf": int(now.timestamp()),
        "exp": int(expires_at.timestamp()), "jti": str(uuid.uuid4()), "token_type": "access",
        "iss": current_app.config["JWT_ISSUER"], "aud": current_app.config["JWT_AUDIENCE"],
    }
    return jwt.encode(claims, current_app.config["JWT_SECRET_KEY"], algorithm="HS256"), expires_at


def validate_access_token(raw):
    try:
        # Check signature, issuer, audience, and other claims before classifying expiry.
        claims = jwt.decode(
            raw, current_app.config["JWT_SECRET_KEY"], algorithms=["HS256"],
            issuer=current_app.config["JWT_ISSUER"], audience=current_app.config["JWT_AUDIENCE"],
            options={"require": ["sub", "iat", "nbf", "exp", "jti", "iss", "aud", "token_type"],
                     "verify_exp": False},
        )
        uuid.UUID(claims["sub"])
        uuid.UUID(claims["jti"])
        if (claims["token_type"] != "access" or
                any(type(claims[key]) is not int for key in ("iat", "nbf", "exp")) or
                claims["exp"] <= claims["iat"] or claims["nbf"] != claims["iat"]):
            raise ValueError("Invalid access-token claims")
    except (jwt.InvalidTokenError, ValueError, TypeError, AttributeError):
        raise AuthError("unauthorized", "You do not have access to the app. Please login to continue.", 401) from None
    now = datetime.now(timezone.utc).timestamp()
    effective_expiry = min(claims["exp"], claims["iat"] + current_app.config["SESSION_TTL_SECONDS"])
    if effective_expiry <= now:
        raise AuthError("session_expired", "Your login session expired. Please login to continue.", 401)
    claims["exp"] = effective_expiry
    return claims


def token_expiry(claims):
    return datetime.fromtimestamp(claims["exp"], timezone.utc).isoformat()
