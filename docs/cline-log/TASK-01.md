# TASK-01 — Backend skeleton and sample cases

Branch: `task-01-backend-skeleton` · Owner: PriyanshuIITGHY2006

**Built:** FastAPI backend skeleton in `backend/` — settings (env-driven `DATA_DIR` → repo `/data`, CORS for `localhost:3000`), all Data-model pydantic schemas, and read-only sample-case endpoints `GET /health`, `GET /cases`, `GET /cases/{case_id}` (404 on unknown).

**Cline usage:**
- **Plan/Act:** Started in Plan mode to load context (task file, memory-bank, `systemPatterns.md` Data model, the five `data/cases/*.json`) and align on the file-creation approach — including the need for subpackage `__init__.py` files and a tests-first order — then switched to Act mode to implement.
- **Model:** Act mode on `cline-pass/qwen3.8-max` (ClinePass).
- **Workflows:** `/start-task.md` (claim, branch, load memory bank, plan first) and `/finish-task.md` (tests, scope check, progress notes, this log, commit). Team workflow per `AGENTS.md` — claimed the task on `tasks/BOARD.md` (committed/pushed to `main`), one branch per task, wrote acceptance tests before implementation, appended to memory-bank, and reconciled `main` with a concurrent TASK-06 claim via `git pull --rebase`.
- **Built-in tools/commands:** `read_files` (context gathering), `run_commands` (git branch/commit/push/rebase, `python -m venv` + `pip install`, `pytest`), `editor` (create backend files + memory-bank appends), `ask_question` (checkpoint count).
- **MCP tools:** none used for this task.

**Tests:** `backend/tests/test_cases.py` — 4 acceptance tests, all passing (`4 passed`):
1. `GET /health` → 200 `{"status":"ok"}`.
2. `GET /cases` → 5 items with ids `case_a`…`case_e`.
3. `GET /cases/case_a` validates as `Case`; stored `bill.total` == Σ line amounts and stored `settlement.total_deducted` == Σ deductions == `98969.76` (compared, not recomputed in app code).
4. `GET /cases/nope` → 404.

**Checkpoint restores:** 0

**Review fixes:** none to the code. Review checks: tests from backend/ and repo root, all five cases load and validate, unknown and path-traversal ids return 404, CORS allows `localhost:3000`, only listed files changed, clean merge into `main`.

**Plan correction (before implementation):** the first plan computed `bill.total` and `settlement.total_deducted` in code; corrected to load them as stored in the JSON so the acceptance test actually checks the data.
