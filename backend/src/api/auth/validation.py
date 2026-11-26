from email_validator import EmailNotValidError, validate_email

from ..errors import ApiError


def email_address(body):
    value = body.get("email")
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 254:
        raise ApiError("invalid_email", "Enter a valid email address.")
    try:
        return validate_email(value.strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise ApiError("invalid_email", "Enter a valid email address.") from None


def password(body):
    value = body.get("password")
    if not isinstance(value, str):
        raise ApiError("invalid_input", "Password must be a string.")
    if len(value) < 8:
        raise ApiError("weak_password", "Password is too weak. Use at least 8 characters.")
    if len(value) > 128:
        raise ApiError("invalid_input", "Password must contain no more than 128 characters.")
    return value
