# TASK-09 log — Grievance drafting, local summary and chatbot baseline

Branch: `task-09-grievance-drafting` · Owner: github-kaustavbhowal21

## Built
- `agent/src/draft.ts`: `buildDraft` builds every letter in code.
  - Tiers: tier 1 goes to the insurer's grievance officer, tier 2 is Bima Bharosa complaint text, tier 3 is an Ombudsman complaint with the Annexure VI-A fields.
  - Contents: policy, patient and admission details; `[Policy number]` and `[Claim number]` placeholders; a table of contested deductions with Indian-format amounts, verbatim quotes and their sources; the total; the request; deadlines from `/calc/deadlines`; the self-help footer.
  - Tier 3 adds the Rs 50 lakh limit (PPI24-B-VI-3-i) and the free-of-charge note (PPI24-B-VI-3-ii).
  - `contestedVerdicts` decides which deductions are contested: status `contestable` and confidence >= 0.75. It does not use `include_in_grievance`, which the backend does not persist.
  - A local summary in en/hi/as, from templates, with numbers formatted by code.
  - `createDraftService` reads the analysis from the in-memory store first, then from the backend's `GET /analyses/{id}`, so drafting survives an agent restart. It saves the analysis (`POST /analyses`, safe to repeat), then the draft (`POST /drafts`). The backend's 409 (tier 1 not approved) is returned unchanged.
- `agent/src/llm/narrator.ts`: writes the narrative paragraph with an LLM, only when `AGENT_MODE=llm`. `safeNarrative` throws away any paragraph that contains a digit and uses the digit-free template instead. Model failures go to `onError`, which the server logs, and the draft uses the template.
- `agent/src/server.ts`:
  - `POST /analyses/:id/draft {tier, language}`: 400 for a bad body, 404 for an unknown analysis, 409 while the analysis is running or before tier 1 is approved.
  - `GET /baseline/:case_id`: reads `data/baseline/<id>.json`; 404 if the file is missing, 400 for an id outside `[A-Za-z0-9_-]`.
- `data/baseline/README.md`: how to record a baseline answer and the file format.
- Decision date: the case data has no settlement-letter date, so the discharge date is used. Every letter says: "Assumed decision date: date of discharge. Replace it with the date on your settlement letter."

## Files touched outside the task list (approved in Plan mode)
- `agent/src/types.ts`: `policy`, `patient` and `admission` added to `caseSchema`, because the letter needs the product, UIN, hospital and dates.
- `agent/src/backend.ts`: `saveDraft` (`POST /drafts`), approved. `getAnalysis` (`GET /analyses/{id}`) was also added for the requested backend fallback.
- `agent/src/llm/narrator.ts` and `agent/test/narrator.test.ts`: new files, requested in Plan mode (decision C).

## Cline usage
- Plan mode:
  - Read TASK-09/12, the agent server/backend/types, the backend draft store and schema, and the case data.
  - Proposed a plan with 6 gaps and 3 decisions (A–C); the user approved with changes.
  - The session paused after the claim commit; on resume, checked git state (claim committed locally but not pushed, no branch).
- Act mode: pushed the claim, created the branch, wrote tests first, implemented, then ran `/finish-task.md`.
- Workflows: `/start-task.md`, `/finish-task.md`.
- Built-in commands / MCP tools: none. Only the standard read, search, shell (git / npm / vitest / tsc / pytest / uvicorn) and editor tools.
- Throwaway end-to-end scripts (deleted, not committed), run against a backend with a temporary SQLite file (`DATABASE_URL`) so `backend/app.db` was not touched:
  - Cases A and B: tier 2 before approval returns 409; tier 1 in Hindi returns 200; `PATCH /drafts` approves; tier 3 returns 200 with "Rs 50 lakh" and latest date 7 August 2027 (A) / 7 September 2027 (B).
  - The first run found a bug: after an agent restart, drafting failed with 502 because FastAPI returns `null` for unset optional verdict fields. The backend-fallback test was changed to use the same `null` fields, failed, and was fixed by dropping null fields before parsing. The re-run returned 200 for an Assamese draft after a restart.
  - The run also showed empty quotes from scripted-mode citations printed as `""`. They now print "(quote not verified)", with a test.

## Tests
- `agent/test/draft.test.ts` (20):
  - Acceptance 1–5.
  - Low-confidence contestable verdicts are excluded; `include_in_grievance` is ignored; tier 2 is Bima Bharosa.
  - en/hi/as summaries; Indian number format; digit-free template; `safeNarrative` digit fallback; a clean narrator paragraph is used.
  - Discharge date sent as `decision_date`; backend fallback with FastAPI `null` fields; 404 unknown; 409 running.
  - HTTP: draft 200, tier 2 409, bad body 400, baseline 200/404, unsafe ids 400; no empty quotes.
- `agent/test/narrator.test.ts` (4), using the real SDK `Agent` with a scripted model: a clean paragraph is used; a paragraph with digits falls back to the template; a model error is reported and falls back; nothing contested means no model call.
- Both suites failed first because the modules didn't exist yet.
- After rebasing onto `origin/main` (TASK-17 merged): `npm test` 104/104, `npm run typecheck` exit 0, backend `pytest -q` 97/97.

## Notes
- No baseline files are recorded yet, so `GET /baseline/case_a` returns 404 until the demo owner adds `data/baseline/case_*.json`.
- The Hindi and Assamese template sentences were written without a native speaker; they need a check.
- The LLM narrator has not been run against a real model; it needs `LLM_*` credentials.

## Checkpoint restores
- 0

## Review fixes
- Deadline lines: the insurer's 14-day reply window and the one-month wait before the Ombudsman were dated from the decision date (case A: "by 21 August 2026", "from 7 September 2026"), so a letter drafted later showed past dates and invited a premature Ombudsman complaint. Both now run from the grievance ("within 14 days of receiving it", "one month after I sent it"); only the one-year latest date stays dated. Test updated to assert the relative wording and the absence of the old dates.
- `data/baseline/README.md`: no longer asks for the chatbot's product or model name in the commit message.
- Noted, not changed: hi/as drafts put the local-language narrative inside an otherwise English letter; a malformed baseline JSON file returns 500.
