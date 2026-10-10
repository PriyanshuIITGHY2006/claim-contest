# TASK-16 — Upload your own claim: PDF upload, pre-fill, confirm, analyse

Branch: `task-16-upload-claim` · Owner: PriyanshuIITGHY2006

**Built:** A user uploads a settlement letter and hospital bill (text PDFs), picks a policy, checks the pre-filled details in a form and gets a case the existing analysis runs on. No model calls anywhere in the backend; nothing is analysed until the user confirms. New dependency: `python-multipart` (allowed by the task).
- `app/services/ingest.py`: PDFs are read from memory (never stored). Text is rebuilt from PyMuPDF word boxes grouped into visual rows, so a table row keeps its amount on the same line. Pre-fill rules: amounts need `Rs`/`₹`/`INR`, a thousands separator or paise (Indian grouping works; bare numbers such as bed or page numbers are ignored), total lines are skipped, category guessed from keywords, deductions are letter lines with "deduct"/"disallow"/"not payable" and an amount, claimed/approved read from the letter. Every gap goes into `warnings`.
- Bill-line dates (as agreed): a date on the line, else the admission date found in the letter or bill, else the nearest earlier date in the bill, only then today. The warning "Check the bill line dates" is always added when there are bill lines, and the form lets the user edit every date.
- `app/routes/upload.py`: `POST /cases/upload` (multipart `settlement_pdf`, `bill_pdf`, form `doc_id`) and `POST /cases`. Each file is read with a 10 MB cap and must start with `%PDF`; non-PDF, oversize, unreadable, no-text-layer ("Scanned documents are not supported yet; please upload a text PDF") and unknown or non-policy `doc_id` are all 422 with a clear message.
- `NewCase` validation (`schemas.py`, 422): at least one bill line and one deduction, unique line ids, a deduction naming an unknown line, `approved > claimed`, and a deduction amount above the bill total (compared in paise). `CaseDraft` and `NewCase` added.
- `app/services/cases.py` / `app/db.py`: new `cases` table (`case_id`, `data`, `created_at`). `create_case` builds a full `Case` (`user_` + 8 hex, title from the first deduction label, `synthetic_notice` "Uploaded by the user", `expected: []`, totals as sums in paise, policy file/product from the document registry). `GET /cases` returns the five samples then uploaded cases newest first. A `user_` id is only looked up in SQLite, after a `user_[0-9a-f]{8}` check, and never becomes a file path; unknown -> 404.
- Frontend: `/upload` page (server component loads policies), `UploadZone` (two drop zones with client-side PDF and 10 MB checks, policy select, "Read my documents" spinner), `CaseConfirmForm` (warnings on top, editable patient/policy details, bill lines with date/category/rate/units/amount, deductions with line links, live totals, "Analyse my claim" disabled until totals are consistent, privacy note), `lib/api.ts` (`uploadDocuments`, `createCase`, `listDocuments`, `ApiError.detail` so server messages such as the scanned-document one reach the user; existing behaviour unchanged), "Check your own claim" link on the start page.
- `memory-bank/systemPatterns.md` was updated first (the stale stretch row replaced by `POST /cases/upload` and `POST /cases`, the `/cases` ordering and the user-id rule).

**Extra file (agreed in the plan):** `backend/tests/conftest.py`, an autouse fixture that points `settings.database_url` at a temporary file for every test. It was needed because `/cases` now reads SQLite, so `test_cases.py` would otherwise read or create `backend/app.db`. The `_tmp_db` fixture in `test_store.py` is left in place.

**Cline usage:**
- **Plan/Act:** Plan mode first: claimed the task, read the memory bank, `TASK-16.md`, the case and document services, `db.py` and the frontend API client, and proposed a plan with the assumptions and risks. The user approved it and decided the open points: add the `conftest.py`, do a minimal landing-page insertion now, date fallback order, extra 422 rules, upload limits and the SQLite-only lookup for `user_` ids. Act mode then implemented tests-first.
- **Workflows:** `/start-task.md` (claim committed and pushed to `main`, branch `task-16-upload-claim`, plan-first) and `/finish-task.md`.
- **Built-in tools/commands:** `read_files`, `search_codebase`, `editor` (large files written in chunks), `run_commands` (git, pip, pytest, vitest, `tsc`, `next lint`, a throwaway end-to-end script).
- **MCP tools:** none used.

**Tests:**
- `backend/tests/test_upload.py` — 50 tests, written first (red: `ImportError` on `CaseDraft`), then green. Acceptance 1–5 (PDFs generated in the test with PyMuPDF; three bill lines with amounts; blank page -> scanned message; unknown or non-policy `doc_id` -> 422; `POST /cases` -> `user_` id, `bill.total` = sum, listed after the five samples; unknown line id -> 422) plus approved > claimed, a deduction above the bill total, non-PDF, oversize and broken PDFs, nothing stored by `/cases/upload`, amount/date/category rules, newest-first order and the no-file-path guarantee for `user_` ids.
- `frontend/tests/CaseConfirmForm.test.tsx` — 8 tests, written first (red: module not found), then green. Acceptance 6 (Analyse disabled with no bill lines, enabled after adding one; totals recompute on edit) plus zero, over-bill and removed deductions, approved > claimed, warnings, editable dates and the submitted payload.
- Final runs: `cd backend && pytest -q` → `147 passed`; `cd frontend && npx vitest run` → `74 passed` (after rebasing onto TASK-17); `npx tsc --noEmit` clean; `next lint` clean.
- Sanity run with a table-style PDF (each cell its own text box): five bill lines, the right categories, both deductions and claimed/approved were read correctly.

**Checkpoint restores:** 0

**Review fixes:**
- `POST /cases` accepted two deductions with the same id (201); verdicts are keyed by deduction id, so saving the analysis would fail later. `NewCase` now rejects duplicate deduction ids (422); new test.
- The landing page listed uploaded `user_` cases under "Sample cases" (it shows everything from `GET /cases`). It now shows samples only; new `tests/StartPage.test.tsx`.
- Bill-line category guess: "Guide wire and balloon catheter" was `non_medical`; consumables now also match catheter, guide wire, syringe, gloves and cannula; new parametrised cases.
- Rebased on `main` (TASK-09, TASK-17): the "Check your own claim" button sits next to "Try a sample case" in the new hero.
- Review checks that held: case A rebuilt as two text PDFs pre-fills 15/15 bill lines with the right amounts and dates (14/15 categories before the fix, 15/15 after), claimed, approved and all four deductions; non-PDF, regulation `doc_id` and malformed `user_` ids are refused; uploaded cases list after the samples. Live: a confirmed upload of case A analysed by the real agent gave D3 contestable 40,719.76, D1/D2/D4 valid and the vague-letter flag, matching the sample's answer key. 150 backend and 75 frontend tests pass; `tsc` and lint clean.
- Note: a deduction label keeps the trigger word from the letter (e.g. "Room rent beyond eligibility - deducted"); the user can edit it in the form.

**Assumptions / limitations:**
- Pre-fill is regex only: `rate = amount` and `units = 1`, deductions start unlinked to bill lines, and the patient, hospital, admission dates, sum insured and policy start date are typed by the user. Editing an amount on a one-unit line moves its rate with it so the agent's bill check does not report a false line-math error.
- Amounts without `Rs`/`₹`/`INR`, a thousands separator or paise are not recognised, to avoid reading bed or page numbers as money; such lines show up as missing and the user adds them.
- Text PDFs only; scanned documents are rejected. Hindi or multi-column letters may read poorly.
- Uploaded cases have no answer key, so the scripted agent returns no verdicts for them; they need `AGENT_MODE=llm`. The "Real analysis requires the live agent" note on the case page was skipped (the case page is not in this task's file list).
- The first upload call also warms the policy registry (a few seconds); the client allows 60 s for it.
- `frontend/app/page.tsx` was first edited minimally (one self-contained link block) because TASK-17 was rewriting it. TASK-17 merged before this branch, so the rebase conflicted there; resolved by keeping the TASK-17 page and re-applying the link as an outline "Check your own claim" button next to "Try a sample case" in the hero (the `Upload` icon import is the only other change).
