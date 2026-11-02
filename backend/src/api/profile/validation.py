from decimal import Decimal

from ..auth.errors import AuthError
from ..models.profile import PROFILE_FIELDS
from .constants import ETHNICITIES


def profile_changes(body):
    """Omitted fields stay unchanged; null and blank strings clear a value."""
    if set(body) - set(PROFILE_FIELDS):
        raise AuthError("invalid_input", "Only profile detail fields can be updated.")
    changes = {}
    for field, value in body.items():
        if isinstance(value, str):
            value = value.strip()
            if not value:
                value = None
        if value is None:
            changes[field] = None
        elif field == "full_name":
            if not isinstance(value, str) or len(value) > 200:
                raise AuthError("invalid_input", "Full name must contain no more than 200 characters.")
            changes[field] = value
        elif field == "gender":
            if type(value) is not int or value not in (1, 2):
                raise AuthError("invalid_input", "Gender must be 1 (Male), 2 (Female), or blank.")
            changes[field] = value
        elif field == "ethnicity":
            if type(value) is not int or value not in ETHNICITIES:
                raise AuthError("invalid_input", "Choose a listed ethnicity or leave it blank.")
            changes[field] = value
        elif field == "age":
            if type(value) is not int or not 0 <= value <= 150:
                raise AuthError("invalid_input", "Age must be a whole number between 0 and 150.")
            changes[field] = value
        else:
            label, maximum = ("Height in cm", 300) if field == "height_cm" else ("Weight in kg", 1000)
            if type(value) not in (int, float):
                raise AuthError("invalid_input", f"{label} must be a number.")
            number = Decimal(str(value))
            if (not number.is_finite() or not 0 < number <= maximum
                    or number != number.quantize(Decimal("0.01"))):
                raise AuthError("invalid_input", f"{label} must be greater than 0 and at most {maximum}, with up to 2 decimal places.")
            changes[field] = number
    return changes
