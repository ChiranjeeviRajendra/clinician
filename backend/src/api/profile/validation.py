from datetime import date, datetime, timezone
from decimal import Decimal

from ..errors import ApiError
from .constants import ETHNICITIES, PROFILE_FIELDS


def full_name(value) -> str:
    if not isinstance(value, str) or len(value) > 200:
        raise ApiError("invalid_input", "Full name must contain no more than 200 characters.")
    return value


def gender(value) -> int:
    if type(value) is not int or value not in (1, 2):
        raise ApiError("invalid_input", "Gender must be 1 (Male), 2 (Female), or blank.")
    return value


def ethnicity(value) -> int:
    if type(value) is not int or value not in ETHNICITIES:
        raise ApiError("invalid_input", "Choose a listed ethnicity or leave it blank.")
    return value


def date_of_birth(value) -> date:
    message = "Date of birth must be a valid date in YYYY-MM-DD format."
    if not isinstance(value, str):
        raise ApiError("invalid_input", message)
    try:
        birth_date = date.fromisoformat(value)
    except ValueError:
        raise ApiError("invalid_input", message) from None
    if birth_date.isoformat() != value:
        raise ApiError("invalid_input", message)
    if birth_date > datetime.now(timezone.utc).date():
        raise ApiError("invalid_input", "Date of birth cannot be in the future.")
    return birth_date


def measurement(value, label: str, maximum: int) -> Decimal:
    if type(value) not in (int, float):
        raise ApiError("invalid_input", f"{label} must be a number.")
    number = Decimal(str(value))
    if (
        not number.is_finite()
        or not 0 < number <= maximum
        or number != number.quantize(Decimal("0.01"))
    ):
        raise ApiError(
            "invalid_input",
            f"{label} must be greater than 0 and at most {maximum}, with up to 2 decimal places.",
        )
    return number


FIELD_VALIDATORS = {
    "full_name": full_name,
    "date_of_birth": date_of_birth,
    "gender": gender,
    "ethnicity": ethnicity,
    "height_cm": lambda value: measurement(value, "Height in cm", 300),
    "weight_kg": lambda value: measurement(value, "Weight in kg", 1000),
}


def profile_changes(body):
    """Omitted fields stay unchanged; null and blank strings clear a value."""
    if set(body) - set(PROFILE_FIELDS):
        raise ApiError("invalid_input", "Only profile detail fields can be updated.")
    changes = {}
    for field, value in body.items():
        if isinstance(value, str):
            value = value.strip()
            if not value:
                value = None
        changes[field] = None if value is None else FIELD_VALIDATORS[field](value)
    return changes
