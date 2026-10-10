# TASK-12 log — Action centre and compare view

Branch: `task-12-action-compare` · Owner: github-kaustavbhowal21

## Built
- `frontend/components/ActionCentre.tsx` (client component):
  - "Prepare letter" calls `POST /analyses/:id/draft` only when clicked; nothing is drafted while the page renders.
  - Tier stepper 1 → 2 → 3. Tiers 2 and 3 stay disabled until the tier-1 approval checkbox succeeds (`PATCH /drafts/{id}`); a failed approval keeps them locked and shows the server's message.
  - Changing the language re-requests the draft only once one exists. A note says the letter stays in English and the language sets the plain-language summary.
  - Editable letter (textarea) with a plain-text Preview, Copy, Download .md, and the local summary.
  - Escalation timeline uses the letters' wording ("within 14 days of receiving it", "one month after you sent it"), the assumed-decision-date note and the dated one-year Ombudsman limit. Entering "I sent my grievance on" re-calls `/calc/deadlines` with `grievance_sent_on` and shows real dates.
  - "Add deadlines to calendar (.ics)".
- `frontend/lib/ics.ts`:
  - `deadlineEvents(steps, grievanceSent)`: without a grievance date, one event (Ombudsman latest, decision + 1 year); with it, insurer latest, Ombudsman earliest (OMB17-14-3a) and Ombudsman latest.
  - `buildIcs`: RFC 5545 all-day events, CRLF lines, TEXT escaping, line folding, unique UIDs, injectable `DTSTAMP`.
- `frontend/components/CompareView.tsx` (server component): the verbatim chatbot answer as plain text next to our verdicts. `matchErrors` attaches each baseline error to the first known deduction id it mentions (`\bD\d+\b`, so D1 does not match D10). Errors with no id go under "Other errors". A 404 baseline shows an empty state; a load failure shows an alert.
- `frontend/app/case/[id]/page.tsx`: Action and Compare tabs. The server loads only the deadlines (discharge date as assumed decision date) and the baseline, both read-only. The Action tab waits until the analysis is done.

## Files touched outside the task list (approved in Plan mode)
- `frontend/lib/api.ts`:
  - New calls: `requestDraft`, `approveDraft`, `calcDeadlines`, `getBaseline` (returns `null` on 404).
  - New types: `Draft`, `DraftTier`, `DraftLanguage`, `DeadlineStep`, `Baseline`, `BaselineError`.
  - `ApiError` messages now append the server's reason. On rebase this merged with TASK-16's `readDetail` and `ApiError.detail`, which I kept; I extended `readDetail` to also read the agent's `{ message }`. The reason is still kept on `detail` (UploadZone shows it alone) and is also appended to `message`. Existing tests stayed green.
- `frontend/tests/ActionCentre.test.tsx` (new), for acceptance 2 and 3.
- `data/baseline/README.md`: one sentence asking recorders to put the deduction id in each error.

## Cline usage
- Plan mode:
  - Read the board, TASK-12, the TASK-09 draft API and its review fix (`1b2e7ee`: deadlines relative to the grievance), the case page, `api.ts`, the frontend test setup, and CORS in the backend and agent.
  - Proposed a plan with 6 gaps and 3 decisions (A–C). The user approved with changes: one .ics event without a grievance date, draft only on click, no clause context in this task.
- Act mode: claimed TASK-12 and set TASK-08 to done in one board commit, created the branch, wrote tests first, implemented, then ran `/finish-task.md`.
- Workflows: `/start-task.md`, `/finish-task.md`.
- Built-in commands / MCP tools: none. Only the standard read, search, shell (git / npm / vitest / tsc / next / uvicorn / tsx) and editor tools.
- Environment:
  - `frontend/node_modules` was missing, so the first vitest run hung on an npx download. Fixed with `npm ci` from the existing lockfile; no dependency changes.
  - The first end-to-end attempt hung because `npx tsx` prompted to install `tsx` in `frontend/`. Re-ran it with the agent's local `tsx` inside a 90 s timeout job.
- Throwaway end-to-end script (deleted, not committed): the frontend's `lib/api.ts` and `lib/ics.ts` against a backend on a temporary SQLite file and a scripted agent.
  - Case A analysis done with 40719.76.
  - .ics: one event (decision 2026-08-07 + 1 year = 20270807) without a grievance date; 20260824 / 20260910 / 20270807 with one.
  - Tier 2 before approval returned 409 with the agent's message; tier 1 in Hindi returned 200.
  - CORS preflight for PATCH /drafts was allowed for `http://localhost:3000`.
  - Approval worked; tier 3 contained "Rs 50 lakh" and 7 August 2027.
  - `getBaseline("case_a")` returned `null`; an unknown draft's 404 carried "Draft not found".

## Tests
- `frontend/tests/ics.test.ts` (7): acceptance 1; no grievance date gives exactly one VEVENT with DTSTART 20270807 for case A; `deadlineEvents` both modes; CRLF / wrapper / DTSTAMP / unique UIDs; escaping; empty list.
- `frontend/tests/CompareView.test.tsx` (7): acceptance 4; "Other errors"; D1 vs D10; plain-text answer; empty state; load failure.
- `frontend/tests/ActionCentre.test.tsx` (10): acceptance 2 and 3; no draft until clicked; failed approval keeps tiers locked; language re-draft only after a draft; agent error shown; edit + preview; timeline relative wording then real dates; .md and .ics downloads (one event); copy.
- All three suites failed first because the modules didn't exist yet.
- Before rebase: frontend 90/90 (66 existing + 24 new).
- Rebased onto `origin/main` (TASK-16 upload merged):
  - `lib/api.ts` conflicted and was merged as above.
  - The append-only memory-bank bullets conflicted and were resolved by keeping both sides. A UTF-8 BOM the shell had added was stripped, so the diff is append-only.
  - Final: `npx vitest run` 99/99 (including TASK-16's 9), `tsc --noEmit` exit 0, `next lint` clean, `next build` succeeded.

## Notes / follow-ups
- Each "Prepare letter", tier switch or language change writes a new draft row on the backend (new `draft_id`), and there is no endpoint to reload the latest draft for an analysis, so a page reload starts from "Prepare letter" again.
- Compare shows only the empty state until `data/baseline/case_a..c.json` are recorded.
- Not in this task (follow-up): show the policy clause next to policy citations. Rule citations already show the full rule text in the evidence panel (TASK-17).

## Checkpoint restores
- 0

## Review fixes
- Choosing Hindi or Assamese put the letter's "Grounds" paragraph in that language inside an otherwise English letter to the insurer (seen live on a tier-1 draft). The draft service (`agent/src/draft.ts`, TASK-09) now always writes the narrative in English; the chosen language sets only the local summary, which matches the note shown in the Action tab. New service-level test (failed before the fix).
- Review checks that held (live, real agent and backend): tier-1 draft for an uploaded claim lists D1 with Rs 15,000.00 from the calculator, verbatim policy quotes, the 14-day insurer limit and the one-year Ombudsman date; the Hindi summary is correct; tier 2 before approval is refused with "Tier-1 draft must be approved first". No draft is created on page render. Merged with `main` (TASK-15, TASK-16): memory-bank conflicts kept both sides. Frontend 99, agent 141, `tsc` and lint clean.
- Still open (not code): `data/baseline/case_a.json`, `case_b.json`, `case_c.json` are not recorded, so the Compare tab shows its empty state.
