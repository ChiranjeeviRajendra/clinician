import hashlib
import secrets
from datetime import timedelta
from smtplib import SMTPException

from flask import current_app
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

from ..extensions import db
from ..models import AuthSession, AuthToken, User
from ..models.auth import utcnow
from ..services.mail import send_email
from .errors import AuthError

# Keep unknown-user login work comparable to an incorrect password.
DUMMY_PASSWORD_HASH = generate_password_hash(secrets.token_urlsafe(32))


def hash_token(raw):
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue_token(user, purpose):
    now = utcnow()
    db.session.execute(update(AuthToken).where(
        AuthToken.user_id == user.id, AuthToken.purpose == purpose,
        AuthToken.consumed_at.is_(None),
    ).values(consumed_at=now))
    raw = secrets.token_urlsafe(32)
    ttl_key = "VERIFY_EMAIL_TTL_SECONDS" if purpose == "verify_email" else "RESET_PASSWORD_TTL_SECONDS"
    db.session.add(AuthToken(user_id=user.id, token_hash=hash_token(raw), purpose=purpose,
                             expires_at=now + timedelta(seconds=current_app.config[ttl_key])))
    return raw


def email_token(user, purpose, raw):
    label = "Verify your email" if purpose == "verify_email" else "Reset your password"
    path = "verify-email" if purpose == "verify_email" else "reset-password"
    # Fragments keep the credential out of frontend HTTP access logs/referrers.
    link = f"{current_app.config['FRONTEND_URL']}/{path}#token={raw}"
    send_email(user.email, f"Clinician: {label}",
               f"{label} using this single-use link:\n\n{link}\n\n"
               "If you did not request this, you can ignore this email.")


def register(email, password, name=None):
    user = User(email=email, name=name, password_hash=generate_password_hash(password))
    db.session.add(user)
    try:
        db.session.flush()
    except IntegrityError as error:
        db.session.rollback()
        if getattr(error.orig, "sqlstate", None) == "23505":
            raise AuthError("email_in_use", "An account with this email already exists.", 409) from None
        raise
    raw = issue_token(user, "verify_email")
    email_token(user, "verify_email", raw)
    db.session.commit()
    return user


def login(email, password):
    # Serialize password changes and login so a reset cannot leave a racing session valid.
    user = db.session.scalar(select(User).where(User.email == email).with_for_update())
    password_hash = user.password_hash if user else DUMMY_PASSWORD_HASH
    valid = check_password_hash(password_hash, password)
    if not user or not valid:
        raise AuthError("invalid_credentials", "Invalid email or password.", 401)
    if user.email_verified_at is None:
        raise AuthError("email_not_verified", "Verify your email before logging in.", 403)
    raw = secrets.token_urlsafe(32)
    now = utcnow()
    session = AuthSession(user_id=user.id, token_hash=hash_token(raw),
                          created_at=now,
                          expires_at=now + timedelta(seconds=current_app.config["SESSION_TTL_SECONDS"]))
    db.session.add(session)
    db.session.commit()
    return user, raw, session.expires_at


def authenticated_session(raw):
    now = utcnow()
    session = db.session.scalar(select(AuthSession).where(
        AuthSession.token_hash == hash_token(raw),
        AuthSession.revoked_at.is_(None), AuthSession.expires_at > now,
        # Apply the configured maximum age to sessions issued before a TTL change.
        AuthSession.created_at > now - timedelta(seconds=current_app.config["SESSION_TTL_SECONDS"]),
    ))
    if session is None:
        raise AuthError("unauthorized", "A valid session is required.", 401)
    return session, db.session.get(User, session.user_id)


def usable_token(raw, purpose):
    token = db.session.scalar(select(AuthToken).where(
        AuthToken.token_hash == hash_token(raw), AuthToken.purpose == purpose,
    ))
    if token is None:
        raise AuthError("invalid_token", "The token is invalid or has expired.")
    # Every token operation locks the user first, then refreshes the token after waiting.
    user = db.session.scalar(select(User).where(User.id == token.user_id).with_for_update())
    db.session.refresh(token, with_for_update=True)
    if token.consumed_at is not None or token.expires_at <= utcnow():
        raise AuthError("invalid_token", "The token is invalid or has expired.")
    return user, token


def verify_email(raw):
    user, token = usable_token(raw, "verify_email")
    user.email_verified_at = utcnow()
    token.consumed_at = utcnow()
    db.session.commit()


def forgot_password(email):
    user = db.session.scalar(select(User).where(User.email == email).with_for_update())
    if user:
        raw = issue_token(user, "reset_password")
        try:
            email_token(user, "reset_password", raw)
        except (SMTPException, OSError):
            db.session.rollback()
            current_app.logger.error("Password-reset email delivery failed.")
            return
    db.session.commit()


def reset_password(raw, password):
    user, token = usable_token(raw, "reset_password")
    user.password_hash = generate_password_hash(password)
    now = utcnow()
    token.consumed_at = now
    db.session.execute(update(AuthToken).where(
        AuthToken.user_id == user.id, AuthToken.purpose == "reset_password",
        AuthToken.consumed_at.is_(None),
    ).values(consumed_at=now))
    db.session.execute(update(AuthSession).where(
        AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None),
    ).values(revoked_at=now))
    db.session.commit()
