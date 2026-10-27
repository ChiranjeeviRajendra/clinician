from flask import Blueprint, current_app, jsonify, request

from src.ai.rag import get_rag_chain
from ..auth.errors import AuthError
from ..auth.routes import require_auth
from ..auth.validation import json_body, text
from ..extensions import limiter

chat = Blueprint("chat", __name__)


@chat.post("/chat")
@chat.route("/get", methods=["GET", "POST"])
@limiter.limit("20 per minute")
@require_auth
def answer():
    if request.path == "/get":
        # Keep the previous client contract available during the UI migration.
        body = json_body() if request.is_json else (
            request.args if request.method == "GET" else request.form
        )
        message = text(body, "msg", maximum=8000)
    else:
        message = text(json_body(), "message", maximum=8000)
    message = message.strip()
    if not message:
        raise AuthError("invalid_input", "message must not be blank.")
    try:
        response = get_rag_chain().invoke({"input": message})
        return jsonify(answer=str(response["answer"]))
    except Exception as error:
        current_app.logger.error("AI request failed (%s)", type(error).__name__)
        return jsonify(error={"code": "assistant_unavailable",
                              "message": "The assistant is temporarily unavailable. Please try again."}), 503
