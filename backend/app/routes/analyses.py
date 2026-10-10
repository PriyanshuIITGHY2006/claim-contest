"""Persistence endpoints for analyses and drafts. Routes stay thin; logic in services."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    Analysis,
    AnalysisCreated,
    AnalysisSummary,
    Draft,
    DraftApprovalRequest,
)
from app.services import store

router = APIRouter()


@router.get("/analyses", response_model=list[AnalysisSummary])
def list_analyses(case_id: str | None = None) -> list[AnalysisSummary]:
    """List stored analyses newest first, optionally only those of one case."""
    return store.list_analyses(case_id)


@router.post("/analyses", response_model=AnalysisCreated, status_code=201)
def create_analysis(analysis: Analysis) -> AnalysisCreated:
    """Store an analysis (idempotent) after validating totals and deduction ids."""
    try:
        store.save_analysis(analysis)
    except store.AnalysisValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return AnalysisCreated(analysis_id=analysis.analysis_id)


@router.get("/analyses/{analysis_id}", response_model=Analysis)
def get_analysis(analysis_id: str) -> Analysis:
    """Return one stored analysis."""
    try:
        return store.get_analysis(analysis_id)
    except store.AnalysisNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Analysis not found") from exc


@router.post("/drafts", response_model=Draft, status_code=201)
def create_draft(draft: Draft) -> Draft:
    """Store a draft; tier 2/3 requires an approved tier-1 draft first."""
    try:
        return store.create_draft(draft)
    except store.AnalysisNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Analysis not found") from exc
    except store.ApprovalRequiredError as exc:
        raise HTTPException(status_code=409, detail="Tier-1 draft must be approved first") from exc
    except store.DraftExistsError as exc:
        raise HTTPException(status_code=409, detail="Draft already exists") from exc


@router.patch("/drafts/{draft_id}", response_model=Draft)
def update_draft(draft_id: str, request: DraftApprovalRequest) -> Draft:
    """Set a draft's ``human_approved`` flag."""
    try:
        return store.update_draft_approval(draft_id, request.human_approved)
    except store.DraftNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Draft not found") from exc


@router.get("/drafts/{draft_id}", response_model=Draft)
def get_draft(draft_id: str) -> Draft:
    """Return one stored draft."""
    try:
        return store.get_draft(draft_id)
    except store.DraftNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Draft not found") from exc