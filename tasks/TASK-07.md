# TASK-07: Agent tools on the Cline SDK

## Goal
One `createTool` per backend capability, with zod input schemas and explicit tool policies, unit-tested without calling a model.

## Files to touch
- `agent/src/backend.ts` (create): typed fetch client for every backend endpoint
- `agent/src/llm/tools.ts` (create): `get_case`, `search_policy`, `search_rules`, `get_rule`, `verify_quote`, `calc_proportionate`, `calc_waiting_period`, `calc_tat`, `calc_deadlines`, `classify_npi`, `check_bill`, `find_precedents`
- `agent/src/llm/policies.ts` (create): `toolPolicies` with every tool listed (`autoApprove: true`)
- `agent/test/tools.test.ts` (create)
- `agent/package.json` (modify: add `@cline/sdk` pinned to `0.0.92`; change `zod` from `4.1.11` to `4.6.5`, because the SDK requires `zod ^4.3.6` and two zod copies break tool schemas)
- `agent/tsconfig.json` (modify only if needed: `skipLibCheck: true`, see Notes)

## Interface
Each tool's `execute` calls `backend.ts` and returns the JSON result; tool descriptions say when to use the tool and that amounts must come from calc tools.

| Tool | Backend call |
|---|---|
| `get_case` | GET `/cases/{case_id}` |
| `search_policy` | POST `/policy/search` `{doc_id, query, k}` |
| `search_rules` | POST `/rules/search` `{query, k}` |
| `get_rule` | GET `/rules/{rule_id}` |
| `verify_quote` | POST `/verify-quote` `{source_type, source_id, quote}` |
| `calc_proportionate` | POST `/calc/proportionate` `{eligible_room_rent, actual_room_rent, days, lines, exempt_categories?, deduction?: {amount, line_ids}}` — description: pass the insurer's deduction and use the returned `recoverable_amount`; only for proportionate (room-rent) cuts |
| `calc_waiting_period` | POST `/calc/waiting-period` |
| `calc_tat` | POST `/calc/tat` |
| `calc_deadlines` | POST `/calc/deadlines` |
| `find_precedents` | POST `/precedents/search` `{query, k}` |
| `classify_npi` | POST `/classify/npi` (TASK-13, not merged yet) |
| `check_bill` | POST `/calc/bill-check` (TASK-13, not merged yet) |

Export `ALL_TOOLS` (all twelve) and `AVAILABLE_TOOLS` (all except `classify_npi` and `check_bill` until TASK-13 is merged). TASK-08 registers `AVAILABLE_TOOLS`.

## Acceptance tests (mock `fetch`)
1. Each tool's `execute` sends the right method, path and body to the backend.
2. `toolPolicies` has an entry for every tool name exported.
3. Invalid input (e.g. missing `quote`) fails zod validation before any fetch.
4. Backend error (500) surfaces as a thrown error with the path in the message.
5. A backend 422 (e.g. mixed time zones in `calc_tat`) surfaces as a thrown error that includes the backend's `detail`, so the agent can correct its input.
6. `AVAILABLE_TOOLS` excludes `classify_npi` and `check_bill`; `ALL_TOOLS` has all twelve names.

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- Allowed dependencies: @cline/sdk (exact pin), zod
- Only `agent/src/llm/` may import `@cline/sdk`

## Notes
- See `docs/CLINE_SDK.md` (types issue in v0.0.92: annotate inputs with `z.infer`; use `skipLibCheck: true`; the SDK is ESM, which this package already is).
- The backend base URL comes from `settings.ts` (`BACKEND_URL` / existing setting), never hard-coded.
- Run `cd agent && npm test && npm run typecheck`; both must pass. Existing tests (`scripted.test.ts`, `server.test.ts`) must keep passing.
