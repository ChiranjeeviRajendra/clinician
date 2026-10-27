import smtplib
import uuid
from email.message import EmailMessage
from pathlib import Path

from flask import current_app


def send_email(recipient, subject, body):
    config = current_app.config
    message = EmailMessage()
    message["From"] = config["MAIL_FROM"]
    message["To"] = recipient
    message["Subject"] = subject
    # Keep local .eml token links readable without quoted-printable line wrapping.
    message.set_content(body, cte="8bit")
    if config["MAIL_BACKEND"] == "file":
        directory = Path(current_app.instance_path) / "mail"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / f"{uuid.uuid4()}.eml").write_bytes(message.as_bytes())
        return
    if config["MAIL_BACKEND"] != "smtp":
        raise ValueError("MAIL_BACKEND must be 'file' or 'smtp'.")
    with smtplib.SMTP(config["SMTP_HOST"], config["SMTP_PORT"], timeout=10) as smtp:
        if config["SMTP_STARTTLS"]:
            import ssl
            smtp.starttls(context=ssl.create_default_context())
        if config["SMTP_USERNAME"]:
            smtp.login(config["SMTP_USERNAME"], config["SMTP_PASSWORD"])
        smtp.send_message(message)
