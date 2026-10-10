"""Loading and BM25 search over the regulatory rule base (``data/rules``)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from app.models.schemas import Rule
from app.services.search import BM25Index
from app.settings import settings


class RuleNotFoundError(Exception):
    """Raised when a requested rule id does not exist in the rule base."""

    def __init__(self, rule_id: str) -> None:
        super().__init__(f"rule not found: {rule_id}")
        self.rule_id = rule_id


@lru_cache(maxsize=1)
def _rules() -> tuple[Rule, ...]:
    """Load and validate ``data/rules/rules.yaml`` once (cached)."""
    path: Path = settings.data_dir / "rules" / "rules.yaml"
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return tuple(Rule.model_validate(item) for item in raw.get("rules", []))


@lru_cache(maxsize=1)
def _index() -> BM25Index:
    """BM25 index over each rule's ``text`` + ``test`` + ``ground`` + ``para``."""
    return BM25Index(
        [f"{rule.text} {rule.test} {rule.ground} {rule.para}" for rule in _rules()]
    )


def list_rules() -> list[Rule]:
    """Return every rule, in document order."""
    return list(_rules())


def get_rule(rule_id: str) -> Rule:
    """Return one rule by id; raise ``RuleNotFoundError`` if absent."""
    for rule in _rules():
        if rule.id == rule_id:
            return rule
    raise RuleNotFoundError(rule_id)


def search_rules(query: str, k: int = 5) -> list[Rule]:
    """Top ``k`` rules for ``query``, best BM25 score first."""
    rules = _rules()
    return [rules[hit.index] for hit in _index().search(query, k=k)]
