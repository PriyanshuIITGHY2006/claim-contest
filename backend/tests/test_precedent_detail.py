"""Acceptance tests for TASK-15: ``GET /precedents/{precedent_id}`` (full award text).

Written before the implementation (TDD). Ids look like ``<book>#<n>``, so the
``#`` must travel URL-encoded as ``%23``; a raw ``#`` is a URL fragment and never
reaches the server.
"""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import quote

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402
from app.models.schemas import PrecedentDetail  # noqa: E402

client = TestClient(app)


def _first_search_hit(query: str) -> dict:
    response = client.post("/precedents/search", json={"query": query, "k": 1})
    assert response.status_code == 200, response.text
    return response.json()[0]


def test_detail_returns_the_full_award_text_for_a_url_encoded_id() -> None:
    """Acceptance 4: a real id (``#`` sent as ``%23``) returns the whole award."""
    hit = _first_search_hit("room rent proportionate deduction")
    assert "#" in hit["precedent_id"], "real ids look like <book>#<n>"

    response = client.get(f"/precedents/{quote(hit['precedent_id'], safe='')}")

    assert response.status_code == 200, response.text
    detail = PrecedentDetail.model_validate(response.json())
    assert detail.precedent_id == hit["precedent_id"]
    assert detail.book == hit["book"]
    assert detail.case_no == hit["case_no"]
    assert detail.excerpt == hit["excerpt"]
    assert len(detail.text) > len(detail.excerpt), "text is the full award, not the excerpt"
    assert "score" not in response.json()


def test_detail_text_starts_with_the_award_header_and_ends_after_the_excerpt() -> None:
    """The excerpt is the opening of the same award, so the text contains it."""
    hit = _first_search_hit("cashless delay")
    detail = client.get(f"/precedents/{quote(hit['precedent_id'], safe='')}").json()

    assert hit["excerpt"][:80] in detail["text"]


def test_detail_unknown_id_is_404() -> None:
    """Acceptance 4: a well-formed id that does not exist is a 404, not a 500."""
    response = client.get(f"/precedents/{quote('Mediclaim-Book3.pdf#999999', safe='')}")

    assert response.status_code == 404
    assert "999999" in response.json()["detail"]


def test_detail_malformed_id_is_404() -> None:
    """An id without the book#n shape is simply unknown."""
    response = client.get("/precedents/not-an-id")

    assert response.status_code == 404
