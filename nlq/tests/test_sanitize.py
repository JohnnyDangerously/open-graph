import pytest

import nlq.app as app
from fastapi import HTTPException


def setup_module():
    # Provide a minimal allowed schema for validation tests
    app.ALLOWED_SCHEMA.clear()
    app.ALLOWED_SCHEMA.update({
        "companies": {"company_id_64", "name"},
        "stints": {"person_id_64", "company_id_64", "title", "start_date", "end_date", "seniority_bucket", "location"},
        "persons_large": {"person_id_64", "full_name", "location"},
    })


def test_non_select_rejected():
    with pytest.raises(HTTPException):
        app._prepare_query(f"UPDATE {app.DB_NAME}.companies SET name='x'")


def test_disallowed_keywords_rejected():
    with pytest.raises(HTTPException):
        app._prepare_query("SELECT 1; DROP TABLE x")


def test_wrong_schema_rejected():
    with pytest.raises(HTTPException):
        app._prepare_query("SELECT name FROM other_db.companies LIMIT 10 FORMAT JSONEachRow")


def test_missing_limit_is_enforced():
    q = app._prepare_query("SELECT 1")
    ql = q.lower()
    assert " limit " in ql
    assert " format jsoneachrow" in ql


def test_unknown_column_rejected():
    with pytest.raises(HTTPException) as ei:
        app._prepare_query(f"SELECT p.unknown_col FROM {app.DB_NAME}.persons_large p")
    assert "Column not in allowlist" in str(ei.value)


def test_known_column_passes():
    q = app._prepare_query(
        f"SELECT p.full_name FROM {app.DB_NAME}.persons_large p LIMIT 10 FORMAT JSONEachRow"
    )
    assert "full_name" in q


