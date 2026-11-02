from email_validator import EmailNotValidError, validate_email
from flask import request

from .errors import AuthError


def json_body():
    body = request.get_json()
    if not isinstance(body, dict):
        raise AuthError("invalid_input", "Request body must be a JSON object.")
    return body


def text(body, field, minimum=1, maximum=512):
    value = body.get(field)
    if not isinstance(value, str) or not minimum <= len(value) <= maximum:
        raise AuthError("invalid_input", f"{field} must contain {minimum} to {maximum} characters.")
    return value


def email_address(body):
    value = body.get("email")
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 254:
        raise AuthError("invalid_email", "Enter a valid email address.")
    try:
        return validate_email(value.strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise AuthError("invalid_email", "Enter a valid email address.") from None


def password(body):
    value = body.get("password")
    if not isinstance(value, str):
        raise AuthError("invalid_input", "Password must be a string.")
    if len(value) < 8:
        raise AuthError("weak_password", "Password is too weak. Use at least 8 characters.")
    if len(value) > 128:
        raise AuthError("invalid_input", "Password must contain no more than 128 characters.")
    return value
