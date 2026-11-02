from sqlalchemy.dialects.postgresql import insert

from ..auth.service import authenticated_user
from ..extensions import db
from ..models import UserProfile


def get_user_profile(claims):
    user = authenticated_user(claims)
    # Reading an unsaved profile does not insert an empty row.
    return db.session.get(UserProfile, user.id) or UserProfile(id=user.id)


def update_user_profile(claims, changes):
    user = authenticated_user(claims)
    if not changes:
        return db.session.get(UserProfile, user.id) or UserProfile(id=user.id)
    # One atomic upsert handles concurrent first saves. Update only supplied fields.
    statement = insert(UserProfile).values(id=user.id, **changes)
    statement = statement.on_conflict_do_update(
        index_elements=[UserProfile.id], set_=changes,
    ).returning(UserProfile)
    profile = db.session.scalar(statement, execution_options={"populate_existing": True})
    db.session.commit()
    return profile
