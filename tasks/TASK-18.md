# TASK-18: Dashboard and demo sign-in

## Goal
Give the app a user home: a cosmetic "demo user" sign-in and a "My claims" dashboard listing sample and uploaded cases with their latest analysis result.

## Files to touch
- `backend/app/services/store.py`, `backend/app/routes/analyses.py` (modify: list endpoint below)
- `memory-bank/systemPatterns.md` (modify first: `GET /analyses`)
- `frontend/app/welcome/page.tsx`, `frontend/app/dashboard/page.tsx` (create)
- `frontend/components/DemoUser.tsx` (create: client component reading/writing the demo name in `localStorage`, key `cc_demo_user`)
- `frontend/components/AppHeader.tsx` (modify if TASK-17 created it, otherwise `frontend/app/layout.tsx`): user avatar/initials + "My claims" link when a demo user is set
- `frontend/lib/api.ts` (modify: `listAnalyses`, `getStoredAnalysis` → backend `GET /analyses/{id}`)
- `frontend/app/case/[id]/page.tsx` (modify: stored-analysis fallback below; keep the change small, TASK-12 adds tabs to this file in parallel)
- `frontend/tests/CasePage.test.tsx` (modify: fallback tests)
- `backend/tests/test_store.py` (modify: list tests), `frontend/tests/Dashboard.test.tsx` (create)

## Interface
- `GET /analyses?case_id=<optional>` → `{ analysis_id, case_id, status, total_recoverable, finished_at }[]`, newest first (order by `finished_at` desc, nulls last, then `rowid` desc). Filter by `case_id` when given.
- `/welcome`: "Welcome to Claim Contest" card, a name field pre-filled "Priya", button "Continue as demo user" → saves the name and goes to `/dashboard`. Small print: "Demo mode — no account is created and nothing leaves this browser."
- `/dashboard`: greeting "Hi, <name>", a primary button "Check a new claim" (→ `/upload`), and a list of cases from `GET /cases`, each card showing title, policy, deducted amount, and — from `GET /analyses?case_id=` — the latest status chip (Analysed / Not analysed yet) and recoverable amount, linking to `/case/<id>?analysis=<latest analysis_id>` when one exists (so it reuses the stored result instead of re-running the agent) or `/case/<id>` otherwise. Uploaded cases (`user_` prefix) get an "Uploaded" badge.
- If no demo user is set, `/dashboard` still works and shows "Hi there".
- **Stored-analysis fallback (case page):** the agent keeps analyses in memory, so after an agent restart `/case/<id>?analysis=<id>` from the dashboard would show "Run a new analysis". When the agent returns 404 for `?analysis=<id>`, load it from the backend (`GET /analyses/{id}`, saved by the live agent). If found and its `case_id` matches, render the verdict board, X-ray and clocks from it with no live timeline (show a small note "Saved result"). Only if the backend also returns 404 keep the existing "Run a new analysis" notice. Never start a new analysis automatically.
- Styling follows TASK-17 (teal theme, `rounded-2xl` cards, Plus Jakarta Sans headings, `Reveal` for fade-in, lucide icons, works at 375 px).

## Acceptance tests
1. Backend: after posting two analyses for case A and one for case B, `GET /analyses` returns three newest first and `GET /analyses?case_id=case_a` returns two.
2. Frontend: Dashboard renders one card per case, an "Analysed" chip with the recoverable amount for a case with an analysis, "Not analysed yet" for one without, and a link containing `?analysis=` for the analysed case (mock `api`).
3. Frontend: `DemoUser` saves the name to `localStorage` and the dashboard greets by name.
4. Frontend: case page with `?analysis=<id>`, agent `getAnalysis` rejects with 404 and backend `getStoredAnalysis` returns a done analysis of the same case → verdict board rendered, no `LiveTimeline`, `startAnalysis` not called; both 404 → the existing re-run notice.
5. Backend: `GET /analyses` with no stored analyses returns `[]`; an unknown `case_id` filter returns `[]`.

## Do not
- add real authentication, passwords or sessions
- touch files not listed above
- add dependencies
