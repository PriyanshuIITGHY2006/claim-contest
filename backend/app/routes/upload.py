"""Upload-your-own-claim endpoints. Routes stay thin; logic in ``services/ingest.py`` and ``services/cases.py``."""

from __future__ import annotations

from fastapi import APIRouter, Form, HTTPException, UploadFile

from app.models.schemas import CaseDraft, NewCase
from app.services import cases as cases_service
from app.services import ingest
from app.services.cases import UnknownPolicyError

router = APIRouter()

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


async def _read_capped(upload: UploadFile, name: str) -> bytes:
    """Read an upload fully into memory, refusing anything over 10 MB."""
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=422, detail=f"The {name} is larger than 10 MB")
    return data


@router.post("/cases/upload", response_model=CaseDraft)
async def upload_documents(
    settlement_pdf: UploadFile,
    bill_pdf: UploadFile,
    doc_id: str = Form(),
) -> CaseDraft:
    """Read the two PDFs and return a pre-filled draft for the user to confirm; nothing is stored."""
    try:
        cases_service.ensure_policy(doc_id)
    except UnknownPolicyError as exc:
        raise HTTPException(status_code=422, detail="Choose one of the listed policies") from exc

    letter_bytes = await _read_capped(settlement_pdf, "settlement letter")
    bill_bytes = await _read_capped(bill_pdf, "hospital bill")
    try:
        letter_text = ingest.read_pdf_text(letter_bytes, "settlement letter")
        bill_text = ingest.read_pdf_text(bill_bytes, "hospital bill")
    except ingest.IngestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ingest.build_draft(doc_id, letter_text, bill_text)


@router.post("/cases", status_code=201)
def create_case(new_case: NewCase) -> dict[str, str]:
    """Store the user-confirmed case; the same analysis then runs on it as on a sample."""
    try:
        return {"case_id": cases_service.create_case(new_case)}
    except UnknownPolicyError as exc:
        raise HTTPException(status_code=422, detail="Choose one of the listed policies") from exc
