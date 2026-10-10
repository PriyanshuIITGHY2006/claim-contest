# TASK-09: Grievance drafting, local summary and chatbot baseline

## Goal
Turn an analysis into a signed-by-user grievance letter, a plain local-language summary and dated escalation steps; serve the recorded chatbot baseline for the compare view.

## Files to touch
- `agent/src/draft.ts` (create): letter templates per stage + LLM fill for the narrative paragraph only
- `agent/src/server.ts` (modify: `POST /analyses/:id/draft`, `GET /baseline/:case_id`)
- `data/baseline/README.md` (create): how the baseline was recorded
- `agent/test/draft.test.ts` (create)

## Interface
- `POST /analyses/:id/draft {tier, language}` → `Draft`. Tier 1 = insurer grievance officer, Tier 2 = Bima Bharosa complaint text, Tier 3 = Ombudsman complaint (Annexure VI-A fields). Tier 2/3 return 409 until the tier 1 draft has `human_approved: true`.
- Only contestable verdicts with `confidence >= 0.75` are listed as contested.
- Letter skeleton (code, not model): policyholder details placeholders, policy number, claim number, a table of contested deductions with amount, verbatim quote and source, total recoverable, request, deadline line, "Prepared by the policyholder using a self-help tool. Not legal advice."
- Deadlines from `/calc/deadlines`.
- `GET /baseline/:case_id` reads `data/baseline/<case_id>.json` (`{answer_markdown, errors}`); 404 if missing.

## Acceptance tests
1. The letter for case A contains every contestable deduction id, the amount 40,719.76 formatted Indian style, and each verbatim quote.
2. Valid deductions are not listed as contested.
3. Tier 3 letter includes the one-year deadline date and the Rs 50 lakh / free-of-charge notes (OMB17-14-3b, PPI24-B-VI-3-ii).
5. Tier 2 request before tier 1 approval → 409.
4. Missing baseline file → 404.

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- No new dependencies
