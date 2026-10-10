# TASK-08 log — Agent orchestration and citation gate

Branch: `task-08-agent-orchestration` · Owner: github-kaustavbhowal21

## Built
- `agent/src/gate.ts`: pure `acceptVerdicts(case, verdicts, verifications, calcResults)` plus `recordToolResult` (evidence from `verify_quote`, keeping `page`, and every `calc_*` call). `agent/src/runner.ts`: `mapSdkEvent`, `runAnalysis` (gate, up to 2 corrective turns, then `needs_info`; total in paise; `POST /analyses` failure is reported, not fatal). `agent/src/llm/agent.ts`: Cline SDK `Agent` session factory with `submit_verdicts` (`lifecycle.completesRun`), evidence-recording tool wrappers and explicit `toolPolicies`. `agent/src/llm/prompt.ts`: system, user and retry prompts (case id only). `agent/src/server.ts`: `AGENT_MODE=llm` uses `createLlmRunner`; `scripted` unchanged.
- Gate rules: a citation passes only if a `verify_quote` call in this analysis verified the same quote (whitespace-collapsed) for the same `source_type`/`source_id`; the model's own `verified` flag is not trusted. `regulation_override.rule_id` must be among the citations. valid / needs_info recover 0. A contestable amount must equal the `calc_proportionate` `recoverable_amount` for that deduction (same amount and line ids) when one exists; otherwise the full deduction amount or another calc result. Contestable verdicts with `confidence < 0.75` get `include_in_grievance: false`.

## Files touched outside the task list (approved in Plan mode)
- `agent/src/backend.ts`: `saveAnalysis` (`POST /analyses`).
- `agent/src/types.ts`: `include_in_grievance?: boolean` on `verdictSchema` (the store re-parses analyses, so the flag is otherwise dropped).
- `backend/app/models/schemas.py`: `include_in_grievance: bool | None = None` on `Verdict`, so `POST /analyses` accepts it. Backend pytest re-run: 75/75 before the rebase, 97/97 after.
- `memory-bank/systemPatterns.md`: `Verdict` contract gains `include_in_grievance?` (updated before the code).
- `agent/test/runner.test.ts` (new): runner, prompts, `saveAnalysis`, llm-mode server tests.
- Not changed: `agent/src/llm/tools.ts`. `get_case` already strips `expected` (TASK-07 review), so a test checks that the system, user and retry prompts never contain "expected" instead.

## Cline usage
- Plan mode: read the board, TASK-08 spec, agent/backend code from `origin/main`, SDK `.d.ts` (event, tool and run-result shapes); probed the live backend (`/cases`, `/verify-quote`, `/policy/search`); proposed plan with 4 out-of-list changes; user approved with changes. Act mode: claim, branch, tests first, implement, finish.
- Workflows: `/start-task.md`, `/finish-task.md`.
- Built-in commands / MCP tools: none; standard read, search, web fetch, shell (git / npm / vitest / tsc / pytest / uvicorn) and editor tools.
- Throwaway scripts (deleted, not committed): (1) SDK probe with a scripted `model`: confirmed `lifecycle.completesRun` ends `run()` after `submit_verdicts`, `continue()` resumes, and event names; (2) live-backend probe of `/calc/proportionate` for case A (D1 0, D2 0, D3 40719.76) and `/verify-quote` pages; (3) end-to-end run: real SDK `Agent` + real tools + live backend + scripted model. Case A: D2 submitted as contestable 44250 → gate rejected it (proportionate result 0) → corrected → total 40719.76, saved to the backend; the model's requests never contained `expected`.
- For (3), `createAgentSessionFactory` takes an optional `AgentClass` so a scripted model can be injected; production uses the SDK `Agent`.

## Tests
- `agent/test/gate.test.ts` (14): acceptance 1–7, plus: unconfirmed quote, D2 contestable at 44250 with a proportionate result present (rejected), money on valid / no citations / duplicates / unknown ids, case B full-amount override accepted, whitespace-insensitive quote match.
- `agent/test/runner.test.ts` (12, fake session): accept → stream → save; rejection fed back then corrected; `needs_info` after 2 retries; no `submit_verdicts`; agent run error; backend save failure keeps the in-memory analysis; prompts never contain "expected"; `recordToolResult` keeps `page`; paise totals; `saveAnalysis` POST; llm-mode server uses the injected runner and refuses to start without one.
- Seen failing first (missing modules), then passing. After rebasing on `origin/main` (TASK-11 and TASK-13 merged): `npm test` 77/77, `npm run typecheck` exit 0, backend `pytest -q` 97/97.

## Notes
- TASK-13 merged during this task, so `AVAILABLE_TOOLS` now has all 12 tools; the agent registers them with an explicit policy for each, plus `submit_verdicts`.
- The backend SQLite store has no `include_in_grievance` column, so the flag is kept in the agent's in-memory analysis but dropped by `GET /analyses/{id}` on the backend.
- Not yet run against a real model (needs `LLM_*` credentials).

## Checkpoint restores
- 0

**Review fixes:**
- The agent loaded cases from `data/cases/*.json` on disk, so cases uploaded by users (TASK-16, stored in the backend's SQLite) would fail with "Unknown case_id". The server now loads every case through the backend's `GET /cases/{id}` (`createBackendCaseLoader`), which serves samples and uploads; the disk loader stays for tests. New tests (found case, 404 → "Unknown case_id").
- The live timeline's "quote verified ✓" chip could never appear: a finished `verify_quote` event carried only the tool name. It now carries `verified`, `source_type` and `source_id` from the recorded evidence, with the message "Quote verified against <source>". New test.
- Review checks that held: the gate accepts a citation only when that exact quote was confirmed by `verify_quote` against the same source; contestable amounts must equal a calculator's `recoverable_amount` (authoritative when a proportionate calculation exists for that deduction) or the full deduction; valid/needs_info recover 0; a regulation override must cite its rule; duplicates and missing deductions are rejected; up to 2 corrective retries, then needs_info; accepted verdicts survive retries; the prompt carries only the case id (no answer key). 80 agent tests pass, `tsc` clean, 97 backend tests pass.
- Not verified here: a live model run (no model key on the review machine). Case B must produce a `regulation_override` (policy 8 years → law 60 months, MC24-13) for the X-ray card; check it in the first `AGENT_MODE=llm` run.
