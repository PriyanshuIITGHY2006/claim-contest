# Task board

Claim a task before starting: set Owner and Status, commit, push. Status: `todo` → `in-progress` → `review` → `done`.

Parallel lanes (start all four at hour 0): **A** backend 01 → 02 → 05 → 14 · **B** backend 03 → 04 → 13 · **C** agent 06 → 07 → 08 → 09 → 15 · **D** frontend 10 → 11 → 12 (uses the scripted agent from 06 until 08 lands). TASK-16 is stretch. Architecture: `docs/ARCHITECTURE.md`.

| Task | Title | Lane | Depends on | Owner | Status | Branch |
|---|---|---|---|---|---|---|
| TASK-01 | Backend skeleton and sample cases | A | — | PriyanshuIITGHY2006 | done | task-01-backend-skeleton |
| TASK-02 | Policy and regulation text extraction with clause search | A | 01 | PriyanshuIITGHY2006 | done | task-02-document-search |
| TASK-03 | Rule base and quote verifier | B | 01 | github-kaustavbhowal21 | done | task-03-rules-verify |
| TASK-04 | Deterministic calculators | B | 01 | github-kaustavbhowal21 | done | task-04-deterministic-calculators |
| TASK-05 | Ombudsman precedent finder | A | 02 | PriyanshuIITGHY2006 | done | task-05-precedent-finder |
| TASK-06 | Agent service skeleton with streaming | C | — | Sumedha | done | task-06-agent-skeleton |
| TASK-07 | Agent tools on the Cline SDK | C | 06 | github-kaustavbhowal21 | done | task-07-agent-tools |
| TASK-08 | Agent orchestration and citation gate | C | 07, 03, 04 | github-kaustavbhowal21 | done | task-08-agent-orchestration |
| TASK-09 | Grievance drafting, local summary and chatbot baseline | C | 08 | github-kaustavbhowal21 | done | task-09-grievance-drafting |
| TASK-10 | Frontend shell, start screen and verdict board | D | 06 | Sumedha | done | task-10-frontend-shell |
| TASK-11 | Live analysis timeline, Policy X-ray and clocks | D | 10 | Sumedha | done | task-11-live-timeline |
| TASK-12 | Action centre and compare view | D | 11, 09 | github-kaustavbhowal21 | done | task-12-action-compare |
| TASK-13 | Non-payable item classifier and bill arithmetic check | B | 03 | PriyanshuIITGHY2006 | done | task-13-npi-bill-check |
| TASK-14 | SQLite persistence, analyses and drafts API | A | 01 | PriyanshuIITGHY2006 | done | task-14-sqlite-persistence |
| TASK-15 | Evaluation harness and Ombudsman replay | C | 05, 08 | Sumedha | done | task-15-eval-replay |
| TASK-16 | Upload your own claim: PDF upload, pre-fill, confirm, analyse | A | 02, 14 | PriyanshuIITGHY2006 | done | task-16-upload-claim |
| TASK-17 | UI polish: typography, theme, landing, verdict board, timeline, shell | D | 10, 11 | Sumedha | done | task-17-ui-polish |
| TASK-18 | Dashboard and demo sign-in | D | 14, 16 | PriyanshuIITGHY2006 | done | task-18-dashboard-demo-signin |

Non-code work (demo owner, alongside): record the plain-chatbot baseline for cases A–C into `data/baseline/<case_id>.json`; label 10–15 awards in `data/eval/awards.csv`; take screenshots for `docs/screenshots/`; pitch.
