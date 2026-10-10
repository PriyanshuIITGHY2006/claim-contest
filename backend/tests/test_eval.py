"""Acceptance tests for TASK-15: ``GET /eval/awards`` serves the human-labelled awards.

Written before the implementation (TDD). Every test points ``settings.data_dir`` at
a throwaway directory, so the real ``data/eval/awards.csv`` is never read or written.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402
from app.settings import settings  # noqa: E402

client = TestClient(app)

HEADER = "precedent_id,ground,outcome,rule_relevance,notes\n"


@pytest.fixture
def eval_dir(tmp_path: Path) -> Iterator[Path]:
    """A temporary data dir with an empty ``eval/`` folder; the real one is restored."""
    original = settings.data_dir
    settings.data_dir = tmp_path
    directory = tmp_path / "eval"
    directory.mkdir()
    yield directory
    settings.data_dir = original


def test_awards_returns_every_row_with_every_column(eval_dir: Path) -> None:
    """Acceptance 3: rows come back as JSON objects keyed by the CSV header."""
    (eval_dir / "awards.csv").write_text(
        HEADER
        + "Mediclaim-Book17.pdf#288,room_rent,partly,MC24-16a,\"Ex-gratia, not full relief\"\n"
        + "Mediclaim-Book20.pdf#13,room_rent,dismissed,,Eligible room rent applied\n",
        encoding="utf-8",
    )

    response = client.get("/eval/awards")

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "precedent_id": "Mediclaim-Book17.pdf#288",
            "ground": "room_rent",
            "outcome": "partly",
            "rule_relevance": "MC24-16a",
            "notes": "Ex-gratia, not full relief",
        },
        {
            "precedent_id": "Mediclaim-Book20.pdf#13",
            "ground": "room_rent",
            "outcome": "dismissed",
            "rule_relevance": "",
            "notes": "Eligible room rent applied",
        },
    ]


def test_awards_header_only_csv_is_an_empty_list(eval_dir: Path) -> None:
    """Acceptance 3: no labelled rows yet -> ``[]``, not an error."""
    (eval_dir / "awards.csv").write_text(HEADER, encoding="utf-8")

    response = client.get("/eval/awards")

    assert response.status_code == 200
    assert response.json() == []


def test_awards_missing_file_is_an_empty_list(eval_dir: Path) -> None:
    """A checkout without the labels file behaves like an empty one."""
    response = client.get("/eval/awards")

    assert response.status_code == 200
    assert response.json() == []


def test_awards_skips_blank_lines(eval_dir: Path) -> None:
    """A trailing blank line in the CSV is not a row."""
    (eval_dir / "awards.csv").write_text(
        HEADER + "Mediclaim-Book9.pdf#132,pre_existing,allowed,,Read the order\n\n",
        encoding="utf-8",
    )

    assert [row["precedent_id"] for row in client.get("/eval/awards").json()] == [
        "Mediclaim-Book9.pdf#132"
    ]
