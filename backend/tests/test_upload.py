"""Acceptance tests for TASK-16: upload your own claim (PDF upload, pre-fill, confirm).

Written before the implementation (TDD). Run with:
``cd backend && .venv/bin/pytest -q``

PDFs are generated in memory with PyMuPDF; nothing here calls a model.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

import pymupdf
import pytest
from fastapi.testclient import TestClient

# The pytest console script does not add the CWD to sys.path, so make the
# ``app`` package importable when running from backend/.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402
from app.models.schemas import BillCategory, Case, CaseDraft  # noqa: E402
from app.services.ingest import build_draft  # noqa: E402
from app.settings import settings  # noqa: E402

DOC_ID = "star_fho_v19"
SCANNED_MESSAGE = "Scanned documents are not supported yet; please upload a text PDF"
SAMPLE_IDS = ["case_a", "case_b", "case_c", "case_d", "case_e"]

client = TestClient(app)


def _pdf(lines: list[str]) -> bytes:
    """A one-page PDF with one text line per entry (an empty list gives a blank page)."""
    doc = pymupdf.open()
    page = doc.new_page()
    for index, line in enumerate(lines):
        page.insert_text((72, 72 + 18 * index), line, fontsize=11)
    data = doc.tobytes()
    doc.close()
    return data


def _upload(settlement: bytes, bill: bytes, doc_id: str = DOC_ID) -> Any:
    return client.post(
        "/cases/upload",
        data={"doc_id": doc_id},
        files={
            "settlement_pdf": ("letter.pdf", settlement, "application/pdf"),
            "bill_pdf": ("bill.pdf", bill, "application/pdf"),
        },
    )


LETTER_LINES = [
    "Claim settlement letter",
    "Claimed amount: Rs 2,60,586.03",
    "Approved amount: Rs 1,61,616.27",
    "Room rent beyond eligibility deducted Rs 12,000",
    "Non-payable items not payable Rs 2,000",
    "Total deducted Rs 14,000",
]
BILL_LINES = [
    "Admission date: 03/08/2026",
    "Deluxe room rent Rs 32,000",
    "Surgeon fee - PTCA Rs 45,000",
    "Pharmacy - medicines Rs 21,400.50",
    "Total Rs 98,400.50",
]


# --- Acceptance 1: pre-fill from a text PDF -----------------------------------


def test_text_pdfs_are_read_into_a_draft_with_three_bill_lines() -> None:
    """Acceptance 1: three bill lines ending in amounts come back with those amounts."""
    response = _upload(_pdf(LETTER_LINES), _pdf(BILL_LINES))
    assert response.status_code == 200, response.text
    draft = CaseDraft.model_validate(response.json())

    assert draft.doc_id == DOC_ID
    assert [(line.particulars, line.amount) for line in draft.bill_lines] == [
        ("Deluxe room rent", 32000.0),
        ("Surgeon fee - PTCA", 45000.0),
        ("Pharmacy - medicines", 21400.5),
    ]
    assert [line.line_id for line in draft.bill_lines] == ["L01", "L02", "L03"]
    assert [line.category for line in draft.bill_lines] == [
        BillCategory.room,
        BillCategory.professional_fee,
        BillCategory.pharmacy,
    ]
    assert all(line.units == 1 and line.rate == line.amount for line in draft.bill_lines)
    assert all(line.date == date(2026, 8, 3) for line in draft.bill_lines)
    assert "Check the bill line dates" in draft.warnings


def test_the_letter_gives_claimed_approved_and_deductions() -> None:
    """Amounts and deductions come from the letter; total lines are not deductions."""
    draft = CaseDraft.model_validate(_upload(_pdf(LETTER_LINES), _pdf(BILL_LINES)).json())

    assert draft.claimed == 260586.03
    assert draft.approved == 161616.27
    assert [(d.deduction_id, d.amount) for d in draft.deductions] == [("D1", 12000.0), ("D2", 2000.0)]
    assert draft.deductions[0].label == "Room rent beyond eligibility deducted"
    # Room rent links to the room line; a generic non-payable deduction has no non-medical line here.
    assert [d.line_ids for d in draft.deductions] == [["L01"], []]
    assert "Room rent beyond eligibility deducted Rs 12,000" in draft.letter_text


# --- Acceptance 2 and 3: scanned documents and policy --------------------------


@pytest.mark.parametrize("scanned", ["settlement", "bill"])
def test_a_pdf_with_no_text_layer_is_rejected(scanned: str) -> None:
    """Acceptance 2: a blank page has no text layer -> 422 with the scanned-document message."""
    letter = _pdf([]) if scanned == "settlement" else _pdf(LETTER_LINES)
    bill = _pdf([]) if scanned == "bill" else _pdf(BILL_LINES)
    response = _upload(letter, bill)
    assert response.status_code == 422
    assert response.json()["detail"] == SCANNED_MESSAGE


@pytest.mark.parametrize("doc_id", ["no_such_policy", "MC24"])
def test_unknown_or_non_policy_doc_id_is_rejected(doc_id: str) -> None:
    """Acceptance 3: only registered policies (not regulations) can be chosen."""
    assert _upload(_pdf(LETTER_LINES), _pdf(BILL_LINES), doc_id).status_code == 422


# --- Upload limits -------------------------------------------------------------


def test_a_file_that_is_not_a_pdf_is_rejected() -> None:
    """The %PDF header is checked, whatever the file name says."""
    response = _upload(b"this is plain text, not a pdf", _pdf(BILL_LINES))
    assert response.status_code == 422
    assert "PDF" in response.json()["detail"]


def test_a_file_over_ten_megabytes_is_rejected() -> None:
    """Each file is read with a 10 MB cap."""
    oversize = b"%PDF-1.7\n" + b"0" * (10 * 1024 * 1024)
    response = _upload(_pdf(LETTER_LINES), oversize)
    assert response.status_code == 422
    assert "10 MB" in response.json()["detail"]


def test_a_pdf_with_a_header_but_a_broken_body_is_rejected() -> None:
    """A truncated file that starts with %PDF is a clean 422, not a server error."""
    response = _upload(_pdf(LETTER_LINES), b"%PDF-1.7\nthis is not a real document")
    assert response.status_code == 422


def test_the_upload_endpoint_stores_nothing() -> None:
    """The draft is not a case: nothing reaches /cases until the user confirms."""
    assert _upload(_pdf(LETTER_LINES), _pdf(BILL_LINES)).status_code == 200
    assert [item["id"] for item in client.get("/cases").json()] == SAMPLE_IDS


# --- Pre-fill rules (pure text, no PDF) ----------------------------------------


def _draft(letter: str = "", bill: str = "") -> CaseDraft:
    return build_draft(DOC_ID, letter, bill)


def test_amounts_accept_rs_rupee_inr_and_indian_grouping() -> None:
    """Rs / ₹ / INR prefixes and 1,10,000-style grouping all parse."""
    bill = "Room rent Rs. 1,10,000\nSurgeon fee ₹ 45,000.50\nPharmacy INR 2,500\nOT charges Rs 8000"
    assert [line.amount for line in _draft(bill=bill).bill_lines] == [110000.0, 45000.5, 2500.0, 8000.0]


def test_a_bare_integer_without_currency_or_separator_is_not_an_amount() -> None:
    """Bed and page numbers must not become bill lines."""
    draft = _draft(bill="Bed number 12\nPage 3\nDeluxe room rent Rs 32,000")
    assert [line.particulars for line in draft.bill_lines] == ["Deluxe room rent"]


def test_total_lines_are_not_bill_lines_or_deductions() -> None:
    """A printed total is the sum, not a charge."""
    draft = _draft(
        letter="Total deducted Rs 14,000\nGrand total deductions Rs 14,000",
        bill="Grand Total Rs 98,400\nSub total Rs 50,000\nRoom rent Rs 32,000",
    )
    assert [line.particulars for line in draft.bill_lines] == ["Room rent"]
    assert draft.deductions == []


@pytest.mark.parametrize(
    ("particulars", "category"),
    [
        ("Deluxe room rent", BillCategory.room),
        ("Nursing care", BillCategory.nursing),
        ("Cardiologist consultation", BillCategory.professional_fee),
        ("Anaesthetist fee", BillCategory.professional_fee),
        ("Cath lab / OT charges", BillCategory.ot),
        ("Operation theatre", BillCategory.ot),
        ("Pharmacy - medicines", BillCategory.pharmacy),
        ("Surgical consumables", BillCategory.consumables),
        ("Guide wire and balloon catheter", BillCategory.consumables),
        ("Syringes and gloves", BillCategory.consumables),
        ("Drug-eluting stent", BillCategory.implant),
        ("Knee implant", BillCategory.implant),
        ("Blood test", BillCategory.diagnostics),
        ("Chest X-ray", BillCategory.diagnostics),
        ("CT scan", BillCategory.diagnostics),
        ("Admission kit", BillCategory.non_medical),
    ],
)
def test_categories_are_guessed_from_keywords(particulars: str, category: BillCategory) -> None:
    """Keyword guesses follow the task's list; anything else is non_medical."""
    (line,) = _draft(bill=f"{particulars} Rs 1,000").bill_lines
    assert line.category == category


def test_deductions_are_the_letter_lines_with_a_deduction_word_and_an_amount() -> None:
    """'deduct', 'disallow' and 'not payable' mark a deduction; the whole line is the reason."""
    letter = (
        "Claimed Rs 1,00,000\n"
        "Room rent deducted Rs 5,000\n"
        "Admission kit disallowed Rs 1,200\n"
        "Documentation charges not payable Rs 800\n"
        "Some deduction was made but no figure is given\n"
    )
    draft = _draft(letter=letter)
    assert [(d.label, d.amount) for d in draft.deductions] == [
        ("Room rent deducted", 5000.0),
        ("Admission kit disallowed", 1200.0),
        ("Documentation charges not payable", 800.0),
    ]
    assert draft.deductions[0].insurer_reason == "Room rent deducted Rs 5,000"
    assert draft.claimed == 100000.0


def test_missing_information_is_listed_in_warnings() -> None:
    """Whatever could not be found is named, so the user knows what to fill in."""
    draft = _draft(letter="Dear policyholder, your claim has been processed.", bill="No charges here")
    assert draft.claimed is None and draft.approved is None
    assert draft.bill_lines == [] and draft.deductions == []
    warnings = " | ".join(draft.warnings).lower()
    for expected in ("claimed", "approved", "deduction", "bill line"):
        assert expected in warnings, expected


# --- Bill line dates -----------------------------------------------------------


def _today_window(draft: CaseDraft) -> bool:
    """True when every bill line is dated today (the last-resort fallback)."""
    return all(line.date == date.today() for line in draft.bill_lines)


def test_a_line_that_carries_its_own_date_keeps_it() -> None:
    """A date written on the line wins over the admission date; it leaves the particulars."""
    bill = "Admission date: 03/08/2026\n05/08/2026 Pharmacy - medicines Rs 21,400.50"
    (line,) = _draft(bill=bill).bill_lines
    assert line.date == date(2026, 8, 5)
    assert line.particulars == "Pharmacy - medicines"


@pytest.mark.parametrize(
    ("letter", "bill"),
    [
        ("Date of admission: 03-08-2026", "Room rent Rs 32,000"),
        ("", "Admitted on 3 Aug 2026\nRoom rent Rs 32,000"),
        ("", "Date of Admission 2026-08-03\nRoom rent Rs 32,000"),
    ],
)
def test_lines_without_a_date_use_the_admission_date_from_the_letter_or_bill(
    letter: str, bill: str
) -> None:
    """The admission date is used when it is found, in either document and any common format."""
    (line,) = _draft(letter=letter, bill=bill).bill_lines
    assert line.date == date(2026, 8, 3)


def test_the_admission_date_beats_an_earlier_date_in_the_bill() -> None:
    """Admission date first; the nearest earlier date is only the second choice."""
    bill = "Bill date 01/08/2026\nRoom rent Rs 32,000"
    (line,) = _draft(letter="Admission date 03/08/2026", bill=bill).bill_lines
    assert line.date == date(2026, 8, 3)


def test_without_an_admission_date_the_nearest_earlier_date_in_the_bill_is_used() -> None:
    """Otherwise a line takes the closest date printed above it."""
    bill = "Bill date 01/08/2026\nRoom rent Rs 32,000\nDated 04/08/2026\nPharmacy Rs 500"
    first, second = _draft(bill=bill).bill_lines
    assert first.date == date(2026, 8, 1)
    assert second.date == date(2026, 8, 4)


def test_a_date_that_only_appears_after_the_line_is_not_used() -> None:
    """Only earlier dates count; with none, the date falls back to today."""
    assert _today_window(_draft(bill="Room rent Rs 32,000\nBill date 09/08/2026"))


def test_with_no_date_anywhere_today_is_used_and_the_dates_warning_is_added() -> None:
    """Last resort: today's date, and the user is always told to check."""
    draft = _draft(bill="Room rent Rs 32,000")
    assert _today_window(draft)
    assert "Check the bill line dates" in draft.warnings


def test_the_dates_warning_is_always_present_when_there_are_bill_lines() -> None:
    """Even a clean admission-date match asks the user to check the dates."""
    draft = _draft(bill="Admission date 03/08/2026\nRoom rent Rs 32,000")
    assert "Check the bill line dates" in draft.warnings


def test_impossible_dates_are_ignored() -> None:
    """31/02/2026 is not a date."""
    assert _today_window(_draft(bill="Bill date 31/02/2026\nRoom rent Rs 32,000"))


# --- POST /cases (the confirmed case) -------------------------------------------


def _new_case(**overrides: Any) -> dict[str, Any]:
    """A valid NewCase body: two bill lines (total 77,000) and one deduction."""
    body: dict[str, Any] = {
        "doc_id": DOC_ID,
        "schedule": {
            "sum_insured": 500000,
            "inception_date": "2021-06-01",
            "eligible_room_rent_per_day": 5000,
        },
        "patient": {"name": "Asha Rao", "age": 44},
        "admission": {
            "hospital": "City Hospital",
            "admitted": "2026-08-03T09:30:00",
            "discharged": "2026-08-07T12:00:00",
            "diagnosis": "Appendicitis",
            "room_category": "Deluxe room (Rs 8,000/day)",
            "cashless": False,
        },
        "bill_lines": [
            {
                "line_id": "L01",
                "date": "2026-08-03",
                "particulars": "Deluxe room rent",
                "category": "room",
                "rate": 8000,
                "units": 4,
                "amount": 32000,
            },
            {
                "line_id": "L02",
                "date": "2026-08-04",
                "particulars": "Surgeon fee",
                "category": "professional_fee",
                "rate": 45000,
                "units": 1,
                "amount": 45000,
            },
        ],
        "deductions": [
            {
                "deduction_id": "D1",
                "label": "Room rent beyond eligibility",
                "amount": 12000,
                "line_ids": ["L01"],
                "insurer_reason": "Room rent restricted to Rs 5,000 per day",
            }
        ],
        "claimed": 77000,
        "approved": 65000,
        "letter_text": "Claim approved with deductions.",
    }
    body.update(overrides)
    return body


def _create(**overrides: Any) -> Any:
    return client.post("/cases", json=_new_case(**overrides))


def test_a_confirmed_case_is_stored_and_served_back() -> None:
    """Acceptance 4: user_ id, bill.total = sum of lines, listed after the five samples."""
    response = _create()
    assert response.status_code == 201, response.text
    case_id = response.json()["case_id"]
    assert re.fullmatch(r"user_[0-9a-f]{8}", case_id)

    got = client.get(f"/cases/{case_id}")
    assert got.status_code == 200, got.text
    case = Case.model_validate(got.json())
    assert case.case_id == case_id
    assert case.bill.total == 77000
    assert case.settlement.total_deducted == 12000
    assert case.settlement.claimed == 77000 and case.settlement.approved == 65000
    assert case.title == "Room rent beyond eligibility"
    assert case.synthetic_notice == "Uploaded by the user"
    assert case.expected == [] and case.timeline == []
    assert case.policy.doc_id == DOC_ID
    assert case.policy.product == "Family Health Optima Insurance Plan"
    assert case.policy.schedule.eligible_room_rent_per_day == 5000

    listed = [item["id"] for item in client.get("/cases").json()]
    assert listed == [*SAMPLE_IDS, case_id]


def test_uploaded_cases_are_listed_newest_first_after_the_samples() -> None:
    """Order: samples, then uploaded cases with the newest first."""
    first = _create().json()["case_id"]
    second = _create().json()["case_id"]
    assert first != second
    listed = [item["id"] for item in client.get("/cases").json()]
    assert listed == [*SAMPLE_IDS, second, first]


def test_the_form_timeline_is_kept() -> None:
    """An optional cashless timeline from the form is stored with the case."""
    timeline = [{"event": "cashless_request", "at": "2026-08-03T09:45:00"}]
    case_id = _create(timeline=timeline).json()["case_id"]
    case = Case.model_validate(client.get(f"/cases/{case_id}").json())
    assert [event.event.value for event in case.timeline] == ["cashless_request"]


def test_a_deduction_naming_an_unknown_line_is_rejected() -> None:
    """Acceptance 5: a deduction must point at lines that exist."""
    bad = _new_case()["deductions"][0] | {"line_ids": ["L99"]}
    assert _create(deductions=[bad]).status_code == 422


def test_approved_above_claimed_is_rejected() -> None:
    """The insurer cannot approve more than was claimed."""
    assert _create(claimed=70000, approved=70000.01).status_code == 422


def test_a_deduction_above_the_bill_total_is_rejected() -> None:
    """A single deduction larger than the whole bill cannot be right."""
    big = _new_case()["deductions"][0] | {"amount": 77000.01}
    assert _create(deductions=[big]).status_code == 422


def test_an_unknown_policy_is_rejected() -> None:
    """The policy must be a registered one, as in the upload step."""
    assert _create(doc_id="no_such_policy").status_code == 422


@pytest.mark.parametrize("field", ["bill_lines", "deductions"])
def test_an_empty_bill_or_no_deductions_is_rejected(field: str) -> None:
    """Nothing to analyse without lines and at least one deduction."""
    assert _create(**{field: []}).status_code == 422


def test_unknown_user_case_is_404() -> None:
    """An id that looks like an upload but is not stored is a plain 404."""
    assert client.get("/cases/user_deadbeef").status_code == 404


def test_user_case_ids_are_never_turned_into_file_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A user_ id is looked up in SQLite only: a same-named JSON file on disk is not served."""
    cases_dir = tmp_path / "data" / "cases"
    cases_dir.mkdir(parents=True)
    sample = json.loads((BACKEND_DIR.parent / "data" / "cases" / "case_a.json").read_text())
    (cases_dir / "user_deadbeef.json").write_text(json.dumps(sample | {"case_id": "user_deadbeef"}))
    monkeypatch.setattr(settings, "data_dir", tmp_path / "data")

    assert client.get("/cases/user_deadbeef").status_code == 404
    assert client.get("/cases/user_..%2Fcase_a").status_code == 404


def test_duplicate_deduction_ids_are_rejected() -> None:
    """Verdicts are keyed by deduction id; two D1s would make the saved analysis fail later."""
    deduction = _new_case()["deductions"][0]
    second = deduction | {"label": "Other deduction", "amount": 1000}
    assert _create(deductions=[deduction, second]).status_code == 422


def test_labelled_details_are_pre_filled_and_the_room_line_gets_a_daily_rate() -> None:
    """Patient, hospital, dates and sum insured come from labelled lines; room rent per day from the room line."""
    letter = (
        "Insured patient: Ananya Bora (fictional)\n"
        "Policy: Family Health Optima, sum insured Rs. 5,00,000\n"
        "Hospital: Synthetic City Hospital, Guwahati\n"
        "Date of admission: 12/09/2026\n"
        "Date of discharge: 15/09/2026\n"
        "Amount claimed: Rs. 1,12,500.00\n"
    )
    bill = (
        "Admitted: 12/09/2026    Discharged: 15/09/2026\n"
        "12/09/2026 Twin sharing room rent 13,500.00\n"
        "12/09/2026 Nursing charges 3,000.00\n"
    )
    draft = _draft(letter=letter, bill=bill)
    assert draft.patient_name == "Ananya Bora (fictional)"
    assert draft.hospital == "Synthetic City Hospital, Guwahati"
    assert draft.admitted == date(2026, 9, 12)
    assert draft.discharged == date(2026, 9, 15)
    assert draft.sum_insured == 500000.0
    assert draft.room_rent_per_day == 4500.0
    room = draft.bill_lines[0]
    assert (room.rate, room.units, room.amount) == (4500.0, 3, 13500.0)


def test_details_stay_empty_when_the_documents_do_not_state_them() -> None:
    """Nothing is invented: unlabelled documents leave the details for the user."""
    draft = _draft(letter="Claim settled\n", bill="Room rent 8,000.00\n")
    assert (draft.patient_name, draft.hospital, draft.admitted, draft.discharged) == (None, None, None, None)
    assert draft.sum_insured is None and draft.room_rent_per_day is None


def test_deductions_are_linked_to_the_bill_lines_their_label_covers() -> None:
    """Room rent, associated expenses, other expenses and named non-payable items each get their lines."""
    letter = (
        "Room rent beyond eligibility (deducted) Rs. 12,000.00\n"
        "Proportionate deduction - associated medical expenses (deducted) Rs. 44,250.00\n"
        "Proportionate deduction - other expenses (deducted) Rs. 40,719.76\n"
        "Non-payable items - documentation charges (deducted) Rs. 800.00\n"
    )
    bill = (
        "03/08/2026 Deluxe room rent 32,000.00\n"
        "03/08/2026 Nursing charges 3,000.00\n"
        "03/08/2026 Surgeon fee 45,000.00\n"
        "04/08/2026 OT charges 30,000.00\n"
        "04/08/2026 Drug-eluting stent 39,186.03\n"
        "04/08/2026 Guide wire and balloon catheter 18,500.00\n"
        "03/08/2026 Pharmacy - medicines 21,400.00\n"
        "03/08/2026 Blood investigations 7,800.00\n"
        "03/08/2026 Admission kit 1,200.00\n"
        "03/08/2026 Documentation charges 800.00\n"
    )
    draft = _draft(letter=letter, bill=bill)
    links = {d.deduction_id: d.line_ids for d in draft.deductions}
    assert links == {
        "D1": ["L01"],
        "D2": ["L02", "L03", "L04"],
        "D3": ["L05", "L06", "L07", "L08"],
        "D4": ["L10"],
    }
    assert "Check the bill lines linked to each deduction" in draft.warnings


def test_a_generic_non_payable_deduction_links_every_non_medical_line() -> None:
    draft = _draft(
        letter="Non-payable items (deducted) Rs. 2,000.00\n",
        bill="03/08/2026 Admission kit 1,200.00\n03/08/2026 Documentation charges 800.00\n03/08/2026 Surgeon fee 5,000.00\n",
    )
    assert draft.deductions[0].line_ids == ["L01", "L02"]


def test_case_a_as_pdfs_is_linked_like_the_sample_case() -> None:
    """Case A rebuilt as two text PDFs links exactly as data/cases/case_a.json does."""
    sample = json.loads((BACKEND_DIR.parent / "data" / "cases" / "case_a.json").read_text())
    deductions = sample["settlement"]["deductions"]
    letter = [f"{d['label']} (deducted) Rs. {d['amount']:,.2f}" for d in deductions]
    bill = [f"{line['date']} {line['particulars']} {line['amount']:,.2f}" for line in sample["bill"]["lines"]]
    response = _upload(_pdf(letter), _pdf(bill))
    assert response.status_code == 200
    linked = [d["line_ids"] for d in response.json()["deductions"]]
    assert linked == [d["line_ids"] for d in deductions]
