"""Authenticate protected requests without loading account data."""

from functools import wraps

from flask import g, request

from ..errors import ApiError
from .jwt_tokens import validate_access_token


def require_auth(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        parts = request.headers.get("Authorization", "").split()
        if len(parts) != 2 or parts[0].lower() != "bearer" or len(parts[1]) > 4096:
            raise ApiError("unauthorized", "A Bearer session token is required.", 401)
        g.auth_claims = validate_access_token(parts[1])
        return view(*args, **kwargs)

    return wrapped
