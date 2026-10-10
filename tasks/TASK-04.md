# TASK-04: Deterministic calculators

## Goal
All money and date logic as pure, tested functions behind endpoints. The model never computes amounts.

## Files to touch
- `backend/app/services/calculators.py` (create)
- `backend/app/routes/calc.py` (create), register in `backend/app/main.py` (modify)
- `backend/tests/test_calculators.py` (create)

## Interface
`POST /calc/proportionate`, `/calc/waiting-period`, `/calc/tat`, `/calc/deadlines` exactly as in systemPatterns.
- proportionate: `ratio = eligible/actual`; `room_difference = (actual-eligible)*days`; `correct_deduction = room_difference + associated_total*(1-ratio)`; exempt lines get 0. If actual ≤ eligible, all deductions 0.
- waiting-period: whole months between dates; `applicable_months = min(policy_months, regulation_months)` when given; `overridden` true if regulation shortened it.
- tat: minutes between ISO datetimes.
- deadlines: insurer grievance now; Ombudsman earliest = grievance_sent_on + 1 month (or decision date if insurer already rejected the grievance), latest = decision date + 1 year (OMB17-14-3); each step carries its `rule_id`.

## Acceptance tests (use `data/cases/*.json`)
1. Case A lines, eligible 5000, actual 8000, days 4: ratio 0.625, room_difference 12000, associated_total 118000, exempt_total 108586.03, the cut on exempt heads the insurer applied (40719.76) equals `exempt_total*(1-ratio)` rounded to 2 dp, and `correct_deduction` = 56250.0.
2. Waiting period: inception 2019-04-01, event 2026-09-02, policy 96, regulation 60 → months_completed 89, applicable 60, elapsed true, overridden true (case B).
3. Waiting period: inception 2025-01-15, event 2026-08-10, policy 48, regulation 36 → months_completed 18, elapsed false (case C).
4. TAT: 2026-07-23T11:00 → 16:30, limit 180 → elapsed 330, breached, over_by 150 (case D). Cashless 08:00 → 10:15, limit 60 → breached.
5. Deadlines from decision 2026-08-07: Ombudsman latest 2027-08-07.

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- No new dependencies (use `datetime`, `decimal` or round-half-up to 2 dp)
