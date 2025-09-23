import json
from types import SimpleNamespace
from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient

import nlq.app as app


class DummyResp:
    def __init__(self, status_code: int, text: str):
        self.status_code = status_code
        self.text = text


class DummyAsyncClient:
    def __init__(self, *args, **kwargs):
        pass
    async def __aenter__(self):
        return self
    async def __aexit__(self, exc_type, exc, tb):
        return False
    async def post(self, url: str, content: bytes, headers: Dict[str, str]):
        # Echo back a trivial JSONEachRow result: one row {"x":1}
        return DummyResp(200, '{"x":1}\n')


def setup_module():
    # Ensure allowed schema is present for sanitizer
    app.ALLOWED_SCHEMA.clear()
    app.ALLOWED_SCHEMA.update({
        "companies": {"company_id_64", "name"},
        "stints": {"person_id_64", "company_id_64", "title", "start_date", "end_date", "seniority_bucket", "location"},
        "persons_large": {"person_id_64", "full_name", "location"},
    })


@pytest.mark.asyncio
async def test_run_sql_dummy(monkeypatch):
    # Patch httpx.AsyncClient in app to our dummy
    monkeypatch.setattr(app.httpx, "AsyncClient", DummyAsyncClient)
    rows = await app.run_sql("SELECT 1")
    assert rows == [{"x": 1}]


def test_deterministic_who_at_company(monkeypatch, capsys):
    # Patch httpx client to avoid network
    monkeypatch.setattr(app.httpx, "AsyncClient", DummyAsyncClient)
    # Patch OpenAI client to ensure it's not called: if called, raise
    class CrashClient:
        class chat:
            class completions:
                @staticmethod
                def create(*args, **kwargs):
                    raise AssertionError("OpenAI should not be called for deterministic path")
    monkeypatch.setattr(app, "OpenAI", lambda: CrashClient)

    client = TestClient(app.app)
    r = client.post("/nlq", json={"question": "Who do I know at Google?", "top_k": 3})
    assert r.status_code == 200
    js = r.json()
    assert "sql" in js and isinstance(js["rows"], list)
    # Ensure log indicates deterministic
    out = capsys.readouterr().out
    assert '"mode": "deterministic"' in out


def test_llm_fallback_not_matched(monkeypatch):
    # For non-matching question, ensure we try to call OpenAI once with tools
    called = {"count": 0}
    class OKClient:
        class chat:
            class completions:
                @staticmethod
                def create(*args, **kwargs):
                    called["count"] += 1
                    if called["count"] == 1:
                        # Return a fake tool call to run_sql
                        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=[SimpleNamespace(id="1", function=SimpleNamespace(name="run_sql", arguments=json.dumps({"query": f"SELECT 1 FROM {app.DB_NAME}.companies"})))]))])
                    else:
                        # Final answer
                        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])
    monkeypatch.setattr(app, "OpenAI", lambda: OKClient)

    # Patch httpx client so the SQL call succeeds
    monkeypatch.setattr(app.httpx, "AsyncClient", DummyAsyncClient)

    client = TestClient(app.app)
    r = client.post("/nlq", json={"question": "What is the total?", "top_k": 3})
    assert r.status_code == 200
    assert called["count"] >= 1


