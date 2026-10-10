"""Document and clause-search endpoints. Routes stay thin; logic in services."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import Clause, DocumentSummary, PolicySearchRequest
from app.services import documents as documents_service
from app.services.documents import DocumentNotFoundError

router = APIRouter()


@router.get("/documents", response_model=list[DocumentSummary])
def get_documents() -> list[DocumentSummary]:
    """List every registered policy/regulation PDF with its page count."""
    return documents_service.list_documents()


@router.get("/documents/{doc_id}/clauses", response_model=list[Clause])
def get_document_clauses(doc_id: str) -> list[Clause]:
    """Return every extracted clause of one document, in reading order."""
    try:
        return documents_service.get_clauses(doc_id)
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Document not found") from exc


@router.post("/policy/search", response_model=list[Clause])
def search_policy(request: PolicySearchRequest) -> list[Clause]:
    """BM25 clause search inside one document; top ``k`` clauses, best first."""
    try:
        return documents_service.search_clauses(request.doc_id, request.query, k=request.k)
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Document not found") from exc
