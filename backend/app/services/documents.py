"""Registry, clause extraction and clause search for the policy/regulation PDFs.

Extraction follows TASK-02: PyMuPDF ``page.get_text("blocks")`` per page, blocks
ordered by column (left of the page centre first) then by ``y``, so two-column
policy wordings read in the right order. The resulting line stream is split into
clauses at numbered headings ("12. Moratorium Period:"), all-caps headings
("ITEMS THAT ARE TO BE SUBSUMED INTO ROOM CHARGES") and definition headings
("Associated medical expenses:"). A clause keeps the page it started on and its
``text`` begins with the heading line, so concatenating clause texts reproduces
the document text — which is how the anchors.yaml quotes are verified.

Documents are extracted once per process and cached (the PDFs are small). BM25
(``services/search.py``) ranks ``normalise``d clause text while the API returns
the original text. Hindi lines in MC24 are kept as they are: ``normalise`` is a
no-op for Devanagari, so they neither break extraction nor match English queries.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pymupdf
import yaml

from app.models.schemas import Clause, DocumentKind, DocumentSummary
from app.services.search import BM25Index
from app.settings import settings

_ANCHORS_FILE = "policies/anchors.yaml"
_RULES_FILE = "rules/rules.yaml"
# TASK-02 registers only these two regulations; IPR24, PPI24 and MC24_ANNEX in
# rules.yaml belong to later tasks.
_REGULATION_DOC_IDS = ("MC24", "OMB17")

_NUMBERED_HEADING = re.compile(r"(?:\d{1,3}|[A-Z])[.)]\s+\S")
_DEFINITION_HEADING = re.compile(r"[A-Z][^:]{1,60}:\s+\S")
_STANDALONE_HEADINGS = frozenset({"Note", "Note:", "Notes", "Notes:"})
# A heading label ends at the first colon, but only when that colon comes early
# enough to be a label rather than a sentence's own punctuation.
_LABEL_COLON_LIMIT = 90
_MIN_CAPS_WORDS = 3
_MIN_CAPS_LETTERS = 8


class DocumentNotFoundError(Exception):
    """Raised when a requested doc_id is not in the registry."""

    def __init__(self, doc_id: str) -> None:
        super().__init__(f"document not found: {doc_id}")
        self.doc_id = doc_id


@dataclass(frozen=True)
class DocumentSpec:
    """Registry entry: what a doc_id is and which PDF backs it."""

    doc_id: str
    title: str
    kind: DocumentKind
    path: Path


@dataclass(frozen=True)
class Document:
    """Extraction result for one registered PDF."""

    spec: DocumentSpec
    pages: int
    clauses: tuple[Clause, ...]
    index: BM25Index


@dataclass(frozen=True)
class _Extraction:
    """Raw text of one PDF: page count plus every line with its page number."""

    pages: int
    lines: list[tuple[int, str]]


def _resolve_pdf(relative_path: str) -> Path:
    """Resolve a repo-relative ``data/<file>.pdf`` path against ``settings.data_dir``.

    The YAMLs store repo-relative paths (``data/x.pdf``) while ``DATA_DIR`` may
    point elsewhere, so the ``data`` prefix is dropped and the rest kept as-is.
    """
    relative = Path(relative_path)
    if relative.parts[:1] == ("data",):
        relative = Path(*relative.parts[1:])
    path = settings.data_dir / relative
    if not path.is_file():
        raise FileNotFoundError(f"registered PDF is missing: {relative_path}")
    return path


@lru_cache(maxsize=1)
def _registry() -> tuple[DocumentSpec, ...]:
    """Build the document registry from anchors.yaml and rules.yaml."""
    anchors = yaml.safe_load((settings.data_dir / _ANCHORS_FILE).read_text(encoding="utf-8"))
    rules = yaml.safe_load((settings.data_dir / _RULES_FILE).read_text(encoding="utf-8"))
    documents = rules["documents"]

    policies = [
        DocumentSpec(
            doc_id=doc_id,
            title=entry["product"],
            kind=DocumentKind.policy,
            path=_resolve_pdf(entry["file"]),
        )
        for doc_id, entry in anchors["policies"].items()
    ]
    regulations = [
        DocumentSpec(
            doc_id=doc_id,
            title=documents[doc_id]["title"],
            kind=DocumentKind.regulation,
            path=_resolve_pdf(documents[doc_id]["file"]),
        )
        for doc_id in _REGULATION_DOC_IDS
    ]
    return tuple(policies + regulations)


def _ordered_lines(page: pymupdf.Page) -> list[str]:
    """Non-empty text lines of one page in reading order (column-aware).

    ``get_text("blocks")`` yields ``(x0, y0, x1, y1, text, number, type)`` in
    content-stream order, which interleaves the two columns of these policy
    wordings; sorting by column first and then by ``y`` restores reading order.
    """
    centre = page.rect.width / 2
    blocks = [block for block in page.get_text("blocks") if block[6] == 0 and block[4].strip()]
    blocks.sort(key=lambda block: (block[0] >= centre, round(block[1], 1), block[2]))
    return [
        stripped
        for block in blocks
        for stripped in (line.strip() for line in block[4].splitlines())
        if stripped
    ]


def _extract(path: Path) -> _Extraction:
    """Read every text line of ``path`` together with its 1-based page number."""
    with pymupdf.open(path) as pdf:
        lines = [
            (number, line)
            for number, page in enumerate(pdf, start=1)
            for line in _ordered_lines(page)
        ]
        return _Extraction(pages=pdf.page_count, lines=lines)


def _is_all_caps_heading(line: str) -> bool:
    """True for heading lines such as "ITEMS THAT ARE TO BE SUBSUMED INTO ROOM CHARGES"."""
    letters = [char for char in line if char.isalpha()]
    return (
        len(line.split()) >= _MIN_CAPS_WORDS
        and len(letters) >= _MIN_CAPS_LETTERS
        and all(char.isupper() for char in letters)
    )


def _is_heading(line: str) -> bool:
    """True when ``line`` starts a new clause."""
    return (
        bool(_NUMBERED_HEADING.match(line))
        or bool(_DEFINITION_HEADING.match(line))
        or _is_all_caps_heading(line)
        or line in _STANDALONE_HEADINGS
    )


def _heading_label(line: str) -> tuple[str, str]:
    """Split a heading line into (label, rest); together they keep every word.

    Lines that only look like a heading (no early colon) are their own label.
    """
    if _NUMBERED_HEADING.match(line) or _DEFINITION_HEADING.match(line):
        colon = line.find(":")
        if 0 <= colon <= _LABEL_COLON_LIMIT:
            return line[: colon + 1], line[colon + 1 :].strip()
    return line, ""


def _build_clauses(doc_id: str, lines: Sequence[tuple[int, str]]) -> list[Clause]:
    """Group the line stream into clauses, starting a new one at each heading."""
    labels: list[str] = []
    pages: list[int] = []
    bodies: list[list[str]] = []

    for page, line in lines:
        if bodies and not _is_heading(line):
            bodies[-1].append(line)
            continue
        label, rest = _heading_label(line)
        labels.append(label)
        pages.append(page)
        # The clause text keeps the whole heading line, so it stands on its own.
        bodies.append([f"{label} {rest}" if rest else label])

    return [
        Clause(
            clause_id=f"{doc_id}-c{index:04d}",
            doc_id=doc_id,
            heading=labels[index],
            text="\n".join(bodies[index]).strip(),
            page=pages[index],
        )
        for index in range(len(bodies))
    ]


@lru_cache(maxsize=None)
def _load(spec: DocumentSpec) -> Document:
    """Extract and index one document; cached for the process lifetime."""
    extraction = _extract(spec.path)
    clauses = tuple(_build_clauses(spec.doc_id, extraction.lines))
    index = BM25Index([clause.text for clause in clauses])
    return Document(spec=spec, pages=extraction.pages, clauses=clauses, index=index)


def _document(doc_id: str) -> Document:
    """Load ``doc_id``; raise ``DocumentNotFoundError`` when it is not registered."""
    for spec in _registry():
        if spec.doc_id == doc_id:
            return _load(spec)
    raise DocumentNotFoundError(doc_id)


def list_documents() -> list[DocumentSummary]:
    """Registry overview: id, title, kind and page count of every document."""
    return [
        DocumentSummary(
            doc_id=document.spec.doc_id,
            title=document.spec.title,
            kind=document.spec.kind,
            pages=document.pages,
        )
        for document in (_load(spec) for spec in _registry())
    ]


def get_clauses(doc_id: str) -> list[Clause]:
    """Every clause of ``doc_id``, in reading order."""
    return list(_document(doc_id).clauses)


def search_clauses(doc_id: str, query: str, k: int = 5) -> list[Clause]:
    """Top ``k`` clauses of ``doc_id`` for ``query``, best BM25 score first."""
    document = _document(doc_id)
    return [document.clauses[hit.index] for hit in document.index.search(query, k=k)]
