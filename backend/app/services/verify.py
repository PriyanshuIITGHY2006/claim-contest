"""Quote verification (the citation gate).

Verifies that a quoted string really appears in its source: a rule
(``data/rules/rules.yaml``) or a registered document's extracted text
(``services/documents.py``).

Both sides are folded with ``app.text.normalise`` before comparing. An exact
substring match is ``exact``; otherwise ``rapidfuzz.fuzz.partial_ratio >= 92``
is ``fuzzy`` (see ``match_quote`` for the guards); anything else is ``none``.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from itertools import pairwise
from typing import Literal

from rapidfuzz import fuzz

from app.models.schemas import CitationSourceType, Rule
from app.services import documents as documents_service
from app.services import rules as rules_service
from app.services.rules import RuleNotFoundError
from app.text import normalise

FUZZY_THRESHOLD = 92.0
MIN_QUOTE_WORDS = 5

MatchKind = Literal["exact", "fuzzy", "none"]

# Words that change what a rule requires; a fuzzy match must keep them unchanged.
_CRITICAL_WORDS = frozenset(
    {
        "not",
        "no",
        "nor",
        "never",
        "cannot",
        "without",
        "except",
        "unless",
        "shall",
        "may",
        "must",
        "should",
        "zero",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
        "twelve",
        "fifteen",
        "twenty",
        "thirty",
        "forty",
        "fifty",
        "sixty",
        "seventy",
        "eighty",
        "ninety",
        "hundred",
        "thousand",
        "lakh",
        "crore",
        "minute",
        "minutes",
        "hour",
        "hours",
        "day",
        "days",
        "week",
        "weeks",
        "month",
        "months",
        "year",
        "years",
    }
)
# A quote must not start right after one of these source words: cutting them off
# inverts the rule ("No policy ... shall be contestable" -> "policy ... shall be
# contestable").
_LEADING_NEGATIONS = frozenset(
    {"no", "not", "never", "nor", "neither", "cannot", "without", "except", "unless"}
)
_TOKEN = re.compile(r"[a-z0-9]+")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _critical(tokens: list[str]) -> Counter[str]:
    """Count numbers, number/unit words and negation/obligation words."""
    return Counter(t for t in tokens if t.isdigit() or t in _CRITICAL_WORDS)


def _same_critical_words(quote: str, window: str) -> bool:
    """True when ``quote`` neither drops nor adds a critical word of ``window``.

    Adjacent window tokens are also tried joined, so an OCR split such as
    "mont hs" still counts as "months".
    """
    quote_counts = _critical(_TOKEN.findall(quote))
    window_tokens = _TOKEN.findall(window)
    window_counts = _critical(window_tokens)
    joined_counts = window_counts + _critical(
        [a + b for a, b in pairwise(window_tokens)]
    )
    dropped = any(n > quote_counts[t] for t, n in window_counts.items())
    added = any(n > joined_counts[t] for t, n in quote_counts.items())
    return not dropped and not added


def _cuts_off_negation(source: str, start: int) -> bool:
    """True when the source word just before ``start`` is a leading negation."""
    preceding = _TOKEN.findall(source[max(0, start - 40) : start])
    return bool(preceding) and preceding[-1] in _LEADING_NEGATIONS


def _words_in_order(quote: str, window: str) -> bool:
    """True when every quote word occurs in ``window`` in the same order.

    Spacing and punctuation are removed first, so OCR splits such as
    "com plaints" still match "complaints".
    """
    squashed = _NON_ALNUM.sub("", window)
    position = 0
    for word in quote.split():
        token = _NON_ALNUM.sub("", word)
        found = squashed.find(token, position)
        if found < 0:
            return False
        position = found + len(token)
    return True


def _word_window(text: str, start: int, end: int) -> str:
    """Widen ``text[start:end]`` so it does not cut a word at either edge."""
    while start > 0 and not text[start - 1].isspace():
        start -= 1
    while end < len(text) and not text[end].isspace():
        end += 1
    return text[start:end]


def match_quote(quote: str, source: str) -> tuple[MatchKind, float]:
    """Compare ``quote`` against ``source``; return ``(match, score)``.

    ``match`` is ``"exact"`` (substring), ``"fuzzy"`` (partial_ratio >= 92) or
    ``"none"``. ``score`` is 1.0 for an exact match, otherwise partial_ratio / 100.

    Quotes under ``MIN_QUOTE_WORDS`` words never match, and neither does a quote
    that starts right after a source negation ("no", "not", "unless", ...).
    A fuzzy match is refused when the quote is longer than the source
    (partial_ratio would score the source found inside a padded quote as 100),
    when its numbers and negation/obligation words differ from the matched
    source window ("one hour" -> "three hours", a dropped "not"), or when its
    words are added or out of order.
    """
    nq = normalise(quote)
    ns = normalise(source)
    if len(nq.split()) < MIN_QUOTE_WORDS:
        return "none", 0.0
    if nq in ns:
        starts = [m.start() for m in re.finditer(re.escape(nq), ns)]
        if all(_cuts_off_negation(ns, start) for start in starts):
            return "none", 1.0
        return "exact", 1.0
    if len(nq) > len(ns):
        return "none", 0.0
    alignment = fuzz.partial_ratio_alignment(nq, ns)
    score = round(alignment.score / 100.0, 4)
    if alignment.score < FUZZY_THRESHOLD:
        return "none", score
    window = _word_window(ns, alignment.dest_start, alignment.dest_end)
    if not _same_critical_words(nq, window):
        return "none", score
    if _cuts_off_negation(ns, alignment.dest_start):
        return "none", score
    # Fuzzy matching exists for OCR spacing ("p .rovided", "com plaints"), not for
    # added or reordered words: quote words must occur in the window, in order.
    if not _words_in_order(nq, window):
        return "none", score
    return "fuzzy", score


@dataclass
class VerifyOutcome:
    """Result of verifying one quote against one source."""

    verified: bool
    match: MatchKind
    score: float
    page: int | None


def _verify_document(doc_id: str, quote: str) -> VerifyOutcome:
    """Verify ``quote`` against the extracted text of a registered document.

    Raises ``DocumentNotFoundError`` for an unknown ``doc_id``. ``page`` is the
    page of the first clause that alone matches the quote, if any.
    """
    clauses = documents_service.get_clauses(doc_id)
    match, score = match_quote(quote, "\n".join(clause.text for clause in clauses))
    if match == "none":
        return VerifyOutcome(verified=False, match=match, score=score, page=None)
    page = next(
        (c.page for c in clauses if match_quote(quote, c.text)[0] != "none"), None
    )
    return VerifyOutcome(verified=True, match=match, score=score, page=page)


def verify_quote(
    source_type: CitationSourceType | str,
    source_id: str,
    quote: str,
    *,
    rules: list[Rule] | None = None,
) -> VerifyOutcome:
    """Verify ``quote`` against the source identified by type + id.

    ``rules`` may be injected (tests); otherwise they are loaded from disk. A rule
    with ``verified: false`` always yields ``verified: false``. Unknown ids raise
    ``RuleNotFoundError`` / ``DocumentNotFoundError``.
    """
    st = getattr(source_type, "value", source_type)
    if st == "rule":
        pool = rules if rules is not None else rules_service.list_rules()
        rule = next((r for r in pool if r.id == source_id), None)
        if rule is None:
            raise RuleNotFoundError(source_id)
        match, score = match_quote(quote, rule.text)
        verified = match != "none" and rule.verified
        return VerifyOutcome(
            verified=verified, match=match, score=score, page=rule.page
        )

    return _verify_document(source_id, quote)
