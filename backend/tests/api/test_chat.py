from unittest.mock import Mock
import re

import pytest


@pytest.fixture
def auth_headers(client, mailbox):
    credentials = {"email": "chat@example.com", "password": "a-long-test-password-123"}
    assert client.post("/auth/register", json=credentials).status_code == 201
    token = re.search(r"#token=([\w-]+)", mailbox[-1][2]).group(1)
    assert client.post("/auth/verify-email", json={"token": token}).status_code == 200
    response = client.post("/auth/login", json=credentials)
    return {"Authorization": "Bearer " + response.json["session_token"]}


def test_root_is_json_and_static_files_are_not_served(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json == {"service": "clinician-api", "status": "ok"}
    assert client.get("/static/style.css").status_code == 404


def test_chat_passes_json_question_to_ai_layer(client, auth_headers, monkeypatch):
    chain = Mock()
    chain.invoke.return_value = {"answer": "Answer from the retrieved context."}
    monkeypatch.setattr("src.api.chat.routes.get_rag_chain", Mock(return_value=chain))
    response = client.post("/chat", json={"message": "What is a fever?"}, headers=auth_headers)
    assert response.status_code == 200
    assert response.json == {"answer": "Answer from the retrieved context."}
    chain.invoke.assert_called_once_with({"input": "What is a fever?"})


@pytest.mark.parametrize("method", ["get", "post"])
def test_legacy_chat_route_returns_json(client, auth_headers, monkeypatch, method):
    chain = Mock()
    chain.invoke.return_value = {"answer": "Reference answer."}
    monkeypatch.setattr("src.api.chat.routes.get_rag_chain", Mock(return_value=chain))
    options = {"query_string" if method == "get" else "data": {"msg": "A question"}}
    response = getattr(client, method)("/get", headers=auth_headers, **options)
    assert response.status_code == 200
    assert response.json == {"answer": "Reference answer."}


@pytest.mark.parametrize("body", [{}, {"message": " "}, {"message": 42}, {"message": "x" * 8001}])
def test_invalid_message_does_not_call_ai(client, auth_headers, monkeypatch, body):
    factory = Mock()
    monkeypatch.setattr("src.api.chat.routes.get_rag_chain", factory)
    assert client.post("/chat", json=body, headers=auth_headers).status_code == 400
    factory.assert_not_called()


def test_chat_requires_authentication_before_calling_ai(client, monkeypatch):
    factory = Mock()
    monkeypatch.setattr("src.api.chat.routes.get_rag_chain", factory)
    assert client.post("/chat", json={"message": "A question"}).status_code == 401
    factory.assert_not_called()


def test_chat_handles_provider_failure_without_exposing_details(client, auth_headers, monkeypatch):
    monkeypatch.setattr("src.api.chat.routes.get_rag_chain", Mock(side_effect=RuntimeError("sensitive provider details")))
    response = client.post("/chat", json={"message": "A question"}, headers=auth_headers)
    assert response.status_code == 503
    assert response.json["error"]["code"] == "assistant_unavailable"
    assert "sensitive" not in response.get_data(as_text=True)


def test_chat_requires_json_body(client, auth_headers):
    assert client.post("/chat", data={"message": "A question"}, headers=auth_headers).status_code == 415
