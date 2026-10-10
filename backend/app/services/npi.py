"""Non-payable item (NPI) classifier.

Policies fold some hospital charges into room, procedure or treatment charges
(Star FHO annexure, page 16). The three lists live in
``data/policies/npi/<doc_id>.yaml``, extracted from the PDF once and loaded at
runtime, so no PDF is parsed per request.

A line matches the best-scoring list item when ``rapidfuzz.token_set_ratio`` of
the ``normalise``d texts is at least 85 *and* the two share a non-generic word.
``token_set_ratio`` scores 100 whenever one text's words are a subset of the
other's, so a bare "Charges" would otherwise match every item containing it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml
from rapidfuzz import fuzz

from app.models.schemas import BillCategory, BillLine, NpiList, NpiResult
from app.settings import settings
from app.text import normalise

MATCH_THRESHOLD = 85

# Only these categories can be a non-payable item: a surgeon's fee, room rent or
# an implant is never subsumed into another charge.
_CLASSIFIED_CATEGORIES = frozenset(
    {BillCategory.non_medical, BillCategory.consumables, BillCategory.pharmacy}
)

# Words that describe a charge without saying what it is; matching on them alone
# would link unrelated lines and list items.
_GENERIC_TOKENS = frozenset(
    {
        "charges", "charge", "fee", "fees", "expense", "expenses", "cost", "costs",
        "item", "items", "other", "others", "misc", "miscellaneous",
    }
)  # fmt: skip

_DOC_ID = re.compile(r"[a-z0-9_]+")
_TOKEN = re.compile(r"[a-z0-9]+")


class NpiListNotFoundError(Exception):
    """Raised when a doc_id has no committed NPI list."""

    def __init__(self, doc_id: str) -> None:
        super().__init__(f"no NPI list for document: {doc_id}")
        self.doc_id = doc_id


@dataclass(frozen=True)
class _Item:
    list_name: NpiList
    text: str
    normalised: str
    tokens: frozenset[str]


def _tokens(text: str) -> frozenset[str]:
    return frozenset(_TOKEN.findall(text))


def _shares_specific_token(line_tokens: set[str] | frozenset[str], item_tokens: set[str] | frozenset[str]) -> bool:
    """True when the two token sets overlap in at least one non-generic word."""
    return bool((line_tokens & item_tokens) - _GENERIC_TOKENS)


@lru_cache(maxsize=None)
def _load(path: Path) -> tuple[_Item, ...]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    items: list[_Item] = []
    for key, texts in raw["lists"].items():
        list_name = NpiList(key)
        for text in texts:
            folded = normalise(text)
            items.append(_Item(list_name, text, folded, _tokens(folded)))
    return tuple(items)


def _items(doc_id: str) -> tuple[_Item, ...]:
    """Load the committed list for ``doc_id``; the id never reaches the filesystem unchecked."""
    if not _DOC_ID.fullmatch(doc_id):
        raise NpiListNotFoundError(doc_id)
    path = settings.data_dir / "policies" / "npi" / f"{doc_id}.yaml"
    if not path.is_file():
        raise NpiListNotFoundError(doc_id)
    return _load(path)


def _classify_line(line: BillLine, items: tuple[_Item, ...]) -> NpiResult:
    unmatched = NpiResult(
        line_id=line.line_id, list=NpiList.none, matched_item=None, payable_separately=True
    )
    if line.category not in _CLASSIFIED_CATEGORIES:
        return unmatched

    folded = normalise(line.particulars)
    line_tokens = _tokens(folded)
    best: _Item | None = None
    best_score = 0.0
    for item in items:
        if not _shares_specific_token(line_tokens, item.tokens):
            continue
        score = fuzz.token_set_ratio(folded, item.normalised)
        if score >= MATCH_THRESHOLD and score > best_score:
            best, best_score = item, score
    if best is None:
        return unmatched
    return NpiResult(
        line_id=line.line_id,
        list=best.list_name,
        matched_item=best.text,
        payable_separately=False,
    )


def classify_npi(doc_id: str, lines: list[BillLine]) -> list[NpiResult]:
    """Classify every line against the policy's NPI lists, preserving order."""
    items = _items(doc_id)
    return [_classify_line(line, items) for line in lines]
