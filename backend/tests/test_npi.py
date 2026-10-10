"""Acceptance tests for TASK-13: non-payable item (NPI) classifier.

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
from app.models.schemas import BillLine, NpiList, NpiResult  # noqa: E402

CASES_DIR = BACKEND_DIR.parent / "data" / "cases"
DOC_ID = "star_fho_v19"

client = TestClient(app)


def _case_a_lines() -> list[BillLine]:
    raw = json.loads((CASES_DIR / "case_a.json").read_text())
    return [BillLine.model_validate(line) for line in raw["bill"]["lines"]]


def _line(particulars: str, category: str, line_id: str = "X1") -> BillLine:
    return BillLine(
        line_id=line_id,
        date="2026-08-03",
        particulars=particulars,
        category=category,
        rate=100,
        units=1,
        amount=100,
    )


def _classify(lines: list[BillLine], doc_id: str = DOC_ID) -> list[NpiResult]:
    response = client.post(
        "/classify/npi",
        json={"doc_id": doc_id, "lines": [line.model_dump(mode="json") for line in lines]},
    )
    assert response.status_code == 200, response.text
    return [NpiResult.model_validate(item) for item in response.json()]


def _by_particulars(lines: list[BillLine], results: list[NpiResult]) -> dict[str, NpiResult]:
    return {line.particulars: result for line, result in zip(lines, results, strict=True)}


# --- Acceptance 1 and 2: case A ----------------------------------------------


def test_admission_kit_and_documentation_charges_are_subsumed_into_room() -> None:
    """Acceptance 1: both non-medical lines land on the room list."""
    lines = _case_a_lines()
    results = _by_particulars(lines, _classify(lines))

    for particulars, item in (
        ("Admission kit", "ADMISSION KIT"),
        ("Documentation charges", "DOCUMENTATION CHARGES / ADMINISTRATIVE EXPENSES"),
    ):
        result = results[particulars]
        assert result.list == NpiList.room, particulars
        assert result.payable_separately is False, particulars
        assert result.matched_item == item, particulars


def test_pharmacy_medicines_are_not_on_any_list() -> None:
    """Acceptance 2: medicines are payable separately; matched_item is null."""
    lines = _case_a_lines()
    result = _by_particulars(lines, _classify(lines))["Pharmacy - medicines"]
    assert result.list == NpiList.none
    assert result.matched_item is None
    assert result.payable_separately is True


def test_one_result_per_line_in_request_order() -> None:
    """The response lines up with the request, line by line."""
    lines = _case_a_lines()
    results = _classify(lines)
    assert [r.line_id for r in results] == [line.line_id for line in lines]


# --- Category restriction -----------------------------------------------------


def test_a_surgeons_fee_is_never_a_non_payable_item() -> None:
    """Only non_medical, consumables and pharmacy lines are classified."""
    lines = [
        _line("Admission kit", "professional_fee", "P1"),
        _line("Admission kit", "room", "P2"),
        _line("Admission kit", "implant", "P3"),
    ]
    for result in _classify(lines):
        assert result.list == NpiList.none
        assert result.payable_separately is True


# --- Subset-match guard -------------------------------------------------------


def test_generic_words_alone_do_not_match_a_list_item() -> None:
    """\"Charges\" is a token subset of many items but names none of them."""
    lines = [_line("Charges", "non_medical", "G1"), _line("Other charges", "non_medical", "G2")]
    for result in _classify(lines):
        assert result.list == NpiList.none
        assert result.matched_item is None
        assert result.payable_separately is True


def test_documentation_charges_still_match_room() -> None:
    """A shared specific word (\"documentation\") keeps the match."""
    lines = [_line("Documentation charges", "non_medical", "G3")]
    (result,) = _classify(lines)
    assert result.list == NpiList.room
    assert result.payable_separately is False


def test_specific_overlap_ignores_generic_tokens() -> None:
    """The guard needs one shared token outside the generic set."""
    from app.services.npi import _shares_specific_token

    assert _shares_specific_token({"charges"}, {"housekeeping", "charges"}) is False
    assert _shares_specific_token({"other", "charges"}, {"file", "opening", "charges"}) is False
    assert _shares_specific_token({"documentation", "charges"}, {"documentation", "charges"}) is True
    assert _shares_specific_token({"misc", "expenses"}, {"incidental", "misc", "expenses"}) is False
    assert _shares_specific_token({"incidental", "misc"}, {"incidental", "misc", "expenses"}) is True


# --- Acceptance 8: unknown document -------------------------------------------


def test_doc_id_without_an_npi_list_returns_404() -> None:
    """Acceptance 8: a registered policy with no NPI list, or an unknown id, is 404."""
    for doc_id in ("hdfc_optima_secure", "does_not_exist", "../policies/anchors"):
        response = client.post("/classify/npi", json={"doc_id": doc_id, "lines": []})
        assert response.status_code == 404, doc_id
