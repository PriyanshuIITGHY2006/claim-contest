# TASK-06: Agent service skeleton with streaming

## Goal
Node service that creates analyses, streams events over SSE and serves results, with a scripted (non-LLM) runner first so the frontend can integrate before the real agent is ready.

## Files to touch
- `agent/package.json`, `agent/tsconfig.json`, `agent/vitest.config.ts` (create)
- `agent/src/settings.ts` (create): reads and validates `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `BACKEND_URL`, `PORT` (default 8100); fails at startup if missing (LLM vars may be absent when `AGENT_MODE=scripted`)
- `agent/src/server.ts` (create): fastify, CORS for `http://localhost:3000`
- `agent/src/store.ts` (create): in-memory analyses + event log
- `agent/src/scripted.ts` (create): replays the `expected` verdicts of a case as events, for UI development
- `agent/src/types.ts` (create): zod schemas for `Analysis`, `Verdict`, `Citation`, `AgentEvent`
- `agent/test/server.test.ts` (create)

## Interface
`GET /health`, `POST /analyses`, `GET /analyses/:id/events` (SSE, `data: <AgentEvent JSON>`), `GET /analyses/:id` (see systemPatterns).

## Acceptance tests
1. `POST /analyses {case_id:"case_a"}` returns an `analysis_id`.
2. In scripted mode the event stream emits ≥ 3 `step` events, one `verdict` per expected deduction, then `done`; `seq` strictly increases.
3. `GET /analyses/:id` after `done` returns `status: "done"` and `total_recoverable` 40719.76 for case A.
4. Unknown analysis id → 404.

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- Allowed dependencies: fastify, @fastify/cors, zod, tsx, typescript, vitest, @types/node
- Do not import `@cline/sdk` in this task
