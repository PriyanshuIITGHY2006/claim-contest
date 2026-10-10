"""Loading logic for the sample cases in ``data/cases`` and the user's uploaded cases.

Sample cases are JSON files; uploaded cases (``user_`` + 8 hex characters) live
in the SQLite ``cases`` table. A ``user_`` id is only ever looked up in SQLite,
so it can never be turned into a file path.
"""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app import db
from app.models.schemas import (
    Bill,
    Case,
    CaseSummary,
    DocumentKind,
    NewCase,
    PolicyRef,
    Settlement,
)
from app.services.documents import DocumentSpec, _registry
from app.settings import settings

USER_CASE_ID = re.compile(r"user_[0-9a-f]{8}")
_ID_ATTEMPTS = 5


class CaseNotFoundError(Exception):
    """Raised when a requested case id does not exist."""

    def __init__(self, case_id: str) -> None:
        super().__init__(f"case not found: {case_id}")
        self.case_id = case_id


class UnknownPolicyError(Exception):
    """Raised when a doc_id is not one of the registered policies."""

    def __init__(self, doc_id: str) -> None:
        super().__init__(f"unknown policy: {doc_id}")
        self.doc_id = doc_id


def _resolve_case_path(case_id: str) -> Path | None:
    """Return the JSON path for ``case_id`` if it exists inside the cases dir.

    Guards against path traversal: the resolved file must sit directly in the
    cases directory.
    """
    base = settings.cases_dir.resolve()
    candidate = (base / f"{case_id}.json").resolve()
    if candidate.parent != base or not candidate.is_file():
        return None
    return candidate


def _load(path: Path) -> Case:
    data = json.loads(path.read_text(encoding="utf-8"))
    return Case.model_validate(data)


def _load_user_case(case_id: str) -> Case:
    if not USER_CASE_ID.fullmatch(case_id):
        raise CaseNotFoundError(case_id)
    conn = db.connect()
    try:
        row = conn.execute("SELECT data FROM cases WHERE case_id = ?", (case_id,)).fetchone()
    finally:
        conn.close()
    if row is None:
        raise CaseNotFoundError(case_id)
    return Case.model_validate_json(row["data"])


def load_case(case_id: str) -> Case:
    """Load and validate a single case; raise ``CaseNotFoundError`` if absent."""
    if case_id.startswith("user_"):
        return _load_user_case(case_id)
    path = _resolve_case_path(case_id)
    if path is None:
        raise CaseNotFoundError(case_id)
    return _load(path)


def list_cases() -> list[CaseSummary]:
    """Summaries of the samples (sorted by id), then uploaded cases, newest first."""
    base = settings.cases_dir
    summaries = [_summarise(_load(path)) for path in sorted(base.glob("*.json"))]
    conn = db.connect()
    try:
        rows = conn.execute("SELECT data FROM cases ORDER BY created_at DESC, rowid DESC").fetchall()
    finally:
        conn.close()
    summaries.extend(_summarise(Case.model_validate_json(row["data"])) for row in rows)
    return summaries


def _summarise(case: Case) -> CaseSummary:
    """Summary = first deduction label + total deducted (as stored)."""
    deductions = case.settlement.deductions
    label = deductions[0].label if deductions else "No deductions recorded"
    summary = f"{label} - total deducted {case.settlement.total_deducted}"
    return CaseSummary(id=case.case_id, title=case.title, summary=summary)


def _policy_spec(doc_id: str) -> DocumentSpec:
    """The registered policy ``doc_id``; regulations are not policies."""
    for spec in _registry():
        if spec.doc_id == doc_id and spec.kind == DocumentKind.policy:
            return spec
    raise UnknownPolicyError(doc_id)


def ensure_policy(doc_id: str) -> None:
    """Raise ``UnknownPolicyError`` unless ``doc_id`` is a registered policy."""
    _policy_spec(doc_id)


def _total(amounts: list[float]) -> float:
    """Sum rupee amounts in whole paise so the stored totals carry no float noise."""
    return sum(round(amount * 100) for amount in amounts) / 100


def create_case(new_case: NewCase) -> str:
    """Store a user-confirmed case and return its ``user_`` id."""
    spec = _policy_spec(new_case.doc_id)
    policy = PolicyRef(
        doc_id=spec.doc_id,
        file=f"data/{spec.path.relative_to(settings.data_dir).as_posix()}",
        product=spec.title,
        schedule=new_case.schedule,
    )
    deductions = new_case.deductions
    for _ in range(_ID_ATTEMPTS):
        case_id = f"user_{uuid.uuid4().hex[:8]}"
        case = Case(
            case_id=case_id,
            title=deductions[0].label,
            synthetic_notice="Uploaded by the user",
            policy=policy,
            patient=new_case.patient,
            admission=new_case.admission,
            bill=Bill(
                lines=new_case.bill_lines,
                total=_total([line.amount for line in new_case.bill_lines]),
            ),
            settlement=Settlement(
                claimed=new_case.claimed,
                approved=new_case.approved,
                total_deducted=_total([d.amount for d in deductions]),
                deductions=deductions,
                letter_text=new_case.letter_text,
            ),
            timeline=new_case.timeline,
            expected=[],
        )
        conn = db.connect()
        try:
            with conn:
                conn.execute(
                    "INSERT INTO cases (case_id, data, created_at) VALUES (?, ?, ?)",
                    (case_id, case.model_dump_json(), datetime.now(timezone.utc).isoformat()),
                )
            return case_id
        except sqlite3.IntegrityError:
            continue
        finally:
            conn.close()
    raise RuntimeError("could not generate a unique case id")

