# TASK-11: Live analysis timeline, Policy X-ray and clocks

## Goal
Make the agent's work visible and add the two supporting views.

## Files to touch
- `frontend/components/LiveTimeline.tsx` (create): subscribes to `/analyses/:id/events`, animates steps (framer-motion), shows tool names and "quote verified ✓"
- `frontend/components/PolicyXray.tsx` (create): room-rent cap, waiting periods, moratorium from the case + anchors, with "Regulation overrides this" badges
- `frontend/components/TatClocks.tsx` (create): cashless and discharge bars with limit markers and breach labels from `/calc/tat`
- `frontend/app/case/[id]/page.tsx` (modify: tabs Analysis · X-ray · Clocks)
- `frontend/tests/LiveTimeline.test.tsx`, `frontend/tests/TatClocks.test.tsx` (create)

## Acceptance tests
1. LiveTimeline renders events in `seq` order and shows a done state after the `done` event (mock EventSource).
1b. On `done` or `error`, LiveTimeline calls `close()` on the EventSource; an event whose `seq` is already rendered is ignored (no duplicates); the EventSource is closed on unmount.
2. TatClocks for case D shows "5h 30m (limit 3h)" and a breach label citing MC24-16a.
3. PolicyXray for case B shows "Policy: 8 years → Law: 60 months (MC24 para 13)".

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- No new dependencies beyond TASK-10

## Notes
- Reuse analyses: starting an analysis is done once, then the page URL carries `?analysis=<id>` and refreshes or tab switches reuse it instead of re-running the agent (each run spends model credits in `llm` mode). Add a test that rendering the page with `?analysis=` does not call `startAnalysis`.
- The agent ends the SSE response after `done` or `error`. A browser `EventSource` then reconnects on its own, and the server replays the whole backlog. So close the EventSource on `done`/`error` and drop any event with `seq <=` the last one seen. Without this, the timeline shows every step twice.
