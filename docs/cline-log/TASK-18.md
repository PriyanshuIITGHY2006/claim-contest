# TASK-18 — Dashboard and demo sign-in

Branch: `task-18-dashboard-demo-signin` · Owner: PriyanshuIITGHY2006

**Built:** A user home: a cosmetic "demo user" sign-in and a "My claims" dashboard of sample and uploaded cases with their latest analysis result. No real authentication, passwords or sessions, and no new dependencies.
- `GET /analyses?case_id=<optional>` (`store.list_analyses`, `routes/analyses.py`): `AnalysisSummary { analysis_id, case_id, status, total_recoverable, finished_at }` rows without verdicts, newest first (`finished_at` descending, unfinished last, then newest insertion). Sorting uses `julianday`, so timestamps with different UTC offsets compare by instant. Unknown `case_id` or no data gives `[]`. `GET /analyses/{id}` is unchanged.
- `/welcome` and `DemoUser.tsx`: "Welcome to Claim Contest" card, name field pre-filled "Priya", "Continue as demo user" saves the trimmed name to `localStorage` key `cc_demo_user` and goes to `/dashboard`; an empty name is refused; small print "Demo mode — no account is created and nothing leaves this browser." `DemoUser.tsx` also holds the `useDemoUser` hook (read after mount, follows other tabs via the `storage` event), `DemoGreeting`, `initialsOf` and the header `DemoUserMenu`.
- `AppHeader.tsx`: no demo user -> small "Demo sign-in" link to `/welcome`; demo user set -> initials avatar, "My claims" (`/dashboard`) and a "Switch user" action that clears `cc_demo_user` and goes to `/welcome`.
- `/dashboard`: greeting "Hi, <name>" ("Hi there" without one), primary "Check a new claim" button (`/upload`), and a card per case from `GET /cases`: title, policy, deducted amount, an Analysed / Not analysed yet chip, the recoverable amount, an "Uploaded" badge for `user_` ids. Only a `done` analysis counts as Analysed; the card links to `/case/<id>?analysis=<newest done analysis>`, otherwise to `/case/<id>`. If one case's analyses call fails its card stays, as "Not analysed yet"; a case that cannot be read drops only its own card; if `GET /cases` fails the same rose error card as the start page is shown.
- Case page (`app/case/[id]/page.tsx`, kept small): when the agent answers 404 for `?analysis=<id>`, the analysis is loaded from the backend (`getStoredAnalysis`). If its `case_id` matches, the page renders from it with a "Saved result · finished <date>" note where the live timeline was; the X-ray and Clocks tabs work from it. If the backend also has nothing (or another case's analysis), the existing "Run a new analysis" notice stays. Other agent failures do not fall back, and no analysis is ever started automatically.
- `memory-bank/systemPatterns.md` was updated first (`GET /analyses`).

**Extra file (agreed in the plan):** `backend/app/models/schemas.py` gained `AnalysisSummary` (backend rule: data shapes live in `app/models`); it is not in the task's file list.

**Cline usage:**
- **Plan/Act:** Plan mode first: claimed the task, read the memory bank, `TASK-18.md`, the store and analyses route, the case page and its tests, the header and layout, and proposed a plan with the risks. The user approved it and decided "latest" (first row of the newest-first list), that only `done` counts as Analysed, that the start-a-run path is unchanged, where `AnalysisSummary` lives, plus the header, dashboard-failure and saved-result additions. Act mode then implemented tests-first.
- **Workflows:** `/start-task.md` (claim committed and pushed to `main`, branch `task-18-dashboard-demo-signin`, plan-first) and `/finish-task.md`.
- **Built-in tools/commands:** `read_files`, `editor` (large files written in chunks), `run_commands` (git, pytest, vitest, `tsc`, `next lint`).
- **MCP tools:** none used.

**Tests:**
- `backend/tests/test_store.py` — 6 new tests, written first (red: 5 failed with 405 Method Not Allowed), then green: acceptance 1 and 5, summary fields only, unfinished runs last, ties by insertion order, `GET /analyses/{id}` not shadowed.
- `frontend/tests/Dashboard.test.tsx` — 9 tests (acceptance 2 plus: the newest done analysis wins and running or error runs do not count as Analysed, the Uploaded badge, the upload button, a failed analyses call, a failed case read, the rose error card, the empty state).
- `frontend/tests/DemoUser.test.tsx` — 10 tests (acceptance 3 plus: welcome defaults, empty name refused, "Hi there", header states, Switch user, another-tab sign-in, initials).
- `frontend/tests/CasePage.test.tsx` — 9 new fallback tests (acceptance 4 plus: the note with and without a date, tab links, a tab switch in saved mode across Analysis/X-ray/Clocks, both 404, another case's analysis, no fallback for non-404 errors or when the agent still has the run).
- The three frontend files were written first and failed before the implementation (module not found; saved-result elements missing).
- Final runs: `cd backend && pytest -q` → `164 passed` (after rebasing onto TASK-15); `cd frontend && npx vitest run` → `103 passed`; `npx tsc --noEmit` clean; `next lint` clean.

**Checkpoint restores:** 0

**Review fixes:**
- No code fixes. Merged with `main` after TASK-12: `frontend/app/case/[id]/page.tsx` conflicted (TASK-12 Action/Compare tabs vs the saved-result fallback); both kept, so the Action tab also works on a saved result (the agent's draft service reads analyses from the backend when they are not in memory).
- Review checks that held: `GET /analyses` orders by instant (`julianday`) with unfinished runs last and filters by case; only `done` analyses count as Analysed and the card links to the newest done one; a failed analyses lookup keeps the card; the case page falls back to the backend only on an agent 404, never starts a run, and keeps the re-run notice when both miss; the demo name lives only in `localStorage`. Backend 164, frontend 127, `tsc` clean.

**Assumptions / limitations:**
- The demo name lives in this browser's `localStorage` only; the server never sees it. The greeting reads it after mount, so the first paint says "Hi there".
- The dashboard fetches each case and its analyses one by one (the same pattern as the start page); fine for a demo, slower with many uploaded cases.
- Saved results come from the backend store, which only holds analyses the live agent posted; scripted-mode runs are not saved there, so their dashboard cards show "Not analysed yet".
- Newer Node versions define a `localStorage` global that is `undefined` without `--localstorage-file`, so `DemoUser.test.tsx` installs its own in-memory Storage with `vi.stubGlobal`.
- TASK-12 edits the same case page in parallel; the fallback is confined to one catch block, one helper and the timeline slot, to keep a merge easy.
