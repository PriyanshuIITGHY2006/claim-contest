"""Ombudsman precedent finder: split the six award books into individual awards
and rank them with BM25 (TASK-05).

Each award book is a PDF bundling hundreds of Ombudsman awards. Text is extracted
with the same column-aware PyMuPDF pass as ``services/documents.py`` (its
``_extract`` helper is reused verbatim), which yields the page's visual lines in
reading order. The line stream is split into awards at the header lines the task
specifies (``Case No.`` / ``Complaint No.``, optionally prefixed ``G.I.``). A
header that follows another header within three lines is treated as the *same*
award, because some awards print both a Case No. and a Complaint No. Exact
duplicate awards (same ``case_no`` and same first 200 characters) are dropped --
GroupMediclaim-Book17 repeats awards -- and each survivor gets ``<book>#<n>`` as
its ``precedent_id``, where ``n`` is its position among the book's merged awards
(so ids stay stable even when a later duplicate is dropped).

``year`` is the most frequent 4-digit year in 2000..2016 in the award text, or
``None`` when the award prints no such year (never 0). ``outcome`` is a
best-effort disposition read from the award's own keywords. ``excerpt`` is the
first 600 characters after the header, for display only; BM25 ranks over the
*whole* award text so a query can match evidence that sits past the excerpt.

Awards are parsed once per process and cached (the books are large but static).
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache

from app.models.schemas import Precedent, PrecedentDetail, PrecedentOutcome
from app.services.documents import _extract
from app.services.search import BM25Index
from app.settings import settings

# The six award books registered for precedent search (TASK-05 interface).
_BOOKS = (
    "Mediclaim-Book3.pdf",
    "Mediclaim-Book9.pdf",
    "Mediclaim-Book17.pdf",
    "Mediclaim-Book20.pdf",
    "GroupMediclaim-Book11.pdf",
    "GroupMediclaim-Book17.pdf",
)

# Header line that starts a new award: case numbers use dashes, dots or slashes,
# and the label may be prefixed "G.I.". Bhopal awards print the case number after
# an order number on one line ("Order No.: BPL/GI/08-09/10   Case No.: GI/NIA/...").
_HEADER = re.compile(
    r"^\s*(?:(G\.?\s*I\.?\s*)?(Case|Complaint)\s*No\.?\s*[:.\-]?\s*\S"
    r"|(?:Order|Award)\s*No\b.{0,80}?\b(?:Case|Complaint)\s*No\.?\s*[:.\-]?\s*\S)",
    re.IGNORECASE,
)
_LABELLED_CASE_NO = re.compile(
    r"\b(?:Case|Complaint)\s*No\.?\s*[:.\-]?\s*(.+)$", re.IGNORECASE
)
# ``case_no`` is the text after "No." on the first header line. Case-insensitive
# because several books print the label in full caps ("CASE NO. GIC/190/OIC/11/09").
_CASE_NO = re.compile(r"No\.?\s*[:.\-]?\s*(.+)$", re.IGNORECASE)
# A 4-digit year; only 2000..2016 counts (the awards span 2003..2014).
_YEAR = re.compile(r"\b(19\d{2}|20\d{2})\b")
_YEAR_MIN = 2000
_YEAR_MAX = 2016

# A header within this many lines of the previous header belongs to the same award.
_MERGE_WINDOW = 3
_EXCERPT_CHARS = 600
_DEDUP_CHARS = 200

# Outcome keywords, most specific first: "partly allowed" must read as "partly",
# and a "dismissed" award must not be caught by the word "allowed" in its reasons.
# Word boundaries keep "disallowed" from matching "allowed".
_OUTCOME_KEYWORDS = (
    (PrecedentOutcome.partly, re.compile(r"\bpartly\b", re.IGNORECASE)),
    (PrecedentOutcome.dismissed, re.compile(r"\bdismissed\b", re.IGNORECASE)),
    (PrecedentOutcome.allowed, re.compile(r"\ballowed\b", re.IGNORECASE)),
)


@dataclass(frozen=True)
class Award:
    """One parsed Ombudsman award. ``text`` is the whole award, indexed by BM25."""

    precedent_id: str
    book: str
    case_no: str
    year: int | None
    excerpt: str
    outcome: PrecedentOutcome | None
    text: str


@dataclass(frozen=True)
class _Corpus:
    """All parsed awards plus the BM25 index over their full text."""

    awards: tuple[Award, ...]
    index: BM25Index


def _case_no(header_line: str) -> str:
    """Return the case number on a header line, or "" when there is none.

    Prefers the text after a "Case No."/"Complaint No." label, so an
    "Order No.: ... Case No.: X" line yields X rather than the order number.
    """
    match = _LABELLED_CASE_NO.search(header_line) or _CASE_NO.search(header_line)
    return match.group(1).strip() if match else ""


def _year(text: str) -> int | None:
    """Most frequent 2000..2016 year in ``text``; ``None`` when there is none."""
    years = [int(year) for year in _YEAR.findall(text) if _YEAR_MIN <= int(year) <= _YEAR_MAX]
    if not years:
        return None
    return Counter(years).most_common(1)[0][0]


def _outcome(text: str) -> PrecedentOutcome | None:
    """Best-effort disposition from the award's keywords, or ``None``."""
    for outcome, pattern in _OUTCOME_KEYWORDS:
        if pattern.search(text):
            return outcome
    return None


def _award_starts(lines: list[str]) -> list[int]:
    """Indices of lines that begin a new award, merging adjacent header lines."""
    starts: list[int] = []
    for index, line in enumerate(lines):
        if not _HEADER.match(line):
            continue
        # A Case No. immediately followed by a Complaint No. is one award.
        if starts and index - starts[-1] <= _MERGE_WINDOW:
            continue
        starts.append(index)
    return starts


def _parse_book(book: str) -> list[Award]:
    """Extract one award book and split it into de-duplicated ``Award`` records."""
    path = settings.data_dir / book
    if not path.is_file():
        raise FileNotFoundError(f"award book is missing: {book}")

    lines = [text for _page, text in _extract(path).lines]
    starts = _award_starts(lines)
    bounds = [*starts, len(lines)]

    awards: list[Award] = []
    seen: set[tuple[str, str]] = set()
    for number, (start, end) in enumerate(zip(bounds, bounds[1:])):
        block = lines[start:end]
        text = "\n".join(block).strip()
        if not text:
            continue

        case_no = _case_no(block[0])
        key = (case_no, text[:_DEDUP_CHARS])
        if key in seen:
            continue
        seen.add(key)

        # Excerpt is for display: the text after the header line. Fall back to the
        # award's opening when a (rare) header has no body, so it is never empty.
        excerpt = "\n".join(block[1:]).strip()[:_EXCERPT_CHARS].strip()
        if not excerpt:
            excerpt = text[:_EXCERPT_CHARS].strip()

        awards.append(
            Award(
                precedent_id=f"{book}#{number}",
                book=book,
                case_no=case_no,
                year=_year(text),
                excerpt=excerpt,
                outcome=_outcome(text),
                text=text,
            )
        )
    return awards


@lru_cache(maxsize=None)
def _corpus() -> _Corpus:
    """Parse and index every award book once for the process lifetime."""
    awards: list[Award] = []
    for book in _BOOKS:
        awards.extend(_parse_book(book))
    index = BM25Index([award.text for award in awards])
    return _Corpus(awards=tuple(awards), index=index)


def all_awards() -> tuple[Award, ...]:
    """Every parsed award across the six books, in book order (for tests/dev)."""
    return _corpus().awards


def get_precedent(precedent_id: str) -> PrecedentDetail | None:
    """The parsed award with its full text, or ``None`` for an unknown id."""
    award = next((a for a in all_awards() if a.precedent_id == precedent_id), None)
    if award is None:
        return None
    return PrecedentDetail(
        precedent_id=award.precedent_id,
        book=award.book,
        case_no=award.case_no,
        year=award.year,
        excerpt=award.excerpt,
        outcome=award.outcome,
        text=award.text,
    )


def search_precedents(query: str, k: int = 3) -> list[Precedent]:
    """Top ``k`` awards for ``query`` by BM25 over full award text, best first."""
    corpus = _corpus()
    results: list[Precedent] = []
    for hit in corpus.index.search(query, k=k):
        award = corpus.awards[hit.index]
        results.append(
            Precedent(
                precedent_id=award.precedent_id,
                book=award.book,
                case_no=award.case_no,
                year=award.year,
                excerpt=award.excerpt,
                outcome=award.outcome,
                score=hit.score,
            )
        )
    return results

