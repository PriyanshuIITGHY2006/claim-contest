"""Okapi BM25 ranking over a fixed list of documents.

Deliberately small and dependency-free (TASK-02 allows no extra search library):
the corpus is a few hundred clauses per PDF, so an in-memory index is plenty.
Documents and queries are folded with ``app.text.normalise`` before tokenising,
so matching survives ligatures, curly quotes and hyphenated line breaks, while
callers keep returning the *original* text to the API.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from app.text import normalise

# Okapi BM25 tuning: ``k1`` damps term-frequency saturation, ``b`` damps the
# document-length correction.
K1 = 1.5
B = 0.75


@dataclass(frozen=True)
class SearchHit:
    """One ranked match: position in the indexed list plus its BM25 score."""

    index: int
    score: float


class BM25Index:
    """BM25 index over ``documents`` (raw text, normalised internally)."""

    def __init__(self, documents: Sequence[str], *, k1: float = K1, b: float = B) -> None:
        self._k1 = k1
        self._b = b
        self._counts = [Counter(normalise(document).split()) for document in documents]
        self._lengths = [sum(counts.values()) for counts in self._counts]
        self._size = len(self._counts)
        self._avgdl = sum(self._lengths) / self._size if self._size else 0.0
        self._document_frequency: Counter[str] = Counter()
        for counts in self._counts:
            self._document_frequency.update(counts.keys())

    def __len__(self) -> int:
        """Number of indexed documents."""
        return self._size

    def _idf(self, term: str) -> float:
        """Robertson-Sparck Jones idf, shifted by 1 so it stays non-negative."""
        seen_in = self._document_frequency.get(term, 0)
        return math.log(1 + (self._size - seen_in + 0.5) / (seen_in + 0.5))

    def search(self, query: str, k: int = 5) -> list[SearchHit]:
        """Return up to ``k`` hits, best first; equal scores keep corpus order.

        Documents that share no token with the query score 0 and are dropped, so
        an empty list means "no evidence found" rather than "no documents".
        """
        terms = normalise(query).split()
        if k <= 0 or not terms or self._avgdl == 0:
            return []

        hits: list[SearchHit] = []
        for index, counts in enumerate(self._counts):
            score = 0.0
            length = self._lengths[index]
            for term in terms:
                frequency = counts.get(term, 0)
                if frequency == 0:
                    continue
                denominator = frequency + self._k1 * (
                    1 - self._b + self._b * length / self._avgdl
                )
                score += self._idf(term) * frequency * (self._k1 + 1) / denominator
            if score > 0:
                hits.append(SearchHit(index=index, score=score))

        hits.sort(key=lambda hit: (-hit.score, hit.index))
        return hits[:k]
