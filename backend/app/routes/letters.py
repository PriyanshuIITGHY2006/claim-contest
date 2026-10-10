"""Grievance letter downloads."""

from __future__ import annotations

import re

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.services.letter_pdf import render_letter_pdf

router = APIRouter()


class LetterPdfRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    markdown: str = Field(pattern=r"\S", max_length=100_000)


@router.post("/letters/pdf")
def letter_pdf(request: LetterPdfRequest) -> Response:
    """The (possibly user-edited) letter as a branded PDF; nothing is stored."""
    name = re.sub(r"[^a-z0-9]+", "-", request.title.lower()).strip("-") or "letter"
    return Response(
        content=render_letter_pdf(request.title, request.markdown),
        media_type="application/pdf",
        headers={"content-disposition": f'attachment; filename="{name}.pdf"'},
    )
