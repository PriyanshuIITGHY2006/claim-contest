"""Acceptance tests for TASK-13: bill arithmetic check.

Written before the implementation (TDD). Run with:
``cd backend && .venv/bin/pytest -q``
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

# The pytest console script does not add the CWD to sys.path, so make the
# ``app`` package importable when running from backend/.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402
from app.models.schemas import BillCheck, BillCheckIssue, BillLine  # noqa: E402

CASES_DIR = BACKEND_DIR.parent / "data" / "cases"

client = TestClient(app)


def _case_lines(case: str = "case_a") -> list[BillLine]:
    raw = json.loads((CASES_DIR / f"{case}.json").read_text())
    return [BillLine.model_validate(line) for line in raw["bill"]["lines"]]


def _line(
    line_id: str,
    particulars: str = "Consultation",
    category: str = "professional_fee",
    rate: float = 100,
    units: float = 1,
    amount: float | None = None,
    day: str = "2026-08-03",
) -> BillLine:
    return BillLine(
        line_id=line_id,
        date=day,
        particulars=particulars,
        category=category,
        rate=rate,
        units=units,
        amount=rate * units if amount is None else amount,
    )


def _check(lines: list[BillLine], printed_total: float | None = None) -> list[BillCheck]:
    body: dict[str, object] = {"lines": [line.model_dump(mode="json") for line in lines]}
    if printed_total is not None:
        body["printed_total"] = printed_total
    response = client.post("/calc/bill-check", json=body)
    assert response.status_code == 200, response.text
    return [BillCheck.model_validate(item) for item in response.json()]


def _issues(checks: list[BillCheck], issue: BillCheckIssue) -> list[BillCheck]:
    return [check for check in checks if check.issue == issue]


# --- Acceptance 3: line arithmetic --------------------------------------------


def test_rate_times_units_not_equal_amount_is_a_line_math_issue() -> None:
    """Acceptance 3: 100 x 3 billed as 400 -> line_math, expected 300."""
    checks = _check([_line("L1", rate=100, units=3, amount=400)])
    (issue,) = _issues(checks, BillCheckIssue.line_math)
    assert issue.line_id == "L1"
    assert issue.expected == 300
    assert issue.found == 400


def test_line_math_tolerates_one_paisa_of_rounding() -> None:
    """rate x units within +-0.01 of the amount is consistent."""
    assert _check([_line("L1", rate=33.33, units=3, amount=100.0)]) == []
    assert _check([_line("L2", rate=100, units=3, amount=300.01)]) == []
    assert _issues(_check([_line("L3", rate=100, units=3, amount=300.02)]), BillCheckIssue.line_math)


# --- Acceptance 4: printed total ----------------------------------------------


def test_case_a_with_its_printed_total_has_no_issues() -> None:
    """Acceptance 4: case A is internally consistent."""
    assert _check(_case_lines(), printed_total=260586.03) == []


def test_printed_total_mismatch_is_a_total_mismatch_issue() -> None:
    """A printed total that differs from the line sum is reported."""
    lines = [_line("L1", amount=100), _line("L2", particulars="Other", amount=200)]
    (issue,) = _issues(_check(lines, printed_total=350), BillCheckIssue.total_mismatch)
    assert issue.line_id is None
    assert issue.expected == 300
    assert issue.found == 350


def test_total_is_not_checked_without_a_printed_total() -> None:
    """printed_total is optional."""
    assert _issues(_check(_case_lines()), BillCheckIssue.total_mismatch) == []


# --- Acceptance 5 and 6: stent price cap --------------------------------------


def test_stent_above_the_ceiling_is_flagged() -> None:
    """Acceptance 5: a drug-eluting stent at 45,000 -> above_price_cap, expected 39186.03."""
    line = _line("S1", "Drug-eluting stent", "implant", rate=45000, amount=45000)
    (issue,) = _issues(_check([line]), BillCheckIssue.above_price_cap)
    assert issue.line_id == "S1"
    assert issue.expected == 39186.03
    assert issue.found == 45000


def test_stent_exactly_at_the_ceiling_is_not_flagged() -> None:
    """Acceptance 6: the cap is inclusive; case A's stent is at exactly 39,186.03."""
    assert _issues(_check(_case_lines()), BillCheckIssue.above_price_cap) == []


def test_bare_metal_stent_uses_its_own_ceiling() -> None:
    """Bare-metal stents are capped at 10,762.15, by 'bare metal' or 'BMS'."""
    for particulars in ("Bare metal stent", "BMS coronary stent"):
        line = _line("S2", particulars, "implant", rate=12000, amount=12000)
        (issue,) = _issues(_check([line]), BillCheckIssue.above_price_cap)
        assert issue.expected == 10762.15, particulars
    at_cap = _line("S3", "Bare metal stent", "implant", rate=10762.15, amount=10762.15)
    assert _issues(_check([at_cap]), BillCheckIssue.above_price_cap) == []


def test_only_implant_lines_naming_a_stent_are_capped() -> None:
    """A stent in a non-implant line, or an implant that is no stent, is ignored."""
    lines = [
        _line("N1", "Stent counselling", "professional_fee", rate=90000, amount=90000),
        _line("N2", "Knee implant", "implant", rate=90000, amount=90000),
    ]
    assert _issues(_check(lines), BillCheckIssue.above_price_cap) == []


def test_stent_cap_applies_per_unit_rate_not_the_line_amount() -> None:
    """Two stents at the ceiling bill 78,372.06 in total without breaching it."""
    line = _line("S4", "Drug-eluting stent", "implant", rate=39186.03, units=2, amount=78372.06)
    assert _issues(_check([line]), BillCheckIssue.above_price_cap) == []


# --- Acceptance 7: duplicates --------------------------------------------------


def test_identical_lines_give_one_duplicate_issue_naming_the_second() -> None:
    """Acceptance 7: same date, particulars and amount -> one duplicate, on line two."""
    lines = [_line("D1", "X-ray chest", amount=500), _line("D2", "X-ray chest", amount=500)]
    (issue,) = _issues(_check(lines), BillCheckIssue.duplicate)
    assert issue.line_id == "D2"


def test_same_particulars_on_another_day_or_amount_are_not_duplicates() -> None:
    """A different date or amount is a separate charge."""
    lines = [
        _line("D1", "X-ray chest", amount=500),
        _line("D2", "X-ray chest", amount=500, day="2026-08-04"),
        _line("D3", "X-ray chest", amount=600, rate=600),
    ]
    assert _issues(_check(lines), BillCheckIssue.duplicate) == []


def test_three_identical_lines_flag_the_second_and_third() -> None:
    """Every repeat after the first is named, once each."""
    lines = [_line(f"D{i}", "Dressing", amount=80) for i in (1, 2, 3)]
    flagged = [issue.line_id for issue in _issues(_check(lines), BillCheckIssue.duplicate)]
    assert flagged == ["D2", "D3"]


def test_a_consistent_bill_returns_an_empty_list() -> None:
    """Empty means consistent."""
    assert _check([_line("L1", amount=100), _line("L2", "Other", amount=250, rate=250)]) == []
