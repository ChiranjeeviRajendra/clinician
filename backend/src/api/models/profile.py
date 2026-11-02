import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, Numeric, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import db
from ..profile.constants import ETHNICITIES


PROFILE_FIELDS = ("full_name", "date_of_birth", "gender", "height_cm", "weight_kg", "ethnicity")


class UserProfile(db.Model):
    __tablename__ = "user_profile"
    __table_args__ = (
        CheckConstraint("height_cm > 0 AND height_cm <= 300", name="valid_height_cm"),
        CheckConstraint("weight_kg > 0 AND weight_kg <= 1000", name="valid_weight_kg"),
        CheckConstraint("gender IN (1, 2)", name="valid_gender"),
        CheckConstraint("ethnicity > 0", name="valid_ethnicity"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True,
    )
    full_name: Mapped[str | None] = mapped_column(String(200))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[int | None] = mapped_column(SmallInteger)
    height_cm: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    ethnicity: Mapped[int | None] = mapped_column(Integer)

    @property
    def is_profile_completed(self):
        return all(
            value is not None and (not isinstance(value, str) or bool(value.strip()))
            for value in (getattr(self, field) for field in PROFILE_FIELDS)
        )

    def to_dict(self):
        return {
            "id": str(self.id),
            "full_name": self.full_name,
            "date_of_birth": self.date_of_birth.isoformat() if self.date_of_birth is not None else None,
            "gender": self.gender,
            "height_cm": float(self.height_cm) if self.height_cm is not None else None,
            "weight_kg": float(self.weight_kg) if self.weight_kg is not None else None,
            "ethnicity": self.ethnicity,
            "ethnicity_name": ETHNICITIES.get(self.ethnicity),
            "isProfileCompleted": self.is_profile_completed,
        }
