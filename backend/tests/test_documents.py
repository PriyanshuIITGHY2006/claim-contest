"""Acceptance tests for TASK-02: policy/regulation extraction and clause search.

Written before the implementation (TDD). Run with:
``cd backend && .venv/bin/pytest -q``
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml
from fastapi.testclient import TestClient
from httpx import Response

# The pytest console script does not add the CWD to sys.path, so make the
# ``app`` package importable when running from backend/.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402
from app.models.schemas import Clause, DocumentKind, DocumentSummary  # noqa: E402
from app.services.search import BM25Index  # noqa: E402
from app.settings import settings  # noqa: E402
from app.text import normalise  # noqa: E402

client = TestClient(app)

ANCHORS_FILE = settings.data_dir / "policies" / "anchors.yaml"
STAR_FHO = "star_fho_v19"


def _clauses(response: Response) -> list[Clause]:
    """Validate a 200 response body as ``Clause[]``."""
    assert response.status_code == 200, response.text
    return [Clause.model_validate(item) for item in response.json()]


def test_normalise_folds_ligature_hyphen_break_and_curly_quotes() -> None:
    """Acceptance 1: normalise folds the PDF artefacts to comparable ASCII."""
    assert normalise("ﬁrst  non- disclosure “x”") == 'first non-disclosure "x"'


def test_documents_lists_every_registered_pdf_with_its_own_page_count() -> None:
    """GET /documents exposes the registry; each doc_id maps to its own PDF."""
    response = client.get("/documents")
    assert response.status_code == 200, response.text
    documents = [DocumentSummary.model_validate(item) for item in response.json()]
    by_id = {document.doc_id: document for document in documents}

    assert set(by_id) == {
        "star_fho_v19",
        "hdfc_optima_secure",
        "niva_reassure2",
        "MC24",
        "OMB17",
    }
    assert by_id[STAR_FHO].kind == DocumentKind.policy
    assert by_id["MC24"].kind == DocumentKind.regulation
    assert by_id[STAR_FHO].title == "Family Health Optima Insurance Plan"
    # Distinct, non-zero page counts prove the ids are not all reading one file.
    assert by_id[STAR_FHO].pages == 16
    assert by_id["hdfc_optima_secure"].pages == 29
    assert by_id["niva_reassure2"].pages == 2
    assert by_id["MC24"].pages > 0
    assert by_id["OMB17"].pages > 0


def test_every_star_fho_anchor_quote_appears_in_the_extracted_text() -> None:
    """Acceptance 2: column-aware extraction keeps every anchors.yaml quote intact."""
    clauses = _clauses(client.get(f"/documents/{STAR_FHO}/clauses"))
    assert clauses, "extraction produced no clauses"
    assert all(clause.doc_id == STAR_FHO and clause.page > 0 for clause in clauses)
    extracted = normalise("\n".join(clause.text for clause in clauses))

    anchors = yaml.safe_load(ANCHORS_FILE.read_text(encoding="utf-8"))
    quotes = [anchor["quote"] for anchor in anchors["policies"][STAR_FHO]["anchors"]]
    assert len(quotes) == 6, "anchors.yaml fixture changed"
    for quote in quotes:
        assert normalise(quote) in extracted, f"quote missing from extracted text: {quote!r}"


def test_policy_search_ranks_the_pharmacy_exclusion_definition_in_the_top_3() -> None:
    """Acceptance 3: BM25 finds the associated-medical-expenses definition."""
    response = client.post(
        "/policy/search",
        json={
            "doc_id": STAR_FHO,
            "query": "proportionate deduction associated medical expenses pharmacy implants",
            "k": 5,
        },
    )
    clauses = _clauses(response)
    assert len(clauses) == 5
    assert all(clause.doc_id == STAR_FHO for clause in clauses)

    needle = normalise("do not include Cost of pharmacy")
    top_three = clauses[:3]
    assert any(needle in normalise(clause.text) for clause in top_three), [
        clause.heading for clause in top_three
    ]


def test_policy_search_finds_the_moratorium_clause_in_the_top_3() -> None:
    """Acceptance 4: the 8-year moratorium clause outranks the rest of the policy."""
    response = client.post(
        "/policy/search",
        json={"doc_id": STAR_FHO, "query": "moratorium eight continuous years"},
    )
    clauses = _clauses(response)
    assert len(clauses) == 5, "k defaults to 5"

    needle = normalise("eight continuous years")
    hit = next(
        (clause for clause in clauses[:3] if needle in normalise(clause.text)),
        None,
    )
    assert hit is not None, [clause.heading for clause in clauses[:3]]
    assert hit.page == 13, "clause page must be the PDF page it was read from"


def test_unknown_doc_id_returns_404() -> None:
    """Acceptance 5: both document endpoints reject an unregistered doc_id."""
    assert client.get("/documents/nope/clauses").status_code == 404

    response = client.post("/policy/search", json={"doc_id": "nope", "query": "moratorium"})
    assert response.status_code == 404


def test_bm25_ranks_repeated_query_terms_first_and_drops_zero_score_documents() -> None:
    """The BM25 index itself: term frequency wins, unmatched documents are dropped."""
    index = BM25Index(
        [
            "Room charges include nursing and boarding.",
            "Moratorium applies after eight continuous years of cover.",
            "Eight continuous years means eight continuous years, not eight months.",
        ]
    )
    assert len(index) == 3

    hits = index.search("eight continuous years")
    assert [hit.index for hit in hits] == [2, 1]
    assert hits[0].score > hits[1].score > 0

    assert index.search("wording that appears nowhere") == []
    assert index.search("", k=3) == []


def test_bm25_honours_k_and_folds_query_text_before_matching() -> None:
    """``k`` caps the result list; curly quotes and hyphen breaks still match."""
    index = BM25Index(["pharmacy items are not payable", "implants are subsumed"])
    assert [hit.index for hit in index.search("pharmacy", k=5)] == [0]
    assert len(index.search("are", k=5)) == 2
    assert index.search("pharmacy", k=0) == []
    assert [hit.index for hit in index.search("“PHARMACY”  items")] == [0]
    assert [hit.index for hit in index.search("non- payable items")] == [0]

