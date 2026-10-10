"""Grievance letter as a downloadable PDF (markdown -> PDF with PyMuPDF)."""

from __future__ import annotations

import sys
from pathlib import Path

import pymupdf
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402
from app.services.letter_pdf import markdown_to_html  # noqa: E402

client = TestClient(app)

LETTER = """To: The Grievance Redressal Officer, [Insurer name and address]

Subject: Grievance against the settlement of my claim

## Details
- Policyholder / patient: Ananya Bora
- Amount claimed: Rs 1,12,500.00

## Contested deductions
| Deduction | Insurer's label | Amount recoverable | Verbatim quote | Source |
|---|---|---|---|---|
| D1 | Proportionate deduction | Rs 15,000.00 | "first quote"<br>"second quote" | policy star_fho_v19 |

**Total recoverable: Rs 15,000.00**

_Prepared by the policyholder using a self-help tool. Not legal advice._
"""


def test_markdown_becomes_headings_lists_tables_and_emphasis() -> None:
    html = markdown_to_html(LETTER)
    assert "<h2>Details</h2>" in html
    assert "<li>Policyholder / patient: Ananya Bora</li>" in html
    assert "<th>Deduction</th>" in html and "<td>D1</td>" in html
    assert "first quote&quot;<br/>&quot;second quote" in html
    assert "<b>Total recoverable: Rs 15,000.00</b>" in html
    assert "<i>Prepared by the policyholder" in html
    assert "|---|" not in html


def test_markdown_text_is_escaped() -> None:
    assert "&lt;script&gt;" in markdown_to_html("<script>alert(1)</script>")


def test_the_pdf_endpoint_returns_a_branded_pdf_with_the_letter_text() -> None:
    response = client.post("/letters/pdf", json={"title": "Tier 1 grievance", "markdown": LETTER})
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "attachment" in response.headers["content-disposition"]
    with pymupdf.open(stream=response.content, filetype="pdf") as pdf:
        text = " ".join(page.get_text() for page in pdf)
    assert "Total recoverable: Rs 15,000.00" in text
    assert "Ananya Bora" in text
    assert "Made with Claim Contest" in text


def test_an_empty_letter_is_rejected() -> None:
    assert client.post("/letters/pdf", json={"title": "x", "markdown": "  "}).status_code == 422
