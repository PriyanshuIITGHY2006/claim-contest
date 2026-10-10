# TASK-10 log — Frontend shell, start screen and verdict board

Branch: `task-10-frontend-shell` · Owner: Sumedha

## What was built
- `frontend/` scaffolded non-interactively: `create-next-app@14` (TS, Tailwind v3, App Router, ESLint, `@/*`), then `shadcn@2.3.0 init -d` and `add card badge button table sheet separator skeleton -y`.
- `lib/format.ts` (`formatINR`, Indian grouping, paise only when present), `lib/api.ts` (types mirroring systemPatterns; `listCases`/`getCase` on the backend, `startAnalysis`/`getAnalysis` on the agent; 10 s timeout; `ApiError` names the failing service).
- `app/page.tsx`: hero and five case cards. `app/case/[id]/page.tsx`: starts the scripted analysis, polls `GET /analyses/:id`, renders the board. Both pages use `export const dynamic = "force-dynamic"` and `cache: "no-store"`, so `npm run build` works with no services running.
- `components/`: `VerdictBoard`, `SummaryCard`, `StatusChip`, `EvidencePanel` (citations in both states, bill lines, calculation steps, regulation-override badge, precedents placeholder).
- Look follows ARCHITECTURE section 5: light theme, Inter, slate neutrals, emerald/amber/sky/rose, tabular numerals.

## Tests (written first, seen failing, then passing)
- `tests/format.test.ts` (6): acceptance test 1 plus zero, crore, negative and float noise.
- `tests/VerdictBoard.test.tsx` (7): acceptance tests 2-5. Test 4 uses a `verified: true` citation with a real quote; test 5 uses `verified: false` with an empty quote and asserts the source id and "Not yet verified" are shown with no tick and no quote element.
- Result: 13/13 pass; `tsc --noEmit`, `next lint` and `next build` (backend and agent stopped) are clean.
- Live check against the real backend (:8000) and agent (:8100): case A shows ₹40,719.76 of ₹98,969.76 (4 rows), case B ₹1,10,000 of ₹1,10,000 (1 row), case C ₹0 of ₹80,700 (1 row).

## Decisions and deviations
- Files outside the task list (needed by the scaffold or the agreed plan): `components.json`, `lib/utils.ts`, `components/ui/*`, `vitest.config.ts`, `tests/setup.ts`, `next.config.mjs`, Next/Tailwind config files.
- Vitest uses `esbuild { jsx: "automatic" }`; `@vitejs/plugin-react` was not needed.
- `next.config.mjs` loads the repo-root `.env` with `@next/env` using `forceReload`; without it `NEXT_PUBLIC_*` were empty.
- Status uses polling, not SSE; the event stream belongs to TASK-11.
- Next memoises same-URL GETs within a render, which froze the poll on "running"; each request carries an `AbortSignal.timeout`, which also bounds hangs.
- shadcn is the Tailwind v3 build (2.3.0); its CSS variables were rewritten to HSL slate/emerald values.
- Pinned `vitest@3.2.4` to match `agent/`.

## Open issues (for TASK-08)
- `Citation` has no page field, so the chip says "Verified against source" without a page.
- `Verdict` has no precedents field, so the panel shows "No similar cases attached yet".
- Scripted citations are `{ quote: "", verified: false }`, so the live app shows the "Not yet verified" state until TASK-08.

## Review fixes
- The summary now sums `recoverable_amount` over the verdict rows (in paise) instead of showing the agent's `total_recoverable`, so the headline always matches the rows; new test with a deliberately wrong `total_recoverable`.
- Review checks that held: 14/14 vitest, `tsc --noEmit` clean, `next lint` clean, `next build` succeeds; ₹ formatting with Indian grouping; unverified citations show the source id and "Not yet verified" with no empty quote; extra packages are the shadcn/ui component dependencies.
- Follow-ups recorded in the task specs: the case page starts a new analysis on every load (each refresh re-runs the agent and spends model credits in `llm` mode) — TASK-11 reuses an analysis via `?analysis=<id>`; once TASK-08 lands, each citation shows the full rule or clause text next to the quote (TASK-12).
