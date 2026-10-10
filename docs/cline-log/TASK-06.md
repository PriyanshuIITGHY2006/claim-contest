# TASK-06 log — Agent service skeleton with streaming

Branch: `task-06-agent-skeleton` · Owner: Sumedha

## What was built
Node 22 + TypeScript (strict, ESM) Fastify service on port 8100 with a scripted, non-LLM runner,
so the frontend (TASK-10/11) can integrate before the real agent (TASK-07/08) lands.

- `agent/src/types.ts` — zod schemas mirroring the Data model in `memory-bank/systemPatterns.md`
  (`Citation`, `Verdict`, `Flag`, `Analysis`, `AgentEvent`) plus the subset of `Case` the agent reads.
- `agent/src/settings.ts` — one settings module, validated once at startup. `PORT` defaults to 8100,
  `AGENT_MODE` to `scripted`, `BACKEND_URL` required; `LLM_PROVIDER`/`LLM_MODEL`/`LLM_API_KEY` are
  required only when `AGENT_MODE=llm`. `DATA_DIR` resolves relative to the agent folder
  (`import.meta.url` → `../../data`), not the process cwd.
- `agent/src/store.ts` — in-memory analyses + per-analysis event log; `append` stamps a strictly
  increasing `seq`; `subscribe` replays the backlog then streams live events.
- `agent/src/scripted.ts` — case loader + pure `buildScriptedOutcome` + `runScripted` emitter.
- `agent/src/server.ts` — `/health`, `POST /analyses`, `GET /analyses/:id/events` (SSE),
  `GET /analyses/:id`; CORS for `http://localhost:3000`.

## Decisions (agreed before coding)
- Scripted mode reads `data/cases/<id>.json` directly instead of calling the backend, because
  TASK-01 does not exist yet. The loader is injectable, so TASK-08 can swap it for backend calls.
- A `verdict` event is emitted only for `expected` entries whose `deduction_id` is in
  `settlement.deductions`. Other entries become `Analysis.flags`: `LETTER` → `letter_not_specific`,
  `TAT_CASHLESS`/`TAT_DISCHARGE` → `tat_breach`, each also emitting a `step` event.
  Case A therefore gives 4 verdicts (D1–D4) + 1 flag.
- `total_recoverable` = sum of verdict `recoverable_amount`, rounded to 2dp (case A → 40719.76).
- Scripted citations are one per `basis` entry: `policy:<anchor>` → `{source_type:"policy",
  source_id:"<anchor>"}`, otherwise `{source_type:"rule", source_id:<id>}`, with `quote:""` and
  `verified:false`. `reasoning` = the case's `note`, `confidence` = 0.9.
- `server.waitFor(id)` was added for tests (declared via `declare module "fastify"` augmentation).
  It is not part of the HTTP interface in systemPatterns.
- A run failure emits an `error` event, sets `status: "error"` and closes the SSE stream, so
  TASK-08's backend/LLM failures surface to the frontend instead of hanging.

## Known limitations (for TASK-07/08)
- Scripted citations are unverified placeholders: `basis` holds anchors/rule ids, not verbatim text.
  Real quotes must come from the backend's `POST /verify-quote` before a verdict is accepted
  (the citation gate in systemPatterns). No `calculation` or `regulation_override` is emitted yet.
- The store is in-memory only; nothing is posted to the backend's `POST /analyses` yet.
- `AGENT_MODE=llm` is validated but not implemented; `@cline/sdk` is deliberately not a dependency
  here (TASK-06 forbids it).

## Tests
`cd agent && npx vitest run` → 20 passed (2 files). `npx tsc --noEmit` → clean.
Acceptance tests 1–4 plus a failure-path test are in `agent/test/server.test.ts`; settings, loader,
outcome and store units are in `agent/test/scripted.test.ts`. Also smoke-tested over real HTTP (not
just `inject`), including a client that connects only after the run finished: the SSE stream replayed
the backlog and closed itself after `done`/`error`.

The failure-path test caught a real bug: `close()` ran during `store.subscribe`'s synchronous backlog
replay, before the `const unsubscribe` binding was initialised, so it threw a TDZ `ReferenceError`
that skipped `reply.raw.end()` and left late-connecting SSE clients hanging forever. `unsubscribe` is
now a `let` declared before `close`.

## Review fixes
- `settings.ts`: blank `LLM_*=` values (as shipped in `.env.example`) are treated as unset; previously scripted mode failed to start with the template `.env`. Test added.
- `package.json`: `dev` and `start` load `../.env` via `--env-file-if-exists`; previously `npm run dev` failed with "missing: BACKEND_URL".
- Tests: replaced vendor and model names in settings fixtures with neutral placeholders.
- Verified manually: `npm start`, `GET /health`, case D streamed 8 events over SSE, `GET /analyses/:id` returned `done`.
