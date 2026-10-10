"""Case endpoints. Routes stay thin; logic lives in ``services/cases.py``."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import Case, CaseSummary
from app.services import cases as cases_service
from app.services.cases import CaseNotFoundError

router = APIRouter()


@router.get("/cases", response_model=list[CaseSummary])
def get_cases() -> list[CaseSummary]:
    """List every sample case as ``{id, title, summary}``."""
    return cases_service.list_cases()


@router.get("/cases/{case_id}", response_model=Case)
def get_case(case_id: str) -> Case:
    """Return one full ``Case``; 404 for an unknown id."""
    try:
        return cases_service.load_case(case_id)
    except CaseNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Case not found") from exc
