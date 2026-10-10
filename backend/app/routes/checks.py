"""Bill checks: non-payable item classifier and arithmetic check.

Routes stay thin; logic lives in ``services/npi.py`` and ``services/bill_check.py``.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.schemas import BillCheck, BillLine, NpiResult
from app.services import bill_check, npi

router = APIRouter()


class NpiRequest(BaseModel):
    doc_id: str
    lines: list[BillLine]


class BillCheckRequest(BaseModel):
    lines: list[BillLine]
    printed_total: float | None = None


@router.post("/classify/npi", response_model=list[NpiResult])
def classify_npi(body: NpiRequest) -> list[NpiResult]:
    """Match each bill line against the policy's non-payable item lists."""
    try:
        return npi.classify_npi(body.doc_id, body.lines)
    except npi.NpiListNotFoundError as exc:
        raise HTTPException(status_code=404, detail="No NPI list for this document") from exc


@router.post("/calc/bill-check", response_model=list[BillCheck])
def calc_bill_check(body: BillCheckRequest) -> list[BillCheck]:
    """Verify line arithmetic, printed total, duplicates and stent price caps."""
    return bill_check.check_bill(body.lines, body.printed_total)
