"""Rule base and quote-verification endpoints.

Routes stay thin; logic lives in ``services/rules.py`` and ``services/verify.py``.
Request/response models for these endpoints are defined here.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.models.schemas import CitationSourceType, Rule
from app.services import rules as rules_service
from app.services import verify as verify_service
from app.services.documents import DocumentNotFoundError
from app.services.rules import RuleNotFoundError
from app.services.verify import MatchKind

router = APIRouter()


class SearchRequest(BaseModel):
    """Body for ``POST /rules/search``."""

    query: str
    k: int = Field(default=5, ge=1, le=27)


class VerifyQuoteRequest(BaseModel):
    """Body for ``POST /verify-quote``."""

    source_type: CitationSourceType
    source_id: str
    quote: str


class VerifyQuoteResponse(BaseModel):
    """Response for ``POST /verify-quote``."""

    verified: bool
    match: MatchKind
    score: float
    page: int | None = None


@router.get("/rules", response_model=list[Rule])
def get_rules() -> list[Rule]:
    """List every rule in the base."""
    return rules_service.list_rules()


@router.post("/rules/search", response_model=list[Rule])
def search_rules(body: SearchRequest) -> list[Rule]:
    """Return the top ``k`` rules matching ``query`` by keyword overlap."""
    return rules_service.search_rules(body.query, body.k)


@router.get("/rules/{rule_id}", response_model=Rule)
def get_rule(rule_id: str) -> Rule:
    """Return one rule; 404 for an unknown id."""
    try:
        return rules_service.get_rule(rule_id)
    except RuleNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Rule not found") from exc


@router.post("/verify-quote", response_model=VerifyQuoteResponse)
def verify_quote(body: VerifyQuoteRequest) -> VerifyQuoteResponse:
    """Verify that ``quote`` really appears in the cited rule or policy source."""
    try:
        outcome = verify_service.verify_quote(
            body.source_type, body.source_id, body.quote
        )
    except RuleNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Rule not found") from exc
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Document not found") from exc
    return VerifyQuoteResponse(
        verified=outcome.verified,
        match=outcome.match,
        score=outcome.score,
        page=outcome.page,
    )
