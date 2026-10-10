# TASK-14: SQLite persistence, analyses and drafts API

## Goal
Persist analyses, verdicts, flags, drafts and ladder steps so results survive refresh and the approval gate works.

## Files to touch
- `backend/app/db.py` (create): stdlib `sqlite3`, schema creation at startup, path from settings `DATABASE_URL` (sqlite file)
- `backend/app/services/store.py`, `backend/app/routes/analyses.py` (create), register in `backend/app/main.py` (modify)
- `backend/tests/test_store.py` (create)
- `backend/app/settings.py` (modify: add `database_path`), `backend/app/models/schemas.py` (modify only if a request model is needed)
- `memory-bank/systemPatterns.md` (modify: add `GET /drafts/{id}` and the 409 rule below)

## Interface
`POST /analyses`, `GET /analyses/{id}`, `POST /drafts`, `PATCH /drafts/{id}` as in systemPatterns, plus `GET /drafts/{id}` (needed by test 2). Tables: `analyses`, `verdicts`, `flags`, `drafts` (JSON columns for citations/calculation/regulation_override). No `ladder_steps` table: nothing writes ladder steps yet (deadlines come from `/calc/deadlines` on demand).
- `POST /analyses` is idempotent: posting the same `analysis_id` again replaces that analysis and its verdicts/flags (the agent may retry), inside one transaction.
- `POST /analyses` rejects (422) an analysis whose `total_recoverable` differs from the sum of its verdicts' `recoverable_amount` by more than 0.01, and a verdict list with duplicate `deduction_id`s.
- `POST /drafts` for tier 2 or 3 returns 409 unless a tier-1 draft of the same analysis has `human_approved: true` (the approval gate is enforced in the backend, not only in the agent). Unknown `analysis_id` → 404.
- Database path: `settings.database_path`, read from `DATABASE_URL` (`sqlite:///<path>`). A relative path resolves against the repo root (like `DATA_DIR`), default `<repo>/backend/app.db` (ignored by `.gitignore`'s `*.db`). Open one connection per request (`check_same_thread=False` not needed then); enable `PRAGMA foreign_keys=ON`.

## Acceptance tests
1. Posting a case A analysis then GET returns identical verdicts and `total_recoverable` 40719.76.
2. A draft starts with `human_approved` false; PATCH sets it true and GET reflects it.
3. Unknown analysis → 404.
4. Tests use a temporary database file (pytest `tmp_path` + overriding the settings path), never `backend/app.db`.
5. Posting the same analysis twice keeps one copy (GET returns the second version; verdict count unchanged).
6. An analysis whose `total_recoverable` does not match its verdicts → 422.
7. A tier-2 draft before the tier-1 draft is approved → 409; after approval → 201/200.

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- No new dependencies (no ORM)
