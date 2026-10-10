# How Cline was used to build this project

Cline was the core development tool for this project. This document records how: the setup, every task run through Cline, and summary statistics taken from Cline's task history at the end of the build.

## 1. Setup

| Area | What we configured | Where |
|---|---|---|
| Models | Separate Plan and Act models | Cline settings |
| Workspace rules | Core conventions, stack, memory-bank protocol; conditional backend/frontend rules that load only when matching files are in context | `.clinerules/01–05` |
| Team rules | Task ownership, branching, shared-file protocol | `AGENTS.md` |
| Memory bank | Project brief, product context, architecture and interfaces, tech context, active context, progress — read by Cline at the start of every task | `memory-bank/` |
| Workflows (slash commands) | `/kickoff.md` (problem statement → architecture → tasks), `/start-task.md` (claim, branch, load context, plan first), `/finish-task.md` (tests, scope check, progress, commit) | `.clinerules/workflows/` |
| Built-in commands | `/deep-planning`, `/newtask`, `/smol`, `/newrule` | — |
| MCP servers | Context7 (current library docs) | Cline MCP settings |
| Safety | Checkpoints enabled; tests-first rule; touch-only-listed-files rule | Settings, `.clinerules/01-core.md` |

## 2. Cline SDK inside the product

| Item | Detail |
|---|---|
| Where the SDK is used | `agent/` (Node 22 service); only `agent/src/llm/` imports `@cline/sdk` (pinned 0.0.92) |
| Agent purpose | Audits every deduction of a health-insurance claim: verdict (valid / contestable / needs info), verified verbatim citations, recoverable amount from calculators only |
| Custom tools (`createTool`) | 12 backend tools: `get_case`, `search_policy`, `search_rules`, `get_rule`, `verify_quote`, `calc_proportionate`, `calc_waiting_period`, `calc_tat`, `calc_deadlines`, `find_precedents`, `classify_npi`, `check_bill`; plus `submit_verdicts` (`lifecycle.completesRun`) to end the run. zod input schemas, validated before any request |
| Built-in tools enabled | None (the `Agent` runtime has no built-in tools; the agent only uses the tools above) |
| Tool policies | Explicit `toolPolicies` for every tool (`autoApprove: true`); a test checks every tool has one |
| Other SDK features used | `Agent.subscribe` events mapped to a live SSE timeline; `continue()` for up to 2 corrective turns when the citation gate rejects a verdict; provider `cline` with a ClinePass model, so the product's agent runs on the team's Cline account (provider, model and key from `.env` only) |

## 3. Development process

1. The problem statement was turned into `memory-bank/` context and task specs (`tasks/TASK-NN.md`).
2. Each task was run in a fresh Cline task: `/start-task.md` → plan reviewed in Plan mode → implementation in Act mode (tests first) → `/finish-task.md`.
3. Diffs were reviewed after each task; corrections were made on the same branch and noted in the log below.
4. Branches were merged to `main` once acceptance tests passed.

## 4. Task log

Each task's entry is written by `/finish-task.md` to `docs/cline-log/TASK-NN.md`; the table below is compiled from those files at the end of the build.

| Task | What Cline built | Modes / commands used | Tests | Checkpoint restores | Review fixes |
|---|---|---|---|---|---|
| TASK-01 | FastAPI skeleton, data models, sample-case endpoints | Plan → Act; `/start-task.md`, `/finish-task.md` | 4 | 0 | none |
| TASK-02 | Column-aware PDF extraction, clause splitting, BM25 clause search | Plan (PDF probe scripts) → Act; workflows | 8 | 0 | none |
| TASK-03 | Rule base (27 rules) and quote verifier | Plan → Act; workflows | 10 | 0 | verifier hardened: padded quotes, changed numbers/negations, added words, word order, quotes cut after a negation |
| TASK-04 | Decimal calculators: proportionate, waiting period, TAT, deadlines | Plan → Act; workflows | 11 | 0 | per-deduction `recoverable_amount`; 422 for invalid dates |
| TASK-05 | Ombudsman award splitter (1,205 awards) and precedent search | Plan (award-book probes) → Act; workflows | 9 | 0 | Order-No. header format (glued awards) |
| TASK-06 | Agent service: fastify, SSE stream, scripted mode | Plan → Act; workflows | 20 | 0 | blank `.env` values, env loading in `npm run dev` |
| TASK-07 | 12 Cline SDK tools with zod schemas and tool policies | Plan (SDK runtime probe) → Act; workflows | 27 | 0 | answer key stripped from `get_case` |
| TASK-08 | Cline SDK agent, citation gate, corrective turns, persistence | Plan (SDK probe with scripted model) → Act; workflows | 28 | 0 | cases loaded from the backend; verified-quote result in timeline events |
| TASK-09 | Grievance letters (3 tiers), local summary, chatbot baseline endpoint | Plan → Act; workflows | see log | 0 | deadlines dated from the grievance |
| TASK-10 | Frontend shell, start screen, verdict board, evidence panel | Plan → Act; workflows | 13 | 0 | headline total summed from the rows |
| TASK-11 | Live timeline (SSE), Policy X-ray, TAT clocks | Plan → Act; workflows | 38 | 0 | insurer-bears amount accepts MC24-16a or 16b |
| TASK-12 | Action centre, compare view, .ics export | Plan → Act; workflows | 24 | 0 | letter kept in English; language sets the summary |
| TASK-13 | Non-payable item classifier and bill arithmetic check | Plan → Act; workflows | 22 | 0 | none |
| TASK-14 | SQLite persistence, analyses and drafts API, approval gate | Plan → Act; workflows | 15 | 0 | duplicate draft id → 409 |
| TASK-15 | Precedent detail, eval endpoint, Ombudsman replay, eval scripts | Plan → Act; workflows | 42 | 0 | replayed award hidden from `find_precedents` |
| TASK-16 | PDF upload, pattern pre-fill, confirm form, stored user cases | Plan → Act; workflows | see log | 0 | duplicate deduction ids; uploads hidden from samples; consumables keywords |
| TASK-17 | UI polish: fonts, theme, landing, stepper timeline, full rule text | Plan → Act; workflows | 13 | 0 | none |
| TASK-18 | Dashboard, demo sign-in, `GET /analyses`, saved-result fallback | Plan → Act; workflows | see log | 0 | none |

## 5. Summary statistics

Taken from the task logs and the repository at submission time.

| Metric | Value |
|---|---|
| Cline tasks run | at least 18 (one per task spec; see each teammate's task history for the full count) |
| Files created / edited by Cline | from each teammate's Cline task history (to be added) |
| Tests on `main` at submission | 432 (backend 164, agent 141, frontend 127) |
| Workflows invoked | `/start-task.md` and `/finish-task.md` on every task (at least 36 calls) |
| MCP tool calls | none recorded in the task logs (Context7 configured) |

## 6. Screenshots

See `docs/screenshots/` — Plan-mode plans, Act-mode runs, workflow invocations, checkpoint restores, MCP calls, the Rules panel.
