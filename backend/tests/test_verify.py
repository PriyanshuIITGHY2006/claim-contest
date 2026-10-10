"""Acceptance tests for TASK-03: quote verifier (the citation gate).

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
from app.models.schemas import Rule  # noqa: E402
from app.services import rules as rules_service  # noqa: E402
from app.services import verify as verify_service  # noqa: E402

client = TestClient(app)

MC24_17C = (
    "Pursuant to intimation of the claim, Insurers and Third Party Administrators "
    "(TPAs) shall collect the required documents from the Hospitals. Policyholder "
    "shall not be required to submit the documents."
)


def test_exact_quote_returns_exact_verified() -> None:
    """Verifying the exact MC24-17c text returns exact, verified (acceptance #2)."""
    response = client.post(
        "/verify-quote",
        json={"source_type": "rule", "source_id": "MC24-17c", "quote": MC24_17C},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["match"] == "exact"
    assert body["verified"] is True
    assert body["page"] == 24


def test_substring_quote_returns_verified() -> None:
    """A substring of the rule text verifies (acceptance #3)."""
    response = client.post(
        "/verify-quote",
        json={
            "source_type": "rule",
            "source_id": "MC24-17c",
            "quote": "Policyholder shall not be required to submit the documents",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["verified"] is True
    assert body["match"] == "exact"


def test_nonmatching_quote_returns_none_not_verified() -> None:
    """A quote absent from the source returns none, not verified (acceptance #4)."""
    response = client.post(
        "/verify-quote",
        json={
            "source_type": "rule",
            "source_id": "MC24-17c",
            "quote": "Policyholder must submit all documents within 7 days",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["match"] == "none"
    assert body["verified"] is False


def test_unverified_rule_fixture_is_never_verified() -> None:
    """A rule marked verified: false never verifies, even on an exact match (#5)."""
    fixture = Rule(
        id="FIX-1",
        doc="MC24",
        para="1",
        page=1,
        verified=False,
        ground="test",
        text="The insurer shall act in good faith.",
        test="fixture",
    )
    outcome = verify_service.verify_quote(
        "rule", "FIX-1", "The insurer shall act in good faith.", rules=[fixture]
    )
    assert outcome.verified is False


def test_clean_text_against_ocr_source_returns_fuzzy() -> None:
    """Clean PPI24-B-VI-3-i text vs its Part B (OCR artefacts) source is fuzzy (#7).

    The Part B PDF text is not extracted until TASK-02 lands, so the OCR artefacts
    documented on the rule ("p .rovided", "com plaints") are reproduced here and
    matched with the pure matcher the endpoint uses.
    """
    clean = rules_service.get_rule("PPI24-B-VI-3-i").text
    ocr_source = clean.replace("provided", "p .rovided").replace(
        "complaints", "com plaints"
    )
    match, score = verify_service.match_quote(clean, ocr_source)
    assert match == "fuzzy"
    assert score >= 0.92


def test_quote_padded_with_invented_text_is_not_verified() -> None:
    """The real rule text plus an invented sentence must not verify."""
    for quote in (
        MC24_17C + " Insurer must also pay 18% interest on every claim.",
        "Insurer may reject any claim at its discretion. " + MC24_17C,
    ):
        outcome = verify_service.verify_quote("rule", "MC24-17c", quote)
        assert outcome.verified is False, quote


def test_fuzzy_match_rejects_a_few_invented_words() -> None:
    """A short invented tail stays above 92 but adds words the source lacks."""
    quote = (
        "Such associated medical expenses do not include Cost of pharmacy and "
        "consumables, Cost of implants and medical devices and Cost of diagnostics "
        "or nursing."
    )
    outcome = verify_service.verify_quote("policy", "star_fho_v19", quote)
    assert outcome.verified is False


def test_fuzzy_match_rejects_dropped_negation() -> None:
    """Removing "not" flips the meaning, so a near-match must not verify."""
    quote = MC24_17C.replace("shall not be required", "shall be required")
    outcome = verify_service.verify_quote("rule", "MC24-17c", quote)
    assert outcome.verified is False


def test_fuzzy_match_rejects_changed_time_limit() -> None:
    """Changing "one hour" to "three hours" must not verify."""
    quote = rules_service.get_rule("MC24-15b").text.replace("one hour", "three hours")
    outcome = verify_service.verify_quote("rule", "MC24-15b", quote)
    assert outcome.verified is False


def test_fuzzy_match_rejects_changed_digits() -> None:
    """Changing "60 months" to "96 months" must not verify."""
    quote = rules_service.get_rule("MC24-13").text.replace("60 months", "96 months")
    outcome = verify_service.verify_quote("rule", "MC24-13", quote)
    assert outcome.verified is False


def test_too_short_quote_is_not_verified() -> None:
    """A quote under five words cannot support a citation."""
    outcome = verify_service.verify_quote("rule", "MC24-17c", "the Hospitals")
    assert outcome.verified is False
    assert outcome.match == "none"


def test_policy_quote_verifies_against_extracted_text_with_page() -> None:
    """A policy quote is checked against the extracted PDF text and reports its page."""
    response = client.post(
        "/verify-quote",
        json={
            "source_type": "policy",
            "source_id": "star_fho_v19",
            "quote": "Such associated medical expenses do not include Cost of pharmacy "
            "and consumables, Cost of implants and medical devices and Cost of diagnostics.",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["verified"] is True
    assert body["match"] == "exact"
    assert isinstance(body["page"], int) and body["page"] > 0


def test_unknown_source_returns_404() -> None:
    """Unknown rule and policy ids are both 404, not a silent "not verified"."""
    for source_type, source_id in (("rule", "nope"), ("policy", "nope")):
        response = client.post(
            "/verify-quote",
            json={
                "source_type": source_type,
                "source_id": source_id,
                "quote": "the insurer shall pay the claim in full",
            },
        )
        assert response.status_code == 404, source_type


def test_policy_anchor_quote_verifies() -> None:
    """The anchors.yaml moratorium quote verifies against the Star FHO text."""
    outcome = verify_service.verify_quote(
        "policy",
        "star_fho_v19",
        "After completion of eight continuous years under the policy no look back "
        "to be applied. This period of eight years is called as moratorium period.",
    )
    assert outcome.verified is True
    assert outcome.match == "exact"


def test_quote_cut_after_leading_negation_is_rejected() -> None:
    """Dropping the source's leading "No" inverts MC24-13; it must not verify."""
    words = rules_service.get_rule("MC24-13").text.split()
    assert words[0] == "No"
    truncated = " ".join(words[1:14])
    outcome = verify_service.verify_quote("rule", "MC24-13", truncated)
    assert outcome.verified is False
    assert outcome.match == "none"
    with_negation = " ".join(words[0:14])
    full = verify_service.verify_quote("rule", "MC24-13", with_negation)
    assert full.match == "exact"


def test_fuzzy_match_rejects_reordered_words() -> None:
    """A fuzzy match must keep the source's word order."""
    words = rules_service.get_rule("MC24-16b").text.split()[:20]
    words[3], words[4] = words[4], words[3]
    outcome = verify_service.verify_quote("rule", "MC24-16b", " ".join(words))
    assert outcome.verified is False
