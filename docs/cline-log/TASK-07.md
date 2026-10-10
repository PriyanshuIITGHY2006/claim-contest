# TASK-07 log — Agent tools on the Cline SDK

Branch: `task-07-agent-tools` · Owner: github-kaustavbhowal21

## Built
- `agent/src/backend.ts`: typed fetch client for every backend endpoint. Every call uses `AbortSignal.timeout(30_000)`; timeouts, network failures and non-2xx responses throw `BackendError` naming method + path, with FastAPI's `detail` (string or 422 issue list) in the message.
- `agent/src/llm/tools.ts`: `createTools(client)` → `{ ALL_TOOLS, AVAILABLE_TOOLS }` (12 / 10 `createTool` tools); exported constants `ALL_TOOL_NAMES`, `AVAILABLE_TOOL_NAMES`. zod input schemas (reusing `billLineSchema`), validated inside `execute` before any fetch. Descriptions say when to use each tool and that amounts come only from calc tools. `agent/src/llm/policies.ts`: `toolPolicies`, every tool `{ autoApprove: true }`.

## Cline usage
- Plan mode: read board, TASK-07/08 specs, `docs/CLINE_SDK.md`, agent package and backend routes; fetched docs.cline.bot/sdk/tools; agreed the plan (factory instead of module-level tool arrays). Act mode: claim, branch, TDD, finish.
- Workflows: `/start-task.md`, `/finish-task.md`.
- Built-in commands / MCP tools: none; standard read, search, web fetch, shell (git / npm / vitest / tsc) and editor tools.
- Checked SDK runtime behaviour with a throwaway Node script: `createTool` passes input to `execute` unvalidated, and converts the zod schema to JSON Schema — hence the in-tool `safeParse`.

## Tests
- `agent/test/tools.test.ts`: 27 tests (mocked `fetch`): method/path/body for all 12 tools, URL encoding, trailing-slash base URL, policies cover every tool, invalid input → no fetch, 500 with path, 422 and 404 with backend `detail`, tool lists, 30 s timeout signal, timeout and network errors name method + path.
- After the zod bump and before new code: existing 21 tests and `tsc --noEmit` passed with no changes to TASK-06 files.
- Result: `npm test` → 48 passed (21 existing + 27 new); `npm run typecheck` exit 0.
- Manual smoke test against the running backend (temp script, not committed): case A `calc_proportionate` with D3 → `recoverable_amount` 40719.76; `verify_quote` MC24-13 exact; a 422 from `calc_tat` and a 404 from `get_rule` surface the backend detail.

## Notes
- `agent/package-lock.json` changed substantially from `npm install` (adds `@cline/sdk` 0.0.92 and its dependency tree, zod 4.6.5). Expected.
- `npm ls zod`: one zod 4.6.5 shared by the agent and `@cline/shared`; `dify-ai-provider` (transitive via `@cline/llms`) keeps a private zod 3.25.76 that our tool schemas never touch.
- npm blocked install scripts for esbuild/protobufjs (`allowScripts`); tests, typecheck and tsx run fine without them.

## Checkpoint restores
- 0

**Review fixes:**
- `get_case` returned the whole case file including `expected` (the answer key: e.g. D3 contestable, 40,719.76), so the agent would have copied the correct verdicts and the evaluation harness (TASK-15) would measure nothing. `get_case` now strips `expected` (`withoutAnswerKey`); new test.
- `agent/test/scripted.test.ts` (TASK-06) asserted the repo folder name contains "cline-hackathon", so it failed on any other checkout path; it now checks `DATA_DIR` equals the resolved default and that `data/cases/case_a.json` exists there.
- Review checks that held: a single `zod@4.6.5` copy is shared by the SDK and the agent; `createTool` turns each zod schema into a clean JSON tool schema; every tool validates input before any fetch; backend 422 details reach the agent; `AVAILABLE_TOOLS` excludes the two TASK-13 tools; every tool has an explicit policy; only `src/llm/` imports `@cline/sdk`. 49 agent tests pass; `tsc --noEmit` clean.
