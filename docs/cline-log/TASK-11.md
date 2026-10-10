# TASK-11 log — Live analysis timeline, Policy X-ray and clocks

Branch: `task-11-live-timeline` · Owner: Sumedha

## What was built
- `components/LiveTimeline.tsx`: opens an `EventSource` on the agent's `/analyses/:id/events`, renders steps in `seq` order with framer-motion, shows tool names and "quote verified ✓", a done state and an error state. It closes the stream on `done`, on `error` and on unmount, and drops any event with `seq <=` the last one seen (the browser reconnects after the agent ends the response and the server replays the backlog). When the page was rendered mid-run it calls `router.refresh()` once on `done` so the verdict board appears.
- `components/TatClocks.tsx`: display only. Elapsed, limit, breach and over-by all come from `POST /calc/tat`; the component only formats them ("5h 30m (limit 3h)") and cites the rule id. A failed backend call shows a short friendly note instead of numbers.
- `components/PolicyXray.tsx`: room-rent cap and cover start from the case schedule; one "Regulation overrides this" card per verdict override, e.g. "Policy: 8 years → Law: 60 months (MC24 para 13)".
- `app/case/[id]/page.tsx`: tabs Analysis · X-ray · Clocks as links that keep `?analysis=<id>`. With no id it starts one analysis and redirects; with an id it reuses it and never calls `startAnalysis`. An unknown id (agent restarted) or an id of another case shows a "Run a new analysis" link instead of silently spending credits.
- `app/page.tsx`: `prefetch={false}` on the case-card links so Next never pre-renders `/case/[id]` and starts a run in the background.
- `lib/api.ts`: `AgentEvent`, `Rule`, `TatRequest`, `TatResult`, `getRule`, `calcTat`, `agentEventsUrl`.

## Tests (written first, seen failing, then passing)
- `LiveTimeline.test.tsx` (16), `TatClocks.test.tsx` (7), `PolicyXray.test.tsx` (5), `CasePage.test.tsx` (10), plus the 14 from TASK-10: frontend 52/52.
- Acceptance 1, 1b (close on done, close on error, close on unmount, no duplicates after a replay), 2 and 3 are each covered. `CasePage.test.tsx` asserts `startAnalysis` is not called when `?analysis=` is present, including across tab switches.
- `agent/test/server.test.ts`: two new tests for the SSE CORS header. Agent suite passes.
- `tsc --noEmit`, `next lint` and `next build` (no services running) are clean.

## Live check (real backend :8000, agent :8100, headless Chrome)
- Case D, Clocks tab: "5h 30m (limit 3h)" with "Breach of MC24-16a: 2h 30m over", and "2h 15m (limit 1h)" with "Breach of MC24-15b: 1h 15m over". The discharge clock also shows "Extra hospital charges the insurer must bear: ₹3,750".
- Case A, Analysis tab: visiting `/case/case_a` redirects to `?analysis=<id>`; the timeline renders 9 events and the done label, then the board shows "₹40,719.76 of ₹98,969.76" with 4 rows. Three refreshes keep the same id and the same result, with no duplicated events and no new run started.

## Decisions and deviations
- Files outside the task list (approved): `lib/api.ts`, `tests/PolicyXray.test.tsx`, `tests/CasePage.test.tsx`.
- **Agent fix outside the task list (approved):** `agent/src/server.ts` writes the SSE headers directly after `reply.hijack()`, which skips `@fastify/cors`, so a browser `EventSource` was blocked ("connection lost"). The SSE `writeHead` now sets `access-control-allow-origin` when the request origin equals the configured frontend origin; any other origin gets no header. Tested in `agent/test/server.test.ts`.
- `LiveTimeline` keeps `refreshOnDone` and `router.refresh` in refs, not effect dependencies, so a re-render after `router.refresh()` cannot close and reopen the stream and replay it.
- Tabs are plain links, not the shadcn Tabs component, to avoid a new dependency and keep the analysis id in the URL.
- `/calc/tat` limits come from `GET /rules/MC24-15b` and `MC24-16a` (`limit_minutes`), not from numbers in the frontend.

## Open issues
- The scripted agent sends no `regulation_override`, no tool events and no verified results, so the live X-ray override card and the "quote verified ✓" chip only appear once TASK-08 lands. Both are covered by tests with fixtures. The event field names (`data.tool`, `data.verified`) are read defensively and need confirming in TASK-08.
- The agent's analyses are in memory, so an old `?analysis=` link stops working after an agent restart; the page says so and offers a manual re-run.
- `insurerBears` on the Clocks tab sums the recoverable amount of verdicts that cite MC24-16a; once TASK-08 sets real verdicts this should be checked against the calculator's own figure.

**Review fixes:**
- The Clocks tab showed what the insurer bears for the discharge delay only when a verdict cited MC24-16a (the three-hour limit). The rule that says the insurer bears the extra charges is MC24-16b, and case D's expected basis cites both, so a correct citation of 16b alone hid the amount. It now accepts either; new test.
- Review checks that held: analysis reuse via `?analysis=` (refreshes and tab switches never start a new run; a missing or other-case analysis offers a manual re-run); the timeline drops replayed events and closes the stream on done, error and unmount; clock limits come from the rule base (MC24-15b 60 min, MC24-16a 180 min) and elapsed times from `/calc/tat`; X-ray overrides come from the verdicts; the agent's SSE CORS header is set only for the configured frontend origin. 53 frontend tests, `tsc`, `next lint` and `next build` pass. The one agent test failure on this branch is the folder-name test already fixed on `main`.
