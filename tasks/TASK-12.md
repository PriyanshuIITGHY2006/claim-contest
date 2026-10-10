# TASK-12: Action centre and compare view

## Goal
Close the loop: the letter, the escalation plan and the side-by-side with a plain chatbot.

## Files to touch
- `frontend/components/ActionCentre.tsx` (create): tier stepper 1 → 2 → 3 with dates, approve toggle (PATCH `/drafts/{id}`) that unlocks tiers 2/3, language selector, editable letter (textarea with preview), copy/download (.md), escalation timeline with dates
- `frontend/lib/ics.ts` (create): build an .ics file for the deadlines
- `frontend/components/CompareView.tsx` (create): baseline answer vs our verdicts, baseline errors highlighted
- `frontend/app/case/[id]/page.tsx` (modify: tabs Action · Compare)
- `frontend/tests/ics.test.ts`, `frontend/tests/CompareView.test.tsx` (create)

## Acceptance tests
1. `buildIcs(deadlines)` produces one VEVENT per step with the correct DTSTART dates.
2. ActionCentre shows the letter returned by the draft endpoint and the local summary.
3. Tier 2 and 3 buttons are disabled until the tier 1 draft is approved.
4. CompareView lists each baseline error next to the corresponding verdict.

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- No new dependencies beyond TASK-10

## Notes
- Each verified citation in the evidence panel shows the full rule text (`GET /rules/{id}`) or the policy clause next to the quote, so a quote that stops before an exception is visible in context (see TASK-08).
