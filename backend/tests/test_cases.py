"""Acceptance tests for TASK-01: backend skeleton and sample cases.

Written before the implementation (TDD). Run with:
``cd backend && .venv/bin/pytest -q``
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# The pytest console script does not add the CWD to sys.path, so make the
# ``app`` package importable when running from backend/.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402
from app.models.schemas import Case  # noqa: E402

client = TestClient(app)


def test_health_returns_ok() -> None:
    """GET /health returns 200 and {"status": "ok"}."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_cases_lists_five_known_ids() -> None:
    """GET /cases returns 5 items with ids case_a..case_e."""
    response = client.get("/cases")
    assert response.status_code == 200
    items = response.json()
    assert len(items) == 5
    assert [item["id"] for item in items] == [
        "case_a",
        "case_b",
        "case_c",
        "case_d",
        "case_e",
    ]
    for item in items:
        assert set(item) == {"id", "title", "summary"}


def test_case_a_totals_match_stored_values() -> None:
    """GET /cases/case_a validates as Case; stored totals equal the sums."""
    response = client.get("/cases/case_a")
    assert response.status_code == 200
    case = Case.model_validate(response.json())

    line_sum = sum(line.amount for line in case.bill.lines)
    assert case.bill.total == pytest.approx(line_sum, abs=0.01)

    deduction_sum = sum(d.amount for d in case.settlement.deductions)
    assert case.settlement.total_deducted == pytest.approx(deduction_sum, abs=0.01)
    assert case.settlement.total_deducted == pytest.approx(98969.76, abs=0.01)


def test_unknown_case_returns_404() -> None:
    """GET /cases/nope returns 404."""
    response = client.get("/cases/nope")
    assert response.status_code == 404
