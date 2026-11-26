"""Request validation shared by all API resources."""

from flask import request

from .errors import ApiError


def json_body() -> dict:
    body = request.get_json()
    if not isinstance(body, dict):
        raise ApiError("invalid_input", "Request body must be a JSON object.")
    return body


def text(body, field: str, minimum: int = 1, maximum: int = 512) -> str:
    value = body.get(field)
    if not isinstance(value, str) or not minimum <= len(value) <= maximum:
        raise ApiError("invalid_input", f"{field} must contain {minimum} to {maximum} characters.")
    return value
