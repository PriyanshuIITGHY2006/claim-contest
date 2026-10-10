# TASK-04 log — Deterministic calculators

Branch: `task-04-deterministic-calculators` · Owner: github-kaustavbhowal21

## Built
- `backend/app/services/calculators.py`: pure `calc_proportionate`, `calc_waiting_period`, `calc_tat`, `calc_deadlines` plus `add_months` / `whole_months_between`; money via `Decimal` with `ROUND_HALF_UP` to 2 dp, applied once at the end; `ratio = min(1, eligible/actual)` left unrounded.
- `backend/app/routes/calc.py` (4 thin POST endpoints) + registration in `backend/app/main.py`: `/calc/proportionate`, `/calc/waiting-period`, `/calc/tat`, `/calc/deadlines`.

## Cline usage
- Plan mode to read the board, memory-bank and sample cases, then agree the plan and refinements (unrounded `min(1, …)` ratio; `Decimal` rounding once at the end; deadline/whole-month clamping) before writing code; Act mode for the claim, branch and TDD implementation.
- Workflows: claim-on-board + branch-per-task, TDD (tests written first, seen failing, then passing), `ruff check --fix`.
- Built-in commands / MCP tools: none used; only the standard read, code search, shell (git / pytest / ruff) and editor tools.

## Tests
- `backend/tests/test_calculators.py`: 11 tests — 5 acceptance (proportionate case A, waiting-period B & C, TAT D, deadlines) plus edge cases (TAT ordering → 422, no `regulation_months`, `grievance_sent_on`, actual ≤ eligible, end-of-month clamping).
- Result: `pytest -q` → 43 passed (32 existing + 11 new).

## Checkpoint restores
- 0

## Review fixes
- `/calc/proportionate` now accepts an optional insurer `deduction` (`amount`, `line_ids`) and returns `recoverable_amount` = the part of that deduction above the correct cut on its own lines. Case A: D3 → 40,719.76, D1 and D2 → 0. Without it the agent would have had to subtract amounts itself, which the citation gate forbids. Interface updated in `memory-bank/systemPatterns.md` (additive); unknown line ids return 422.
- `/calc/waiting-period` rejects an event date before the inception date with 422 (it returned `months_completed: -12`).
- `/calc/tat` rejects a mix of time-zone-aware and naive datetimes with 422 (it crashed with a 500).
- Review checks that held: case A per-deduction results match the expected verdicts (D1/D2 valid, D3 contestable 40,719.76); a room cheaper than eligibility gives zero deductions; two different time zones compare correctly; deadline rule ids exist in `data/rules/rules.yaml`. 5 new tests; 48 backend tests pass.
- Note: `recoverable_amount` applies only to proportionate-deduction items; non-payable items (case A D4) are judged separately.
