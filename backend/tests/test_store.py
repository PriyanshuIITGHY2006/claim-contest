"""Acceptance tests for TASK-14: SQLite persistence, analyses and drafts API.

Written before the implementation (TDD). Run with:
``cd backend && .venv/bin/pytest -q``

Every test points the app at a throwaway SQLite file (pytest ``tmp_path`` +
overriding ``settings.database_url``) so ``backend/app.db`` is never touched.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

# The pytest console script does not add the CWD to sys.path, so make the
# ``app`` package importable when running from backend/.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402
from app.models.schemas import (  # noqa: E402
    Analysis,
    AnalysisStatus,
    Draft,
    DraftLanguage,
    DraftTier,
    Verdict,
)
from app.settings import settings  # noqa: E402

REPO_ROOT = BACKEND_DIR.parent
CASES_DIR = REPO_ROOT / "data" / "cases"

client = TestClient(app)


@pytest.fixture(autouse=True)
def _tmp_db(tmp_path: Path) -> Iterator[None]:
    """Point the app at a temporary SQLite file; restore the original after."""
    original = settings.database_url
    settings.database_url = f"sqlite:///{tmp_path / 'test.db'}"
    yield
    settings.database_url = original


def _verdict(deduction_id: str, recoverable: float, status: str = "valid") -> Verdict:
    """A minimal verdict used to build analyses in the tests."""
    return Verdict(
        deduction_id=deduction_id,
        status=status,
        recoverable_amount=recoverable,
        reasoning="",
        citations=[],
        confidence=1.0,
    )


def _case_a_analysis(analysis_id: str = "analysis_case_a") -> Analysis:
    """Build the case-A result the agent would post (total recoverable 40719.76)."""
    raw = json.loads((CASES_DIR / "case_a.json").read_text())
    verdicts = [
        Verdict(
            deduction_id=exp["deduction_id"],
            status=exp["status"],
            recoverable_amount=exp["recoverable"],
            reasoning=exp.get("note", ""),
            citations=[],  # scripted mode carries no citations
            confidence=1.0,
        )
        for exp in raw["expected"]
        if exp["deduction_id"] != "LETTER"  # letter-not-specific is a flag, not a verdict
    ]
    return Analysis(
        analysis_id=analysis_id,
        case_id="case_a",
        status=AnalysisStatus.done,
        verdicts=verdicts,
        total_recoverable=40719.76,
        flags=[],
    )


def _post_analysis(analysis_id: str = "analysis_case_a") -> Analysis:
    """POST the case-A analysis and return the parsed request body."""
    analysis = _case_a_analysis(analysis_id)
    resp = client.post("/analyses", json=analysis.model_dump(mode="json"))
    assert resp.status_code == 201, resp.text
    return analysis


def _post_draft(draft: Draft) -> None:
    resp = client.post("/drafts", json=draft.model_dump(mode="json"))
    assert resp.status_code == 201, resp.text


# --- Acceptance 1: round-trip -------------------------------------------------


def test_post_analysis_then_get_returns_identical_verdicts_and_total() -> None:
    """Acceptance 1: GET returns the posted verdicts and total_recoverable 40719.76."""
    analysis = _post_analysis()

    got = client.get("/analyses/analysis_case_a")
    assert got.status_code == 200, got.text
    body = Analysis.model_validate(got.json())
    assert body.total_recoverable == 40719.76
    assert [v.deduction_id for v in body.verdicts] == [
        v.deduction_id for v in analysis.verdicts
    ]
    assert [v.recoverable_amount for v in body.verdicts] == [
        v.recoverable_amount for v in analysis.verdicts
    ]


# --- Acceptance 2: draft approval --------------------------------------------


def test_draft_starts_unapproved_then_patch_approves() -> None:
    """Acceptance 2: a draft starts human_approved false; PATCH sets it true."""
    _post_analysis()
    draft = Draft(
        draft_id="draft_a_1",
        analysis_id="analysis_case_a",
        tier=DraftTier.tier_1,
        language=DraftLanguage.en,
        letter_markdown="Dear insurer, please reconsider...",
        local_summary="Room-rent cut was disproportionate.",
        human_approved=False,
    )
    _post_draft(draft)

    patch = client.patch("/drafts/draft_a_1", json={"human_approved": True})
    assert patch.status_code == 200, patch.text
    assert patch.json()["human_approved"] is True

    got = client.get("/drafts/draft_a_1")
    assert got.status_code == 200, got.text
    assert Draft.model_validate(got.json()).human_approved is True


def test_draft_is_always_created_unapproved() -> None:
    """A draft posted with human_approved true is still created unapproved."""
    _post_analysis()
    draft = Draft(
        draft_id="draft_forced",
        analysis_id="analysis_case_a",
        tier=DraftTier.tier_1,
        language=DraftLanguage.en,
        letter_markdown="x",
        local_summary="x",
        human_approved=True,
    )
    resp = client.post("/drafts", json=draft.model_dump(mode="json"))
    assert resp.status_code == 201, resp.text
    assert Draft.model_validate(resp.json()).human_approved is False


# --- Acceptance 3: unknown analysis ------------------------------------------


def test_unknown_analysis_404() -> None:
    """Acceptance 3: GET /analyses/{id} on an unknown id returns 404."""
    assert client.get("/analyses/does-not-exist").status_code == 404


# --- Acceptance 4: temporary database ----------------------------------------


def test_uses_temporary_database_not_app_db(tmp_path: Path) -> None:
    """Acceptance 4: the store writes to the test DB, never backend/app.db."""
    db_path = settings.database_path
    assert db_path.parent == tmp_path, f"expected {tmp_path}, got {db_path}"
    assert db_path != BACKEND_DIR / "app.db"


# --- Acceptance 5: idempotent post -------------------------------------------


def test_posting_same_analysis_twice_keeps_one_copy() -> None:
    """Acceptance 5: re-posting the same analysis does not duplicate verdicts."""
    analysis = _case_a_analysis("analysis_dup")
    payload = analysis.model_dump(mode="json")
    assert client.post("/analyses", json=payload).status_code == 201
    assert client.post("/analyses", json=payload).status_code == 201

    got = Analysis.model_validate(client.get("/analyses/analysis_dup").json())
    assert len(got.verdicts) == len(analysis.verdicts)


def test_repost_replaces_previous_version() -> None:
    """Re-posting with different content keeps only the second version."""
    analysis = _case_a_analysis("analysis_v2")
    assert client.post("/analyses", json=analysis.model_dump(mode="json")).status_code == 201

    modified = analysis.model_copy(
        update={"verdicts": analysis.verdicts[:1], "total_recoverable": 0.0}
    )
    assert client.post("/analyses", json=modified.model_dump(mode="json")).status_code == 201

    got = Analysis.model_validate(client.get("/analyses/analysis_v2").json())
    assert [v.deduction_id for v in got.verdicts] == ["D1"]


# --- Acceptance 6: total validation ------------------------------------------


def test_total_mismatch_rejected() -> None:
    """Acceptance 6: total_recoverable not matching its verdicts → 422."""
    analysis = _case_a_analysis("analysis_bad_total")
    analysis.total_recoverable = 999999.0
    resp = client.post("/analyses", json=analysis.model_dump(mode="json"))
    assert resp.status_code == 422


def test_duplicate_deduction_ids_rejected() -> None:
    """A verdict list with duplicate deduction_ids → 422."""
    analysis = _case_a_analysis("analysis_dup_deduction")
    analysis.verdicts.append(_verdict("D1", 0.0))
    resp = client.post("/analyses", json=analysis.model_dump(mode="json"))
    assert resp.status_code == 422


# --- Acceptance 7: approval gate ---------------------------------------------


def test_tier2_draft_requires_tier1_approval() -> None:
    """Acceptance 7: tier-2 is 409 until the tier-1 draft is approved, then 201."""
    _post_analysis()
    tier2 = Draft(
        draft_id="draft_a_2",
        analysis_id="analysis_case_a",
        tier=DraftTier.tier_2,
        language=DraftLanguage.en,
        letter_markdown="Escalation to Bima Bharosa.",
        local_summary="Escalating the grievance.",
        human_approved=False,
    )
    assert client.post("/drafts", json=tier2.model_dump(mode="json")).status_code == 409

    tier1 = Draft(
        draft_id="draft_a_1",
        analysis_id="analysis_case_a",
        tier=DraftTier.tier_1,
        language=DraftLanguage.en,
        letter_markdown="Grievance to insurer GRO.",
        local_summary="First escalation.",
        human_approved=False,
    )
    _post_draft(tier1)
    assert client.patch("/drafts/draft_a_1", json={"human_approved": True}).status_code == 200

    assert client.post("/drafts", json=tier2.model_dump(mode="json")).status_code == 201


# --- Draft 404s ---------------------------------------------------------------


def test_draft_for_unknown_analysis_404() -> None:
    """POST /drafts for an unknown analysis_id → 404."""
    draft = Draft(
        draft_id="draft_x",
        analysis_id="does-not-exist",
        tier=DraftTier.tier_1,
        language=DraftLanguage.en,
        letter_markdown="x",
        local_summary="x",
        human_approved=False,
    )
    assert client.post("/drafts", json=draft.model_dump(mode="json")).status_code == 404


def test_get_unknown_draft_404() -> None:
    """GET /drafts/{id} on an unknown draft → 404."""
    assert client.get("/drafts/does-not-exist").status_code == 404


# --- Verdict order ------------------------------------------------------------


def test_verdicts_returned_in_posted_order() -> None:
    """Verdicts come back in exactly the posted order, not sorted."""
    analysis = _case_a_analysis("analysis_order")
    analysis.verdicts = list(reversed(analysis.verdicts))
    resp = client.post("/analyses", json=analysis.model_dump(mode="json"))
    assert resp.status_code == 201, resp.text

    got = Analysis.model_validate(client.get("/analyses/analysis_order").json())
    assert [v.deduction_id for v in got.verdicts] == [
        v.deduction_id for v in analysis.verdicts
    ]


# --- Paise-precision total check ---------------------------------------------


def test_total_off_by_one_paise_is_accepted() -> None:
    """A 1-paise difference is within tolerance and accepted."""
    analysis = Analysis(
        analysis_id="analysis_paise_ok",
        case_id="case_a",
        status=AnalysisStatus.done,
        verdicts=[_verdict("D1", 100.00)],
        total_recoverable=100.01,
        flags=[],
    )
    resp = client.post("/analyses", json=analysis.model_dump(mode="json"))
    assert resp.status_code == 201, resp.text


def test_total_off_by_two_paise_is_rejected() -> None:
    """A 2-paise difference exceeds tolerance and is rejected."""
    analysis = Analysis(
        analysis_id="analysis_paise_bad",
        case_id="case_a",
        status=AnalysisStatus.done,
        verdicts=[_verdict("D1", 100.00)],
        total_recoverable=100.02,
        flags=[],
    )
    resp = client.post("/analyses", json=analysis.model_dump(mode="json"))
    assert resp.status_code == 422


def test_posting_an_existing_draft_id_returns_409_and_keeps_the_original() -> None:
    """A retried draft post must not crash (500) or overwrite an approved draft."""
    _post_analysis()
    draft = Draft(
        draft_id="draft_dup",
        analysis_id="analysis_case_a",
        tier=DraftTier.tier_1,
        language=DraftLanguage.en,
        letter_markdown="First version",
        local_summary="First summary",
        human_approved=False,
    )
    _post_draft(draft)
    client.patch("/drafts/draft_dup", json={"human_approved": True})

    retry = client.post(
        "/drafts",
        json=draft.model_copy(update={"letter_markdown": "Second"}).model_dump(mode="json"),
    )
    assert retry.status_code == 409, retry.text

    kept = Draft.model_validate(client.get("/drafts/draft_dup").json())
    assert kept.letter_markdown == "First version"
    assert kept.human_approved is True


# --- GET /analyses (TASK-18: list for the dashboard) ---------------------------


def _post_listed(
    analysis_id: str,
    case_id: str,
    finished_at: str | None,
    status: AnalysisStatus = AnalysisStatus.done,
    total: float = 100.0,
) -> None:
    """Store a one-verdict analysis for ``case_id`` that finished at ``finished_at``."""
    analysis = Analysis(
        analysis_id=analysis_id,
        case_id=case_id,
        status=status,
        verdicts=[_verdict("D1", total)],
        total_recoverable=total,
        flags=[],
        finished_at=finished_at,
    )
    resp = client.post("/analyses", json=analysis.model_dump(mode="json"))
    assert resp.status_code == 201, resp.text


def _listed_ids(path: str = "/analyses") -> list[str]:
    response = client.get(path)
    assert response.status_code == 200, response.text
    return [item["analysis_id"] for item in response.json()]


def test_list_returns_all_analyses_newest_first_and_filters_by_case() -> None:
    """Acceptance 1: two analyses for case A and one for case B, newest first."""
    _post_listed("a_old", "case_a", "2026-10-10T10:00:00Z")
    _post_listed("b_mid", "case_b", "2026-10-10T11:00:00Z")
    _post_listed("a_new", "case_a", "2026-10-10T12:00:00Z")

    assert _listed_ids() == ["a_new", "b_mid", "a_old"]
    assert _listed_ids("/analyses?case_id=case_a") == ["a_new", "a_old"]
    assert _listed_ids("/analyses?case_id=case_b") == ["b_mid"]


def test_list_rows_carry_only_the_summary_fields() -> None:
    """Each row is {analysis_id, case_id, status, total_recoverable, finished_at}, no verdicts."""
    _post_listed("a_1", "case_a", "2026-10-10T10:00:00Z", total=40719.76)

    (row,) = client.get("/analyses").json()
    assert set(row) == {"analysis_id", "case_id", "status", "total_recoverable", "finished_at"}
    assert row["analysis_id"] == "a_1" and row["case_id"] == "case_a"
    assert row["status"] == "done" and row["total_recoverable"] == 40719.76
    assert row["finished_at"].startswith("2026-10-10T10:00:00")


def test_list_is_empty_when_nothing_is_stored_or_the_case_is_unknown() -> None:
    """Acceptance 5: no analyses -> []; an unknown case_id filter -> []."""
    assert client.get("/analyses").json() == []
    _post_listed("a_1", "case_a", "2026-10-10T10:00:00Z")
    assert client.get("/analyses?case_id=no_such_case").json() == []


def test_list_puts_unfinished_analyses_after_finished_ones() -> None:
    """finished_at is ordered descending with nulls last, then newest insertion first."""
    _post_listed("run_1", "case_a", None, AnalysisStatus.running)
    _post_listed("done_old", "case_a", "2026-10-10T09:00:00Z")
    _post_listed("run_2", "case_a", None, AnalysisStatus.running)
    _post_listed("done_new", "case_a", "2026-10-10T10:00:00Z")

    assert _listed_ids() == ["done_new", "done_old", "run_2", "run_1"]


def test_list_breaks_ties_on_finished_at_by_newest_insertion() -> None:
    """Two analyses that finished at the same instant list the later-stored one first."""
    _post_listed("first", "case_a", "2026-10-10T10:00:00Z")
    _post_listed("second", "case_a", "2026-10-10T10:00:00Z")
    assert _listed_ids() == ["second", "first"]


def test_list_does_not_shadow_get_by_id() -> None:
    """GET /analyses/{id} still returns the full analysis, and an unknown id is still 404."""
    _post_listed("a_1", "case_a", "2026-10-10T10:00:00Z")
    assert len(Analysis.model_validate(client.get("/analyses/a_1").json()).verdicts) == 1
    assert client.get("/analyses/nope").status_code == 404
