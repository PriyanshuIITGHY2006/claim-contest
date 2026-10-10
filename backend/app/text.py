"""Text folding shared by extraction, search and quote verification.

``normalise`` is the single place where the messy realities of the source PDFs
are handled: the "ﬁ" ligature, curly quotes and dashes, hyphenated line breaks
("non- disclosure") and the OMB17 amendment markers ("1 [" / "]"). Code that
compares PDF text with a quote from ``data/`` must compare ``normalise(a)`` with
``normalise(b)`` and never the raw strings.
"""

from __future__ import annotations

import re
import unicodedata

# PDF text layer punctuation -> ASCII. NFKC already expands ligatures such as
# "ﬁ" and non-breaking spaces, but not the curly quotes and dashes.
_PUNCTUATION = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2013": "-",
    "\u2014": "-",
}

# OMB17 prints amendments as footnote markers, e.g. "... Rules, 20171 [updated as
# on 9.11.2023]"; the rule texts in data/rules/rules.yaml omit both markers.
_AMENDMENT_MARKERS = ("1 [", "]")

_HYPHENATED_LINE_BREAK = re.compile(r"(\w)-\s+(\w)")
_WHITESPACE = re.compile(r"\s+")


def normalise(text: str) -> str:
    """Fold ``text`` for comparison: NFKC, ASCII punctuation, one space, lowercase."""
    text = unicodedata.normalize("NFKC", text)
    for source, replacement in _PUNCTUATION.items():
        text = text.replace(source, replacement)
    for marker in _AMENDMENT_MARKERS:
        text = text.replace(marker, "")
    text = _HYPHENATED_LINE_BREAK.sub(r"\1-\2", text)
    return _WHITESPACE.sub(" ", text).strip().lower()
