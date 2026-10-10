"""Acceptance tests for TASK-05: Ombudsman precedent finder.

Written before the implementation (TDD). Run with:
``cd backend && .venv/bin/pytest -q``

The corpus tests parse all six award books once (cached for the session), so the
first call is slow; the pure-helper tests run without touching the PDFs.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

from fastapi.testclient import TestClient

# The pytest console script does not add the CWD to sys.path, so make the
# ``app`` package importable when running from backend/.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402
from app.models.schemas import Precedent, PrecedentOutcome  # noqa: E402
from app.services.precedents import (  # noqa: E402
    _BOOKS,
    _award_starts,
    _case_no,
    _outcome,
    _year,
    all_awards,
)

client = TestClient(app)


def _search(query: str, k: int) -> list[Precedent]:
    """POST /precedents/search and validate the body as ``Precedent[]``."""
    response = client.post("/precedents/search", json={"query": query, "k": k})
    assert response.status_code == 200, response.text
    return [Precedent.model_validate(item) for item in response.json()]


def _mentions_ped(excerpt: str) -> bool:
    """True when ``excerpt`` names a pre-existing disease (word or abbreviation)."""
    folded = excerpt.lower()
    return (
        "pre-existing" in folded
        or "pre existing" in folded
        or re.search(r"\bped\b", folded) is not None
    )


# --- Acceptance 1: the splitter parses the six books -------------------------


def test_splitter_parses_at_least_800_awards_and_no_book_is_empty() -> None:
    """Acceptance 1: >= 800 de-duplicated awards in total, every book contributes."""
    awards = all_awards()
    assert len(awards) >= 800, f"only {len(awards)} awards parsed"

    per_book = Counter(award.book for award in awards)
    assert set(per_book) == set(_BOOKS), "every registered book must be parsed"
    for book, count in per_book.items():
        assert count > 0, f"{book} yielded zero awards"


# --- Acceptance 2: every award has an id-worthy case_no and excerpt ----------


def test_every_award_has_a_non_empty_case_no_and_excerpt() -> None:
    """Acceptance 2: no award is missing its case number or display excerpt."""
    awards = all_awards()
    assert awards, "no awards parsed"
    empty_case_no = [a.precedent_id for a in awards if not a.case_no.strip()]
    empty_excerpt = [a.precedent_id for a in awards if not a.excerpt.strip()]
    assert not empty_case_no, f"awards with empty case_no: {empty_case_no[:10]}"
    assert not empty_excerpt, f"awards with empty excerpt: {empty_excerpt[:10]}"


# --- Acceptance 3 & 4: search surfaces the right awards ----------------------


def test_room_rent_proportionate_deduction_returns_k_positive_scores() -> None:
    """Acceptance 3: a room-rent query returns k precedents, all scored above 0."""
    results = _search("room rent proportionate deduction", k=5)
    assert len(results) == 5, "k caps the result list"
    assert all(result.score > 0 for result in results), [r.score for r in results]
    scores = [result.score for result in results]
    assert scores == sorted(scores, reverse=True), "results come back best-first"


def test_pre_existing_disease_search_returns_an_excerpt_mentioning_it() -> None:
    """Acceptance 4: a PED query surfaces an award whose excerpt names the issue."""
    results = _search("pre-existing disease non-disclosure", k=10)
    assert results, "PED search returned nothing"
    assert any(_mentions_ped(result.excerpt) for result in results), [
        result.excerpt[:80] for result in results
    ]


# --- Endpoint shape and the optional year / outcome fields -------------------


def test_search_endpoint_returns_typed_precedents_with_optional_fields() -> None:
    """The endpoint serves ``Precedent[]``; year and outcome may be null."""
    results = _search("cashless hospitalisation delay", k=3)
    assert len(results) == 3
    for result in results:
        assert result.precedent_id and result.book and result.case_no and result.excerpt
        assert result.year is None or 2000 <= result.year <= 2016
        assert result.outcome is None or isinstance(result.outcome, PrecedentOutcome)
        assert result.score > 0


def test_search_defaults_k_to_three() -> None:
    """``k`` defaults to 3 per the interface when the caller omits it."""
    response = client.post("/precedents/search", json={"query": "room rent cap"})
    assert response.status_code == 200, response.text
    assert len(response.json()) == 3


# --- Pure helpers (fast, no PDF parsing) -------------------------------------


def test_year_picks_the_most_frequent_in_range_and_none_otherwise() -> None:
    """``_year`` counts only 2000..2016 and returns None when there is none."""
    assert _year("decided on 12.5.2011, referred to 2011 and 2010") == 2011
    assert _year("no year here, just 1999 and 2017") is None
    assert _year("policy of 1998") is None


def test_outcome_prefers_partly_then_dismissed_then_allowed() -> None:
    """``_outcome`` reads the most specific keyword; "disallowed" is not "allowed"."""
    assert _outcome("the complaint is partly allowed") == PrecedentOutcome.partly
    assert _outcome("the complaint is dismissed") == PrecedentOutcome.dismissed
    assert _outcome("the appeal is allowed") == PrecedentOutcome.allowed
    assert _outcome("the claim was disallowed in full") is None
    assert _outcome("nothing about the disposition here") is None


def test_case_no_extracts_text_after_no_case_insensitively() -> None:
    """``_case_no`` reads the number after "No." in any letter case."""
    assert _case_no("Case No. 14-003-0583-12") == "14-003-0583-12"
    assert _case_no("CASE NO. GIC/190/OIC/11/09") == "GIC/190/OIC/11/09"
    assert _case_no("Complaint No. IO/KCH/GI/10-004-223/2011-12") == "IO/KCH/GI/10-004-223/2011-12"
    assert _case_no("Case No.11.004.0216") == "11.004.0216"



def test_order_no_header_with_case_no_starts_a_new_award() -> None:
    """Bhopal awards print "Order No.: ...   Case No.: ..." on one line."""
    lines = [
        "Case No.11-004-0115-09",
        "Mr. A Vs. United India Insurance Co. Ltd.",
        "The complaint is dismissed.",
        "Bhopal Ombudsman Centre",
        "Shri S.N. Saraf V/s The New India Assurance Co. Indore",
        "Order No.: BPL/GI/08-09/10                   Case No.: GI/NIA/0408/13",
        "Order Dated: 26/06/2008",
        "Brief Background",
    ]
    assert _award_starts(lines) == [0, 5]
    assert _case_no(lines[5]) == "GI/NIA/0408/13"


def test_no_award_swallows_several_others() -> None:
    """A parsed award holding many "Order/Award dated" lines means missed headers."""
    glued = [
        a.precedent_id
        for a in all_awards()
        if len(re.findall(r"(?i)\b(?:award|order) dated\b", a.text)) > 3
    ]
    assert not glued, f"awards that look like several glued together: {glued[:10]}"
