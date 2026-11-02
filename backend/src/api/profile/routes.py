from flask import Blueprint, g, jsonify

from ..auth.routes import require_auth
from ..auth.validation import json_body
from . import service
from .constants import ETHNICITIES
from .validation import profile_changes


profile = Blueprint("profile", __name__)


@profile.get("/getUserProfile")
@require_auth
def get_user_profile():
    return jsonify(profile=service.get_user_profile(g.auth_claims).to_dict())


@profile.get("/getEthnicities")
@require_auth
def get_ethnicities():
    return jsonify(ethnicities=[{"id": key, "name": name} for key, name in ETHNICITIES.items()])


@profile.patch("/updateUserProfile")
@require_auth
def update_user_profile():
    changes = profile_changes(json_body())
    return jsonify(profile=service.update_user_profile(g.auth_claims, changes).to_dict())
