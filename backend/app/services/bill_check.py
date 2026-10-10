"""Bill arithmetic check: the hospital's own numbers, verified in code.

Money is handled as ``Decimal`` built from ``str(float)`` so 33.33 x 3 compares
exactly; results are returned as floats rounded to two places.
"""

from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal

from app.models.schemas import BillCategory, BillCheck, BillCheckIssue, BillLine

# Per-stent ceilings, exclusive of GST, in force from 1 Apr 2026. Source: NPPA
# S.O. 1587(E), revision under DPCO 2013, Schedule-I Sl. No. 28.
STENT_CEILING_DRUG_ELUTING = Decimal("39186.03")  # includes bioresorbable stents
STENT_CEILING_BARE_METAL = Decimal("10762.15")

_TOLERANCE = Decimal("0.01")
_CENT = Decimal("0.01")
_BARE_METAL = re.compile(r"\bbare[\s-]?metal\b|\bbms\b", re.IGNORECASE)


def _dec(value: float) -> Decimal:
    return Decimal(str(value))


def _money(value: Decimal) -> float:
    return float(value.quantize(_CENT, rounding=ROUND_HALF_UP))


def _stent_ceiling(line: BillLine) -> Decimal | None:
    """Ceiling for a stent line, or None when the line is not a stent."""
    if line.category != BillCategory.implant or "stent" not in line.particulars.lower():
        return None
    if _BARE_METAL.search(line.particulars):
        return STENT_CEILING_BARE_METAL
    return STENT_CEILING_DRUG_ELUTING


def check_bill(lines: list[BillLine], printed_total: float | None = None) -> list[BillCheck]:
    """Return every arithmetic problem on the bill; an empty list means consistent."""
    issues: list[BillCheck] = []
    seen: set[tuple[object, str, Decimal]] = set()

    for line in lines:
        expected = _dec(line.rate) * _dec(line.units)
        if abs(expected - _dec(line.amount)) > _TOLERANCE:
            issues.append(
                BillCheck(
                    line_id=line.line_id,
                    issue=BillCheckIssue.line_math,
                    expected=_money(expected),
                    found=line.amount,
                )
            )

        ceiling = _stent_ceiling(line)
        if ceiling is not None and _dec(line.rate) > ceiling:
            issues.append(
                BillCheck(
                    line_id=line.line_id,
                    issue=BillCheckIssue.above_price_cap,
                    expected=_money(ceiling),
                    found=line.rate,
                )
            )

        key = (line.date, line.particulars, _dec(line.amount))
        if key in seen:
            issues.append(
                BillCheck(
                    line_id=line.line_id,
                    issue=BillCheckIssue.duplicate,
                    expected=None,
                    found=line.particulars,
                )
            )
        seen.add(key)

    if printed_total is not None:
        total = sum((_dec(line.amount) for line in lines), Decimal("0"))
        if abs(total - _dec(printed_total)) > _TOLERANCE:
            issues.append(
                BillCheck(
                    line_id=None,
                    issue=BillCheckIssue.total_mismatch,
                    expected=_money(total),
                    found=printed_total,
                )
            )
    return issues
