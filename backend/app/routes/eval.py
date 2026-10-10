"""Evaluation labels: the human-confirmed outcomes of historical Ombudsman awards (TASK-15)."""

from __future__ import annotations

import csv

from fastapi import APIRouter

from app.settings import settings

router = APIRouter()


@router.get("/eval/awards", response_model=list[dict[str, str]])
def list_labelled_awards() -> list[dict[str, str]]:
    """Every row of ``data/eval/awards.csv`` with all its columns; ``[]`` when none."""
    path = settings.data_dir / "eval" / "awards.csv"
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return [
            {key: value or "" for key, value in row.items() if key is not None}
            for row in csv.DictReader(handle)
            if any((value or "").strip() for value in row.values())
        ]
