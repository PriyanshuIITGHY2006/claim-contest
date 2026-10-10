"""Persistence for analyses, verdicts, flags and drafts (stdlib sqlite3).

The store opens one connection per call and maps pydantic models to rows. JSON
columns (``citations`` / ``calculation`` / ``regulation_override``) are
serialised with ``model_dump(mode="json")`` so enums and datetimes round-trip.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from app import db
from app.models.schemas import (
    Analysis,
    AnalysisStatus,
    AnalysisSummary,
    Citation,
    Draft,
    DraftLanguage,
    DraftTier,
    Flag,
    FlagKind,
    RegulationOverride,
    Verdict,
    VerdictStatus,
)


class AnalysisNotFoundError(Exception):
    """Unknown ``analysis_id`` (404)."""


class DraftNotFoundError(Exception):
    """Unknown ``draft_id`` (404)."""


class ApprovalRequiredError(Exception):
    """Tier-2/3 draft posted before the tier-1 draft is approved (409)."""


class DraftExistsError(Exception):
    """A draft with this ``draft_id`` already exists (409); it is never overwritten."""


class AnalysisValidationError(Exception):
    """The posted analysis failed validation (422)."""


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _parse_iso(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _paise(value: float) -> int:
    return round(value * 100)


def _validate(analysis: Analysis) -> None:
    """Reject duplicate deduction ids and totals off by more than one paise."""
    total = _paise(analysis.total_recoverable)
    verdict_total = 0
    seen: set[str] = set()
    for verdict in analysis.verdicts:
        if verdict.deduction_id in seen:
            raise AnalysisValidationError("duplicate deduction_id")
        seen.add(verdict.deduction_id)
        verdict_total += _paise(verdict.recoverable_amount)
    if abs(total - verdict_total) > 1:
        raise AnalysisValidationError("total_recoverable does not match verdicts")


def save_analysis(analysis: Analysis) -> None:
    """Upsert an analysis and replace its verdicts/flags in one transaction."""
    _validate(analysis)
    conn = db.connect()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO analyses
                    (analysis_id, case_id, status, total_recoverable, started_at, finished_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(analysis_id) DO UPDATE SET
                    case_id = excluded.case_id,
                    status = excluded.status,
                    total_recoverable = excluded.total_recoverable,
                    started_at = excluded.started_at,
                    finished_at = excluded.finished_at
                """,
                (
                    analysis.analysis_id,
                    analysis.case_id,
                    analysis.status.value,
                    analysis.total_recoverable,
                    _iso(analysis.started_at),
                    _iso(analysis.finished_at),
                ),
            )
            conn.execute("DELETE FROM verdicts WHERE analysis_id = ?", (analysis.analysis_id,))
            conn.execute("DELETE FROM flags WHERE analysis_id = ?", (analysis.analysis_id,))
            for position, verdict in enumerate(analysis.verdicts):
                conn.execute(
                    """
                    INSERT INTO verdicts
                        (analysis_id, position, deduction_id, status, recoverable_amount,
                         reasoning, citations, calculation, confidence, regulation_override)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        analysis.analysis_id,
                        position,
                        verdict.deduction_id,
                        verdict.status.value,
                        verdict.recoverable_amount,
                        verdict.reasoning,
                        json.dumps([c.model_dump(mode="json") for c in verdict.citations]),
                        json.dumps(verdict.calculation) if verdict.calculation is not None else None,
                        verdict.confidence,
                        json.dumps(verdict.regulation_override.model_dump(mode="json"))
                        if verdict.regulation_override is not None
                        else None,
                    ),
                )
            for position, flag in enumerate(analysis.flags):
                conn.execute(
                    "INSERT INTO flags (analysis_id, position, kind, rule_id, detail) VALUES (?, ?, ?, ?, ?)",
                    (analysis.analysis_id, position, flag.kind.value, flag.rule_id, flag.detail),
                )
    finally:
        conn.close()


def _to_verdict(row: Any) -> Verdict:
    return Verdict(
        deduction_id=row["deduction_id"],
        status=VerdictStatus(row["status"]),
        recoverable_amount=row["recoverable_amount"],
        reasoning=row["reasoning"],
        citations=[Citation.model_validate(c) for c in json.loads(row["citations"])],
        calculation=json.loads(row["calculation"]) if row["calculation"] else None,
        confidence=row["confidence"],
        regulation_override=RegulationOverride.model_validate(json.loads(row["regulation_override"]))
        if row["regulation_override"]
        else None,
    )


def _to_flag(row: Any) -> Flag:
    return Flag(kind=FlagKind(row["kind"]), rule_id=row["rule_id"], detail=row["detail"])


def _to_draft(row: Any) -> Draft:
    return Draft(
        draft_id=row["draft_id"],
        analysis_id=row["analysis_id"],
        tier=DraftTier(row["tier"]),
        language=DraftLanguage(row["language"]),
        letter_markdown=row["letter_markdown"],
        local_summary=row["local_summary"],
        human_approved=bool(row["human_approved"]),
    )


def get_analysis(analysis_id: str) -> Analysis:
    """Return a stored analysis with verdicts and flags in posted order."""
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT * FROM analyses WHERE analysis_id = ?", (analysis_id,)
        ).fetchone()
        if row is None:
            raise AnalysisNotFoundError(analysis_id)
        verdict_rows = conn.execute(
            "SELECT * FROM verdicts WHERE analysis_id = ? ORDER BY position", (analysis_id,)
        ).fetchall()
        flag_rows = conn.execute(
            "SELECT * FROM flags WHERE analysis_id = ? ORDER BY position", (analysis_id,)
        ).fetchall()
        return Analysis(
            analysis_id=row["analysis_id"],
            case_id=row["case_id"],
            status=AnalysisStatus(row["status"]),
            total_recoverable=row["total_recoverable"],
            started_at=_parse_iso(row["started_at"]),
            finished_at=_parse_iso(row["finished_at"]),
            verdicts=[_to_verdict(v) for v in verdict_rows],
            flags=[_to_flag(f) for f in flag_rows],
        )
    finally:
        conn.close()


def list_analyses(case_id: str | None = None) -> list[AnalysisSummary]:
    """Stored analyses without verdicts, newest first, optionally for one case.

    Ordered by ``finished_at`` descending with unfinished runs last, then by
    insertion order descending. ``julianday`` makes timestamps with different UTC
    offsets compare by instant, which a plain string sort would not.
    """
    query = (
        "SELECT analysis_id, case_id, status, total_recoverable, finished_at FROM analyses"
        + (" WHERE case_id = ?" if case_id is not None else "")
        + " ORDER BY finished_at IS NULL, julianday(finished_at) DESC, rowid DESC"
    )
    conn = db.connect()
    try:
        rows = conn.execute(query, (case_id,) if case_id is not None else ()).fetchall()
    finally:
        conn.close()
    return [
        AnalysisSummary(
            analysis_id=row["analysis_id"],
            case_id=row["case_id"],
            status=AnalysisStatus(row["status"]),
            total_recoverable=row["total_recoverable"],
            finished_at=_parse_iso(row["finished_at"]),
        )
        for row in rows
    ]


def get_draft(draft_id: str) -> Draft:
    """Return one stored draft."""
    conn = db.connect()
    try:
        row = conn.execute("SELECT * FROM drafts WHERE draft_id = ?", (draft_id,)).fetchone()
        if row is None:
            raise DraftNotFoundError(draft_id)
        return _to_draft(row)
    finally:
        conn.close()


def create_draft(draft: Draft) -> Draft:
    """Insert a draft (always ``human_approved = false``), gated on tier-1 approval."""
    conn = db.connect()
    try:
        with conn:
            exists = conn.execute(
                "SELECT 1 FROM analyses WHERE analysis_id = ?", (draft.analysis_id,)
            ).fetchone()
            if exists is None:
                raise AnalysisNotFoundError(draft.analysis_id)
            duplicate = conn.execute(
                "SELECT 1 FROM drafts WHERE draft_id = ?", (draft.draft_id,)
            ).fetchone()
            if duplicate is not None:
                raise DraftExistsError(draft.draft_id)
            if draft.tier != DraftTier.tier_1:
                gate = conn.execute(
                    "SELECT 1 FROM drafts WHERE analysis_id = ? AND tier = ? AND human_approved = 1",
                    (draft.analysis_id, DraftTier.tier_1.value),
                ).fetchone()
                if gate is None:
                    raise ApprovalRequiredError(draft.analysis_id)
            conn.execute(
                """
                INSERT INTO drafts
                    (draft_id, analysis_id, tier, language, letter_markdown, local_summary, human_approved)
                VALUES (?, ?, ?, ?, ?, ?, 0)
                """,
                (
                    draft.draft_id,
                    draft.analysis_id,
                    draft.tier.value,
                    draft.language.value,
                    draft.letter_markdown,
                    draft.local_summary,
                ),
            )
            row = conn.execute(
                "SELECT * FROM drafts WHERE draft_id = ?", (draft.draft_id,)
            ).fetchone()
        return _to_draft(row)
    finally:
        conn.close()


def update_draft_approval(draft_id: str, approved: bool) -> Draft:
    """Set a draft's ``human_approved`` flag and return the updated draft."""
    conn = db.connect()
    try:
        with conn:
            row = conn.execute(
                "SELECT * FROM drafts WHERE draft_id = ?", (draft_id,)
            ).fetchone()
            if row is None:
                raise DraftNotFoundError(draft_id)
            conn.execute(
                "UPDATE drafts SET human_approved = ? WHERE draft_id = ?",
                (int(approved), draft_id),
            )
            row = conn.execute(
                "SELECT * FROM drafts WHERE draft_id = ?", (draft_id,)
            ).fetchone()
        return _to_draft(row)
    finally:
        conn.close()
