"""Deterministic money and date calculators.

The agent service never computes money or dates itself; every rupee and date
in a verdict must come from these pure functions (see memory-bank/systemPatterns.md).
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.models.schemas import BillCategory, BillLine

# Categories that attract the proportionate deduction alongside room rent
# (Star FHO folds nursing into room; see memory-bank/systemPatterns.md).
ASSOCIATED_CATEGORIES: frozenset[str] = frozenset(
    {"nursing", "professional_fee", "ot", "procedure"}
)

# Categories that must never be cut under proportionate deduction.
DEFAULT_EXEMPT_CATEGORIES: frozenset[str] = frozenset(
    {"pharmacy", "consumables", "implant", "diagnostics"}
)

_ONE_CENT = Decimal("0.01")


def _rupees(value: Decimal) -> float:
    """Round a rupee amount to 2 decimals, round-half-up (the only rounding step)."""
    return float(value.quantize(_ONE_CENT, rounding=ROUND_HALF_UP))


def add_months(value: date, months: int) -> date:
    """Add ``months`` calendar months, clamping the day to the target month."""
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)


def whole_months_between(start: date, end: date) -> int:
    """Whole calendar months from ``start`` to ``end``.

    An end-of-month start day is clamped to the end month's length so that,
    e.g., Jan 31 -> Feb 29 counts as one whole month.
    """
    months = (end.year - start.year) * 12 + (end.month - start.month)
    effective_start_day = min(start.day, monthrange(end.year, end.month)[1])
    if end.day < effective_start_day:
        months -= 1
    return months


def calc_proportionate(
    eligible_room_rent: float,
    actual_room_rent: float,
    days: int,
    lines: list[BillLine],
    exempt_categories: list[str] | None = None,
    deduction_amount: float | None = None,
    deduction_line_ids: list[str] | None = None,
) -> dict[str, object]:
    """Proportionate room-rent deduction (TASK-04 / systemPatterns).

    ``ratio`` is ``min(1, eligible/actual)`` and is never rounded. Only rupee
    amounts are rounded, once, at the end (round-half-up to 2 dp).

    When an insurer deduction is given (amount plus the bill lines it covers),
    ``recoverable_amount`` is the part of it that exceeds the correct cut on
    those lines, so no caller ever has to subtract amounts itself.
    """
    exempt = (
        set(exempt_categories)
        if exempt_categories is not None
        else set(DEFAULT_EXEMPT_CATEGORIES)
    )
    eligible = Decimal(str(eligible_room_rent))
    actual = Decimal(str(actual_room_rent))
    if actual <= 0:
        raise ValueError("actual_room_rent must be positive")

    ratio = min(Decimal(1), eligible / actual)
    room_difference = max(actual - eligible, Decimal(0)) * Decimal(days)

    associated_total = Decimal(0)
    exempt_total = Decimal(0)
    per_line: list[dict[str, object]] = []

    for line in lines:
        amount = Decimal(str(line.amount))
        is_associated = line.category.value in ASSOCIATED_CATEGORIES

        if is_associated:
            associated_total += amount
            deduction = amount * (Decimal(1) - ratio)
        elif line.category == BillCategory.room:
            deduction = max(actual - eligible, Decimal(0)) * Decimal(str(line.units))
        else:
            if line.category.value in exempt:
                exempt_total += amount
            deduction = Decimal(0)

        per_line.append(
            {
                "line_id": line.line_id,
                "category": line.category,
                "associated": is_associated,
                "deduction": _rupees(deduction),
            }
        )

    correct_deduction = room_difference + associated_total * (Decimal(1) - ratio)

    recoverable_amount: float | None = None
    if deduction_amount is not None:
        line_ids = deduction_line_ids or []
        correct_by_line = {
            item["line_id"]: Decimal(str(item["deduction"])) for item in per_line
        }
        unknown = [line_id for line_id in line_ids if line_id not in correct_by_line]
        if unknown:
            raise ValueError(f"deduction refers to unknown bill lines: {unknown}")
        correct_on_lines = sum(
            (correct_by_line[line_id] for line_id in line_ids), Decimal(0)
        )
        recoverable_amount = _rupees(
            max(Decimal(str(deduction_amount)) - correct_on_lines, Decimal(0))
        )

    return {
        "ratio": float(ratio),
        "room_difference": _rupees(room_difference),
        "associated_total": _rupees(associated_total),
        "exempt_total": _rupees(exempt_total),
        "correct_deduction": _rupees(correct_deduction),
        "per_line": per_line,
        "recoverable_amount": recoverable_amount,
    }


def calc_waiting_period(
    inception_date: date,
    event_date: date,
    policy_months: int,
    regulation_months: int | None = None,
) -> dict[str, object]:
    """Waiting-period/moratorium check (whole months; regulation caps policy)."""
    if event_date < inception_date:
        raise ValueError("event_date must not be before inception_date")
    months_completed = whole_months_between(inception_date, event_date)
    if regulation_months is not None:
        applicable_months = min(policy_months, regulation_months)
        overridden = regulation_months < policy_months
    else:
        applicable_months = policy_months
        overridden = False
    return {
        "months_completed": months_completed,
        "applicable_months": applicable_months,
        "elapsed": months_completed >= applicable_months,
        "overridden": overridden,
    }


def calc_tat(
    requested_at: datetime, decided_at: datetime, limit_minutes: int
) -> dict[str, object]:
    """Turnaround-time check: minutes between two ISO datetimes vs a limit."""
    if (requested_at.tzinfo is None) != (decided_at.tzinfo is None):
        raise ValueError(
            "requested_at and decided_at must both have a time zone or neither"
        )
    elapsed_minutes = int((decided_at - requested_at).total_seconds() // 60)
    breached = elapsed_minutes > limit_minutes
    return {
        "elapsed_minutes": elapsed_minutes,
        "limit_minutes": limit_minutes,
        "breached": breached,
        "over_by_minutes": max(elapsed_minutes - limit_minutes, 0),
    }


def calc_deadlines(
    decision_date: date, grievance_sent_on: date | None = None
) -> dict[str, object]:
    """Escalation timeline: insurer grievance (14 days) then Ombudsman (1 year)."""
    base = grievance_sent_on if grievance_sent_on is not None else decision_date
    return {
        "steps": [
            {
                "stage": "insurer_grievance",
                "earliest": base,
                "latest": base + timedelta(days=14),
                "rule_id": "PPI24-B-VI-2-i",
                "note": "Insurer must resolve within 14 days with specific reference to policy terms (PPI24 Part B VI(2)(i)).",
            },
            {
                "stage": "ombudsman",
                "earliest": add_months(base, 1),
                "latest": add_months(decision_date, 12),
                "rule_id": "OMB17-14-3b",
                "note": "Earliest one month after the grievance (earlier if the insurer rejects it — OMB17-14-3a); latest one year from the decision (conservative — the rule counts from the insurer's reply).",
            },
        ]
    }
