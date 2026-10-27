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
    value = text(body, "email", maximum=254).strip()
    try:
        return validate_email(value, check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise AuthError("invalid_input", "A valid email address is required.") from None


def password(body):
    return text(body, "password", minimum=12, maximum=128)
