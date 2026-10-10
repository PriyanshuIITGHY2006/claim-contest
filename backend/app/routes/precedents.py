"""Precedent-search endpoint. Routes stay thin; logic lives in the service."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import Precedent, PrecedentDetail, PrecedentSearchRequest
from app.services import precedents as precedents_service

router = APIRouter()


@router.post("/precedents/search", response_model=list[Precedent])
def search_precedents(request: PrecedentSearchRequest) -> list[Precedent]:
    """BM25 search over the Ombudsman awards; top ``k`` precedents, best first."""
    return precedents_service.search_precedents(request.query, k=request.k)


@router.get("/precedents/{precedent_id}", response_model=PrecedentDetail)
def get_precedent(precedent_id: str) -> PrecedentDetail:
    """The full text of one award. Ids look like ``<book>#<n>``; send ``#`` as ``%23``."""
    detail = precedents_service.get_precedent(precedent_id)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Unknown precedent_id: {precedent_id}")
    return detail
