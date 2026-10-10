"""Acceptance tests for TASK-04: deterministic calculators.

Written before the implementation (TDD). Run with:
``cd backend && .venv/Scripts/python.exe -m pytest -q``
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app
from app.models.schemas import BillCategory
from app.services.cases import load_case

client = TestClient(app)


def _bill_lines(case_id: str) -> list[dict]:
    """Bill lines of ``case_id`` as JSON-ready dicts."""
    return [line.model_dump(mode="json") for line in load_case(case_id).bill.lines]


def test_proportionate_case_a_matches_expected_values() -> None:
    """POST /calc/proportionate on case A returns the documented figures."""
    case = load_case("case_a")
    room = next(line for line in case.bill.lines if line.category == BillCategory.room)
    eligible = case.policy.schedule.eligible_room_rent_per_day
    assert eligible is not None

    response = client.post(
        "/calc/proportionate",
        json={
            "eligible_room_rent": eligible,
            "actual_room_rent": room.rate,
            "days": int(room.units),
            "lines": _bill_lines("case_a"),
        },
    )
    assert response.status_code == 200
    data = response.json()

    assert data["ratio"] == 0.625
    assert data["room_difference"] == pytest.approx(12000.0)
    assert data["associated_total"] == pytest.approx(118000.0)
    assert data["exempt_total"] == pytest.approx(108586.03)
    assert data["correct_deduction"] == pytest.approx(56250.0)

    # The cut the insurer wrongly applied to the exempt heads equals
    # exempt_total * (1 - ratio), rounded to 2 dp.
    exempt_cut = round(data["exempt_total"] * (1 - data["ratio"]), 2)
    assert exempt_cut == pytest.approx(40719.76)


def test_proportionate_actual_not_above_eligible_yields_zero_deductions() -> None:
    """Actual <= eligible: ratio 1 and every deduction zero."""
    response = client.post(
        "/calc/proportionate",
        json={
            "eligible_room_rent": 8000,
            "actual_room_rent": 5000,
            "days": 4,
            "lines": _bill_lines("case_a"),
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ratio"] == 1.0
    assert data["room_difference"] == 0.0
    assert data["correct_deduction"] == 0.0
    assert all(line["deduction"] == 0.0 for line in data["per_line"])


def test_waiting_period_case_b_moratorium_override() -> None:
    """Case B: 89 months completed, 60 applicable, elapsed and overridden."""
    case = load_case("case_b")
    response = client.post(
        "/calc/waiting-period",
        json={
            "inception_date": case.policy.schedule.inception_date.isoformat(),
            "event_date": case.admission.admitted.date().isoformat(),
            "policy_months": 96,
            "regulation_months": 60,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["months_completed"] == 89
    assert data["applicable_months"] == 60
    assert data["elapsed"] is True
    assert data["overridden"] is True


def test_waiting_period_case_c_not_elapsed() -> None:
    """Case C: 18 months completed, not elapsed."""
    case = load_case("case_c")
    response = client.post(
        "/calc/waiting-period",
        json={
            "inception_date": case.policy.schedule.inception_date.isoformat(),
            "event_date": case.admission.admitted.date().isoformat(),
            "policy_months": 48,
            "regulation_months": 36,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["months_completed"] == 18
    assert data["elapsed"] is False


def test_waiting_period_without_regulation_uses_policy_months() -> None:
    """No regulation months: applicable = policy, overridden false."""
    response = client.post(
        "/calc/waiting-period",
        json={
            "inception_date": "2019-04-01",
            "event_date": "2026-09-02",
            "policy_months": 96,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["applicable_months"] == 96
    assert data["overridden"] is False


def test_tat_case_d_discharge_and_cashless() -> None:
    """POST /calc/tat matches case D's discharge and cashless timelines."""
    case = load_case("case_d")
    timeline = {event.event.value: event.at for event in case.timeline}

    discharge = client.post(
        "/calc/tat",
        json={
            "requested_at": timeline["discharge_request"].isoformat(),
            "decided_at": timeline["final_authorisation"].isoformat(),
            "limit_minutes": 180,
        },
    )
    assert discharge.status_code == 200
    data = discharge.json()
    assert data["elapsed_minutes"] == 330
    assert data["limit_minutes"] == 180
    assert data["breached"] is True
    assert data["over_by_minutes"] == 150

    cashless = client.post(
        "/calc/tat",
        json={
            "requested_at": timeline["cashless_request"].isoformat(),
            "decided_at": timeline["cashless_decision"].isoformat(),
            "limit_minutes": 60,
        },
    )
    assert cashless.status_code == 200
    cashless_data = cashless.json()
    assert cashless_data["elapsed_minutes"] == 135
    assert cashless_data["breached"] is True


def test_tat_decided_before_requested_returns_422() -> None:
    """decided_at earlier than requested_at is a validation error."""
    response = client.post(
        "/calc/tat",
        json={
            "requested_at": "2026-07-23T16:30:00",
            "decided_at": "2026-07-23T11:00:00",
            "limit_minutes": 180,
        },
    )
    assert response.status_code == 422


def test_deadlines_ombudsman_latest_one_year() -> None:
    """Ombudsman latest = decision date + 1 year (acceptance #5)."""
    response = client.post(
        "/calc/deadlines",
        json={"decision_date": "2026-08-07"},
    )
    assert response.status_code == 200
    steps = response.json()["steps"]
    ombudsman = next(s for s in steps if s["stage"] == "ombudsman")
    assert ombudsman["latest"] == "2027-08-07"


def test_deadlines_with_grievance_sent_on() -> None:
    """Grievance already sent: insurer latest +14 days, ombudsman earliest +1 month."""
    response = client.post(
        "/calc/deadlines",
        json={"decision_date": "2026-08-07", "grievance_sent_on": "2026-08-10"},
    )
    assert response.status_code == 200
    steps = {s["stage"]: s for s in response.json()["steps"]}
    assert steps["insurer_grievance"]["latest"] == "2026-08-24"
    assert steps["ombudsman"]["earliest"] == "2026-09-10"


def test_whole_months_between_clamps_end_of_month() -> None:
    """Jan 31 -> Feb 29 is one whole month (end-of-month clamping)."""
    from app.services.calculators import whole_months_between

    assert whole_months_between(date(2024, 1, 31), date(2024, 2, 29)) == 1


def test_add_months_clamps_february() -> None:
    """Feb 29 + 12 months = Feb 28 the following year."""
    from app.services.calculators import add_months

    assert add_months(date(2024, 2, 29), 12) == date(2025, 2, 28)


def _proportionate_case_a(deduction_id: str) -> dict:
    case = load_case("case_a")
    deduction = next(
        d for d in case.settlement.deductions if d.deduction_id == deduction_id
    )
    body = {
        "eligible_room_rent": 5000,
        "actual_room_rent": 8000,
        "days": 4,
        "lines": _bill_lines("case_a"),
        "deduction": {"amount": deduction.amount, "line_ids": deduction.line_ids},
    }
    response = client.post("/calc/proportionate", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_proportionate_returns_recoverable_amount_for_a_deduction() -> None:
    """Recoverable = insurer's deduction minus the correct cut on its own lines."""
    recoverable = {
        d: _proportionate_case_a(d)["recoverable_amount"] for d in ("D1", "D2", "D3")
    }
    assert recoverable["D3"] == pytest.approx(40719.76, abs=0.001)
    assert recoverable["D2"] == pytest.approx(0.0, abs=0.001)
    assert recoverable["D1"] == pytest.approx(0.0, abs=0.001)


def test_proportionate_without_deduction_has_no_recoverable_amount() -> None:
    body = {
        "eligible_room_rent": 5000,
        "actual_room_rent": 8000,
        "days": 4,
        "lines": _bill_lines("case_a"),
    }
    result = client.post("/calc/proportionate", json=body).json()
    assert result["recoverable_amount"] is None


def test_proportionate_rejects_unknown_deduction_line_id() -> None:
    body = {
        "eligible_room_rent": 5000,
        "actual_room_rent": 8000,
        "days": 4,
        "lines": _bill_lines("case_a"),
        "deduction": {"amount": 100, "line_ids": ["NOPE"]},
    }
    assert client.post("/calc/proportionate", json=body).status_code == 422


def test_waiting_period_event_before_inception_returns_422() -> None:
    body = {
        "inception_date": "2026-01-01",
        "event_date": "2025-01-01",
        "policy_months": 48,
    }
    assert client.post("/calc/waiting-period", json=body).status_code == 422


def test_tat_mixing_timezone_aware_and_naive_returns_422() -> None:
    body = {
        "requested_at": "2026-07-23T11:00:00+05:30",
        "decided_at": "2026-07-23T16:30:00",
        "limit_minutes": 180,
    }
    assert client.post("/calc/tat", json=body).status_code == 422
