"""PDF text extraction and pattern-based pre-fill for uploaded claims (TASK-16).

Everything here is a guess the user confirms in a form, so the rules are kept
deliberately simple: no model calls, nothing is stored, and whatever cannot be
found is listed in ``CaseDraft.warnings``.

Text is rebuilt from PyMuPDF word boxes grouped into visual rows, so a table row
("Deluxe room rent   Rs 32,000") stays on one line even when the PDF stores each
cell separately.
"""

from __future__ import annotations

import re
from datetime import date

import pymupdf

from app.models.schemas import BillCategory, BillLine, CaseDraft, Deduction

SCANNED_MESSAGE = "Scanned documents are not supported yet; please upload a text PDF"
DATES_WARNING = "Check the bill line dates"

# Words whose vertical centres differ by no more than this (PDF points) share a row.
_ROW_TOLERANCE = 3.0

# An amount needs a currency marker, a thousands separator or paise, so bed and
# page numbers ("Bed 12") are never read as money.
_AMOUNT_AT_END = re.compile(
    r"(?<![\w.,/-])(?:"
    r"(?:Rs\.?|₹|INR)\s*(?P<currency>\d[\d,]*(?:\.\d{1,2})?)"
    r"|(?P<bare>\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{1,2})"
    r")\s*(?:/-|only)?\s*$",
    re.IGNORECASE,
)
_TOTAL_LINE = re.compile(r"^\s*(?:grand\s+|sub[\s-]*)?total\b", re.IGNORECASE)
_DEDUCTION_WORD = re.compile(r"deduct|disallow|not\s+payable|non[\s-]?payable", re.IGNORECASE)
_CLAIMED_WORD = re.compile(r"\bclaimed\b", re.IGNORECASE)
_APPROVED_WORD = re.compile(r"\bapproved\b", re.IGNORECASE)
_ADMISSION_WORD = re.compile(r"\badmi(?:ssion|tted|t)\b", re.IGNORECASE)
_EDGE_PUNCTUATION = " \t:|,-–"

_DATE = re.compile(
    r"(?<!\d)(?:"
    r"(?P<d1>\d{1,2})[/.-](?P<m1>\d{1,2})[/.-](?P<y1>\d{4})"
    r"|(?P<y2>\d{4})-(?P<m2>\d{1,2})-(?P<d2>\d{1,2})"
    r"|(?P<d3>\d{1,2})\s+(?P<name>[A-Za-z]{3,9})\.?,?\s+(?P<y3>\d{4})"
    r")(?!\d)"
)
_MONTHS = {
    name: number
    for number, name in enumerate(
        ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), start=1
    )
}

# First match wins, so the more specific groups come first ("Cath lab / OT charges"
# is theatre, not a lab test).
_CATEGORY_KEYWORDS: tuple[tuple[BillCategory, re.Pattern[str]], ...] = (
    (BillCategory.room, re.compile(r"\broom\b", re.IGNORECASE)),
    (BillCategory.nursing, re.compile(r"\bnursing\b", re.IGNORECASE)),
    (BillCategory.ot, re.compile(r"\bot\b|\btheat(?:re|er)\b|\boperation\b", re.IGNORECASE)),
    (BillCategory.implant, re.compile(r"\bimplants?\b|\bstents?\b", re.IGNORECASE)),
    (BillCategory.pharmacy, re.compile(r"pharmac|medicin", re.IGNORECASE)),
    (
        BillCategory.consumables,
        re.compile(r"consumable|catheter|guide\s*wire|syringe|gloves?\b|cannula", re.IGNORECASE),
    ),
    (
        BillCategory.diagnostics,
        re.compile(
            r"\btests?\b|\blab\b|\bscan\b|x-?ray|\bmri\b|\bct\b|ultrasound|\becho|imaging|investigation",
            re.IGNORECASE,
        ),
    ),
    (
        BillCategory.professional_fee,
        re.compile(r"consult|\bfees?\b|surgeon|an(?:a)?esthe|physician|cardiologist", re.IGNORECASE),
    ),
    (BillCategory.procedure, re.compile(r"\bprocedure\b", re.IGNORECASE)),
)


class IngestError(Exception):
    """An uploaded file cannot be used; the message is shown to the user (422)."""


def _page_rows(page: pymupdf.Page) -> list[str]:
    """Text of one page as visual rows, top to bottom, words left to right."""
    rows: list[tuple[float, list[tuple[float, str]]]] = []
    for x0, y0, _x1, y1, word, *_ in sorted(page.get_text("words"), key=lambda w: w[1] + w[3]):
        centre = (y0 + y1) / 2
        if rows and abs(centre - rows[-1][0]) <= _ROW_TOLERANCE:
            rows[-1][1].append((x0, word))
        else:
            rows.append((centre, [(x0, word)]))
    return [" ".join(word for _x, word in sorted(words)) for _centre, words in rows]


def read_pdf_text(data: bytes, name: str) -> str:
    """Extract the text of an in-memory PDF; the file is never written anywhere.

    ``name`` ("settlement letter", "hospital bill") only labels the error messages.
    """
    if not data.startswith(b"%PDF"):
        raise IngestError(f"The {name} is not a PDF file")
    try:
        with pymupdf.open(stream=data, filetype="pdf") as pdf:
            rows = [row for page in pdf for row in _page_rows(page)]
    except (RuntimeError, ValueError) as exc:
        raise IngestError(f"The {name} could not be read as a PDF") from exc
    text = "\n".join(rows)
    if not text.strip():
        raise IngestError(SCANNED_MESSAGE)
    return text


def _find_dates(text: str) -> list[tuple[date, tuple[int, int]]]:
    """Every real calendar date in ``text`` with its character span."""
    found: list[tuple[date, tuple[int, int]]] = []
    for match in _DATE.finditer(text):
        try:
            if match["d1"]:
                value = date(int(match["y1"]), int(match["m1"]), int(match["d1"]))
            elif match["y2"]:
                value = date(int(match["y2"]), int(match["m2"]), int(match["d2"]))
            else:
                month = _MONTHS.get(match["name"][:3].lower())
                if month is None:
                    continue
                value = date(int(match["y3"]), month, int(match["d3"]))
        except ValueError:
            continue
        found.append((value, match.span()))
    return found


def _amount_at_end(line: str) -> tuple[float, str] | None:
    """The amount a line ends with and the text before it, or None."""
    match = _AMOUNT_AT_END.search(line)
    if match is None:
        return None
    digits = match["currency"] or match["bare"]
    return float(digits.replace(",", "")), line[: match.start()]


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip(_EDGE_PUNCTUATION)


def _category(particulars: str) -> BillCategory:
    for category, pattern in _CATEGORY_KEYWORDS:
        if pattern.search(particulars):
            return category
    return BillCategory.non_medical


def _admission_date(lines: list[str]) -> date | None:
    """The first date on a line that talks about admission."""
    for line in lines:
        if _ADMISSION_WORD.search(line):
            dates = _find_dates(line)
            if dates:
                return dates[0][0]
    return None


def _bill_lines(lines: list[str], admission: date | None) -> list[BillLine]:
    """Bill lines in order.

    A line's date is, in order of preference: a date written on the line, the
    admission date, the nearest earlier date printed in the bill, and only as a
    last resort today. Rate and units cannot be read reliably, so rate = amount
    and units = 1; the user corrects them in the form.
    """
    result: list[BillLine] = []
    last_seen: date | None = None
    for line in lines:
        dates = _find_dates(line)
        parsed = None if _TOTAL_LINE.match(line) else _amount_at_end(line)
        if parsed is not None:
            amount, before = parsed
            own = _find_dates(before)
            particulars = before
            for _value, (start, end) in reversed(own):
                particulars = f"{particulars[:start]} {particulars[end:]}"
            particulars = _clean(particulars)
            if particulars:
                result.append(
                    BillLine(
                        line_id=f"L{len(result) + 1:02d}",
                        date=own[0][0] if own else admission or last_seen or date.today(),
                        particulars=particulars,
                        category=_category(particulars),
                        rate=amount,
                        units=1,
                        amount=amount,
                    )
                )
        if dates:
            last_seen = dates[0][0]
    return result


def _letter_amounts(lines: list[str]) -> tuple[float | None, float | None, list[Deduction]]:
    """Claimed amount, approved amount and the deductions stated in the letter."""
    claimed: float | None = None
    approved: float | None = None
    deductions: list[Deduction] = []
    for line in lines:
        if _TOTAL_LINE.match(line):
            continue
        parsed = _amount_at_end(line)
        if parsed is None:
            continue
        amount, before = parsed
        if _CLAIMED_WORD.search(line):
            claimed = amount if claimed is None else claimed
        elif _APPROVED_WORD.search(line):
            approved = amount if approved is None else approved
        elif _DEDUCTION_WORD.search(line):
            deductions.append(
                Deduction(
                    deduction_id=f"D{len(deductions) + 1}",
                    label=_clean(before) or line,
                    amount=amount,
                    line_ids=[],
                    insurer_reason=line,
                )
            )
    return claimed, approved, deductions


def build_draft(doc_id: str, letter_text: str, bill_text: str) -> CaseDraft:
    """Pre-fill a ``CaseDraft`` from the text of the settlement letter and the bill."""
    letter_lines = [line.strip() for line in letter_text.splitlines() if line.strip()]
    bill_lines = [line.strip() for line in bill_text.splitlines() if line.strip()]

    claimed, approved, deductions = _letter_amounts(letter_lines)
    lines = _bill_lines(bill_lines, _admission_date(letter_lines + bill_lines))

    warnings: list[str] = []
    if claimed is None:
        warnings.append("Could not find the claimed amount in the letter")
    if approved is None:
        warnings.append("Could not find the approved amount in the letter")
    if deductions:
        warnings.append("Link each deduction to the bill lines it covers")
    else:
        warnings.append("No deduction found in the letter; add them below")
    if lines:
        warnings.append(DATES_WARNING)
    else:
        warnings.append("No bill line found in the bill; add them below")

    return CaseDraft(
        doc_id=doc_id,
        claimed=claimed,
        approved=approved,
        deductions=deductions,
        bill_lines=lines,
        letter_text=letter_text,
        warnings=warnings,
    )
