"""Acceptance tests for TASK-03: rule base and quote verifier (rule endpoints).

Written before the implementation (TDD). Run with:
``cd backend && .venv/Scripts/pytest -q``
"""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402

client = TestClient(app)


def test_get_rules_returns_27_all_verified() -> None:
    """GET /rules returns 27 rules, every one verified: true (acceptance #1)."""
    response = client.get("/rules")
    assert response.status_code == 200
    rules = response.json()
    assert len(rules) == 27
    assert all(rule["verified"] is True for rule in rules)


def test_mc24_13_has_page_23_and_overrides_policy() -> None:
    """MC24-13 has page 23 and overrides_policy true (acceptance #1)."""
    response = client.get("/rules/MC24-13")
    assert response.status_code == 200
    rule = response.json()
    assert rule["page"] == 23
    assert rule["overrides_policy"] is True


def test_unknown_rule_returns_404() -> None:
    """GET /rules/nope returns 404."""
    response = client.get("/rules/nope")
    assert response.status_code == 404


def test_search_ranks_mc24_16b_in_top_three() -> None:
    """POST /rules/search returns MC24-16b in the top 3 (acceptance #6)."""
    response = client.post(
        "/rules/search",
        json={"query": "discharge three hours delay hospital charges", "k": 3},
    )
    assert response.status_code == 200
    ids = [rule["id"] for rule in response.json()]
    assert len(ids) <= 3
    assert "MC24-16b" in ids
