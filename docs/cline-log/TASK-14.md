# TASK-14 — SQLite persistence, analyses and drafts API

Branch: `task-14-sqlite-persistence` · Owner: PriyanshuIITGHY2006

**Built:** Persistence for analyses, verdicts, flags and drafts in `backend/`, using stdlib `sqlite3` (no new dependencies, no ORM).
- `app/db.py`: one connection per call, `PRAGMA foreign_keys=ON`, idempotent schema creation (`analyses`, `verdicts`, `flags`, `drafts`; JSON columns for citations/calculation/regulation_override). `init_db()` runs from the FastAPI lifespan.
- `app/services/store.py`: `save_analysis` upserts the analysis and replaces its verdicts/flags in one transaction (idempotent re-post, drafts survive). `create_draft` always stores `human_approved=false` and returns 409 for tier 2/3 unless a tier-1 draft of the same analysis is approved. 404 for unknown analysis/draft.
- `app/routes/analyses.py`: `POST /analyses` (201), `GET /analyses/{id}`, `POST /drafts` (201), `GET /drafts/{id}`, `PATCH /drafts/{id}`.
- `app/settings.py`: `database_url` and `database_path` (`sqlite:///<path>`, relative paths resolve against the repo root, default `<repo>/backend/app.db`). `schemas.py`: `DraftApprovalRequest`, `AnalysisCreated`. `systemPatterns.md` updated with `GET /drafts/{id}` and the 409/422 rules.
- Two approved additions: a `position` column on verdicts and flags with `ORDER BY position` (GET returns the posted order), and the total check in paise (`abs(round(total*100) - sum(round(v*100))) > 1` → 422).

**Cline usage:**
- **Plan/Act:** Plan mode first: claimed the task, read the memory bank, `TASK-14.md`, schemas, settings, main and `case_a.json`, and proposed a plan. The user approved it with two additions (verdict `position`, paise comparison), then Act mode implemented tests-first.
- **Workflows:** `/start-task.md` (claim committed and pushed to `main`, branch `task-14-sqlite-persistence`, plan-first) and `/finish-task.md`.
- **Built-in tools/commands:** `read_files`, `editor` (large test file written in chunks), `run_commands` (git, pytest).
- **MCP tools:** none used.

**Tests:** `backend/tests/test_store.py` — 15 tests, written first and run red (all errored on missing `settings.database_url`), then green; full backend suite `74 passed`. Covers acceptance 1–7 (case A round-trip with total 40719.76, draft approval, 404s, temp DB, idempotent re-post, 422 on total mismatch, 409 gate) plus duplicate deduction ids, posted order, forced-unapproved draft, and the 1-paise / 2-paise boundary.

**Checkpoint restores:** 0

**Review fixes:**
- Posting a draft whose `draft_id` already exists crashed with a 500 (`sqlite3.IntegrityError`). It now returns 409 and keeps the original draft unchanged, including its approval; new test. A retried draft post from the agent can no longer overwrite an approved letter.
- Review checks that held: re-posting an analysis keeps drafts and replaces verdicts/flags in one transaction; verdicts and flags come back in posted order; totals are compared in paise; tier-2/3 drafts are refused (409) until a tier-1 draft is approved; tests use a temporary database. 75 backend tests pass.

**Assumptions / limitations:**
- Tests override `settings.database_url` on the singleton; the store reads `settings.database_path` on every call, so nothing is cached. `backend/app.db` is never created by the tests.
- `DATABASE_URL` must be `sqlite:///<path>`; other schemes raise `ValueError`.
- `POST /drafts` with an existing `draft_id` fails with a database integrity error (not mapped to a clean status code yet).
- Tier-2/3 gate checks any approved tier-1 draft of the analysis, regardless of language.
