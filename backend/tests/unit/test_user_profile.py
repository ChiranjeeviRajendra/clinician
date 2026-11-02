"""Profile API and persistence contracts; every database operation is mocked."""
import importlib.util
import json
import uuid
from decimal import Decimal
from io import StringIO
from pathlib import Path
from unittest.mock import Mock

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.dialects import postgresql

from src.api import create_app
from src.api.auth.errors import AuthError
from src.api.auth.jwt_tokens import issue_access_token
from src.api.extensions import db
from src.api.models import User, UserProfile
from src.api.models.profile import PROFILE_FIELDS
from src.api.profile.constants import ETHNICITIES
from src.api.profile.validation import profile_changes


def complete_profile(user_id):
    return UserProfile(id=user_id, full_name="Asha Patel", age=30, gender=2,
                       height_cm=Decimal("170.25"), weight_kg=Decimal("65.50"),
                       ethnicity=11)


@pytest.fixture
def api(monkeypatch):
    app = create_app({
        "TESTING": True, "DATABASE_AUTH_MODE": "password", "RATELIMIT_ENABLED": False,
        "SQLALCHEMY_DATABASE_URI": "postgresql+psycopg://test:test@localhost/unused",
    })
    with app.app_context():
        monkeypatch.setattr(db.engine, "connect", Mock(side_effect=AssertionError("Unexpected database connection")))
        for operation in ("get", "scalar", "execute", "add", "commit", "rollback"):
            monkeypatch.setattr(db.session, operation, Mock())
        user = User(id=uuid.uuid4(), email="asha@example.com")
        db.session.get.side_effect = lambda model, key: user if model is User else None
        raw, _ = issue_access_token(user.id)
        yield app.test_client(), {"Authorization": f"Bearer {raw}"}, user


def test_unsaved_profile_is_empty_and_get_does_not_write(api):
    client, headers, user = api
    response = client.get("/getUserProfile", headers=headers)
    assert response.status_code == 200
    assert response.json["profile"] == {
        "id": str(user.id), **dict.fromkeys(PROFILE_FIELDS), "ethnicity_name": None, "isProfileCompleted": False,
    }
    assert set(response.json) == {"profile"}
    assert response.headers["Cache-Control"] == "no-store"
    db.session.get.assert_any_call(UserProfile, user.id)
    for operation in ("scalar", "add", "execute", "commit"):
        getattr(db.session, operation).assert_not_called()


def test_ethnicities_return_valid_id_name_choices_without_database_access(api):
    client, headers, _ = api
    response = client.get("/getEthnicities", headers=headers)
    assert response.status_code == 200
    assert response.json == {"ethnicities": [{"id": key, "name": name} for key, name in ETHNICITIES.items()]}
    for operation in ("get", "scalar", "execute", "add", "commit", "rollback"):
        getattr(db.session, operation).assert_not_called()
    for choice in response.json["ethnicities"]:
        assert profile_changes({"ethnicity": choice["id"]}) == {"ethnicity": choice["id"]}


def test_gender_lookup_route_is_removed(api):
    client, _, _ = api
    assert client.get("/getGenders").status_code == 404
    db.session.get.assert_not_called()


@pytest.mark.parametrize("gender", [1, 2])
def test_gender_uses_numeric_ids(api, gender):
    client, headers, user = api
    profile = UserProfile(id=user.id, gender=gender)
    db.session.scalar.return_value = profile
    response = client.patch("/updateUserProfile", headers=headers, json={"gender": gender})
    assert response.status_code == 200
    assert response.json["profile"]["gender"] == gender
    assert response.json["profile"]["isProfileCompleted"] is False


@pytest.mark.parametrize("method,path", [
    ("get", "/getUserProfile"), ("patch", "/updateUserProfile"),
    ("get", "/getEthnicities"),
])
@pytest.mark.parametrize("authorization", [None, "Basic abc", "Bearer opaque-token"])
def test_profile_requires_a_valid_jwt(api, method, path, authorization):
    client, _, _ = api
    response = getattr(client, method)(path, headers={} if authorization is None else {"Authorization": authorization})
    assert response.status_code == 401
    db.session.get.assert_not_called()
    db.session.scalar.assert_not_called()


@pytest.mark.parametrize("method,path", [("get", "/getUserProfile"), ("patch", "/updateUserProfile")])
def test_deleted_account_cannot_access_profiles(api, method, path):
    client, headers, _ = api
    db.session.get.return_value = None
    db.session.get.side_effect = None
    response = getattr(client, method)(path, headers=headers, **({"json": {"age": 30}} if method == "patch" else {}))
    assert response.status_code == 401
    db.session.scalar.assert_not_called()
    db.session.commit.assert_not_called()


def test_get_returns_saved_profile_for_authenticated_user(api):
    client, headers, user = api
    profile = complete_profile(user.id)
    db.session.get.side_effect = lambda model, key: user if model is User else profile
    response = client.get("/getUserProfile", headers=headers)
    assert response.json["profile"] == profile.to_dict()
    assert response.json["profile"]["isProfileCompleted"] is True
    assert response.json["profile"]["weight_kg"] == 65.5
    assert response.json["profile"]["gender"] == 2
    assert response.json["profile"]["ethnicity"] == 11
    assert response.json["profile"]["ethnicity_name"] == "South Asian"
    assert [call.args for call in db.session.get.call_args_list] == [(User, user.id), (UserProfile, user.id)]


def test_partial_update_upserts_only_supplied_fields_for_current_user(api):
    client, headers, user = api
    profile = complete_profile(user.id)
    profile.age = 31
    db.session.scalar.return_value = profile
    response = client.patch("/updateUserProfile", headers=headers, json={"age": 31})
    assert response.status_code == 200
    assert response.json["profile"]["full_name"] == "Asha Patel"
    assert response.json["profile"]["age"] == 31
    assert response.json["profile"]["isProfileCompleted"] is True
    statement = db.session.scalar.call_args.args[0].compile(dialect=postgresql.dialect())
    assert statement.params == {"id": user.id, "age": 31, "param_1": 31}
    assert "ON CONFLICT (id) DO UPDATE SET age =" in str(statement)
    assert response.headers["Cache-Control"] == "no-store"
    db.session.commit.assert_called_once()


def test_a_single_field_can_be_saved_then_explicitly_cleared(api):
    client, headers, user = api
    profile = UserProfile(id=user.id, full_name="Asha Patel")
    db.session.scalar.return_value = profile
    response = client.patch("/updateUserProfile", headers=headers, json={"full_name": " Asha Patel "})
    assert response.json["profile"]["full_name"] == "Asha Patel"
    assert response.json["profile"]["isProfileCompleted"] is False
    profile.full_name = None
    response = client.patch("/updateUserProfile", headers=headers, json={"full_name": None})
    assert response.json["profile"]["full_name"] is None
    assert response.json["profile"]["isProfileCompleted"] is False
    assert db.session.scalar.call_args.args[0].compile().params["full_name"] is None


def test_empty_update_is_a_read_only_noop(api):
    client, headers, _ = api
    response = client.patch("/updateUserProfile", headers=headers, json={})
    assert response.status_code == 200
    assert response.json["profile"]["isProfileCompleted"] is False
    db.session.scalar.assert_not_called()
    db.session.commit.assert_not_called()


@pytest.mark.parametrize("body", [
    {"age": -1}, {"age": 151}, {"age": 30.5}, {"age": True}, {"age": "30"},
    {"height_cm": 0}, {"height_cm": 301}, {"height_cm": 170.123},
    {"height_cm": "170 cm"}, {"height_cm": True}, {"weight_kg": -10},
    {"weight_kg": 1001}, {"weight_kg": []}, {"full_name": 12}, {"full_name": "a" * 201},
    {"gender": "invalid"}, {"ethnicity": "invalid"}, {"id": str(uuid.uuid4())},
    {"gender": "Male"}, {"gender": "Female"}, {"gender": "1"}, {"gender": 0},
    {"gender": 3}, {"gender": True}, {"gender": 1.0},
    {"ethnicity": "Asian"}, {"ethnicity": "1"}, {"ethnicity": 0},
    {"ethnicity": True}, {"ethnicity": 1.0}, {"ethnicity": []}, {"ethnicity": 17},
    {"isProfileCompleted": True}, {"age": 30, "weight_kg": -1}, [], None,
])
def test_invalid_updates_are_rejected_before_database_access(api, body):
    client, headers, _ = api
    response = client.patch("/updateUserProfile", headers=headers, data=json.dumps(body), content_type="application/json")
    assert response.status_code == 400
    assert response.json["error"]["code"] == "invalid_input"
    db.session.get.assert_not_called()
    db.session.scalar.assert_not_called()
    db.session.commit.assert_not_called()


@pytest.mark.parametrize("number", [float("nan"), float("inf"), -float("inf")])
def test_nonfinite_measurements_are_rejected(number):
    with pytest.raises(AuthError):
        profile_changes({"height_cm": number})


def test_blank_and_null_fields_clear_details_and_zero_age_is_valid():
    assert profile_changes(dict.fromkeys(PROFILE_FIELDS, "  ")) == dict.fromkeys(PROFILE_FIELDS)
    assert profile_changes(dict.fromkeys(PROFILE_FIELDS)) == dict.fromkeys(PROFILE_FIELDS)
    assert profile_changes({"age": 0, "height_cm": 170.25, "weight_kg": 65}) == {
        "age": 0, "height_cm": Decimal("170.25"), "weight_kg": Decimal("65"),
    }
    profile = complete_profile(uuid.uuid4())
    profile.age = 0
    assert profile.is_profile_completed is True
    for field in PROFILE_FIELDS:
        profile = complete_profile(uuid.uuid4())
        setattr(profile, field, None)
        assert profile.is_profile_completed is False
    profile = complete_profile(uuid.uuid4())
    profile.full_name = "   "
    assert profile.is_profile_completed is False


def test_profile_schema_uses_users_primary_key_and_cascading_foreign_key():
    table = UserProfile.__table__
    assert list(table.primary_key.columns.keys()) == ["id"]
    foreign_key, = table.c.id.foreign_keys
    assert foreign_key.target_fullname == "users.id"
    assert foreign_key.ondelete == "CASCADE"
    assert all(table.c[field].nullable for field in PROFILE_FIELDS)
    assert str(table.c.gender.type) == "SMALLINT"
    assert str(table.c.ethnicity.type) == "INTEGER"
    checks = {constraint.name: str(constraint.sqltext) for constraint in table.constraints if hasattr(constraint, "sqltext")}
    assert checks["ck_user_profile_valid_gender"] == "gender IN (1, 2)"
    assert checks["ck_user_profile_valid_ethnicity"] == "ethnicity > 0"


def test_ethnicity_catalog_preserves_all_original_choices_with_stable_ids():
    assert dict(ETHNICITIES) == {
        1: "Aboriginal or Torres Strait Islander", 2: "Black or African descent",
        3: "Caribbean", 4: "Central Asian", 5: "East Asian", 6: "Hispanic or Latino",
        7: "Indigenous or First Nations", 8: "Middle Eastern or North African",
        9: "Native American or Alaska Native", 10: "Pacific Islander", 11: "South Asian",
        12: "Southeast Asian", 13: "White or European descent", 14: "Mixed or multiple ethnicities",
        15: "Other", 16: "Prefer not to say",
    }
    with pytest.raises(TypeError):
        ETHNICITIES[1] = "Changed"


def test_ethnicity_validation_supports_new_catalog_ids_without_a_hardcoded_maximum(monkeypatch):
    monkeypatch.setattr("src.api.profile.validation.ETHNICITIES", {**ETHNICITIES, 100: "Additional choice"})
    assert profile_changes({"ethnicity": 100}) == {"ethnicity": 100}
    assert profile_changes({"ethnicity": 11}) == {"ethnicity": 11}


def test_choice_id_migration_generates_sql_offline():
    path = Path(__file__).resolve().parents[2] / "migrations" / "versions" / "0005_profile_choice_ids.py"
    spec = importlib.util.spec_from_file_location("choice_id_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    output = StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        migration.upgrade()  # SQL output only; no database connection.
    sql = output.getvalue()
    assert migration.down_revision == "0004_user_profile"
    assert "ALTER COLUMN gender TYPE SMALLINT USING CASE gender WHEN 'Male' THEN 1 WHEN 'Female' THEN 2 ELSE NULL END" in sql
    assert "ALTER COLUMN ethnicity TYPE INTEGER USING CASE ethnicity" in sql
    for key, label in ETHNICITIES.items():
        assert f"WHEN '{label}' THEN {key}\n" in sql
    assert "CHECK (gender IN (1, 2))" in sql
    assert "CHECK (ethnicity > 0)" in sql
    output.truncate(0)
    output.seek(0)
    with Operations.context(context):
        migration.downgrade()
    assert "DROP CONSTRAINT ck_user_profile_valid_gender" in output.getvalue()
    assert "ALTER COLUMN ethnicity TYPE VARCHAR(100)" in output.getvalue()
    for key, label in ETHNICITIES.items():
        assert f"WHEN {key} THEN '{label}'\n" in output.getvalue()


@pytest.mark.parametrize("ethnicity", [10, 11, 16])
def test_profile_can_save_and_display_multi_digit_ethnicity_ids(api, ethnicity):
    client, headers, user = api
    profile = complete_profile(user.id)
    profile.ethnicity = ethnicity
    db.session.scalar.return_value = profile
    response = client.patch("/updateUserProfile", headers=headers, json={"ethnicity": ethnicity})
    assert response.status_code == 200
    assert response.json["profile"]["ethnicity"] == ethnicity
    assert response.json["profile"]["ethnicity_name"] == ETHNICITIES[ethnicity]
    assert response.json["profile"]["isProfileCompleted"] is True


def test_migration_generates_profile_sql_offline():
    path = Path(__file__).resolve().parents[2] / "migrations" / "versions" / "0004_user_profile.py"
    spec = importlib.util.spec_from_file_location("profile_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    output = StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        migration.upgrade()  # Emits SQL into memory only; never connects to a database.
    sql = output.getvalue()
    assert migration.down_revision == "0003_stateless_jwt"
    assert "CREATE TABLE user_profile" in sql
    assert "PRIMARY KEY (id)" in sql
    assert "FOREIGN KEY(id) REFERENCES users (id) ON DELETE CASCADE" in sql
    assert "ck_user_profile_valid_height_cm" in sql
    assert "weight_kg NUMERIC(6, 2)" in sql
