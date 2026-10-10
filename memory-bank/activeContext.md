# Active context

- **Current task:**
- **Current focus / open questions:**
- Kickoff: claim-contest agent for Indian health-insurance deductions; data layer (`data/rules`, `data/policies`, `data/cases`) and TASK-01…12 written; next: start lanes A–D in parallel.
- TASK-01 implemented on branch task-01-backend-skeleton (backend skeleton + sample-case endpoints, tests green); pending review/merge. Note: board-claim commit on main is local-only — `git push` to origin needs credentials.
- TASK-01 closed & ready for review: branch task-01-backend-skeleton pushed to origin (credentials OK), docs/cline-log/TASK-01.md written, board set to `review` on main; awaiting reviewer merge. 4/4 acceptance tests green.
- TASK-06 (agent service skeleton, scripted SSE): blocked on TASK-01 for real case fetch and on TASK-07/08 for verified quotes, `calculation` and backend `POST /analyses`.
- TASK-02 implemented on branch task-02-document-search: column-aware PyMuPDF clause extraction + dependency-free BM25; `GET /documents`, `GET /documents/{doc_id}/clauses`, `POST /policy/search`; `app/text.normalise` is the shared quote-folding helper. 12/12 backend tests green; ready for review. Current focus: TASK-03 verifier should reuse `normalise`; TASK-05/07 can consume clauses via `POST /policy/search`.

- TASK-03 closed & ready for review: branch task-03-rules-verify pushed to origin, docs/cline-log/TASK-03.md written, board set to `review`; awaiting reviewer merge. 14/14 tests green.
- TASK-03 reviewed and merged: citation gate hardened (padded/altered/short quotes rejected), policy quotes verified against TASK-02 extracted text with page, `/rules/search` on BM25. 30/30 backend tests green. Current focus: TASK-07/08 call `POST /verify-quote` with `source_id` = rule id or document id.

- TASK-10 (frontend shell, start screen, verdict board) on branch task-10-frontend-shell: 13/13 vitest, build clean without services; in review. TASK-11 builds on app/case/[id]/page.tsx.
- TASK-05 (branch task-05-precedent-finder): ombudsman precedent finder — `services/precedents.py` splits the six award books into 1,190 de-duplicated awards via visual-line "Case No./Complaint No." headers (reusing TASK-02 `documents._extract`), BM25 (TASK-02) ranks full award text; `POST /precedents/search` → `list[Precedent]`. 9/9 tests green; ready for review. Current focus: TASK-08 grounds rule→precedent with these; `data/eval/awards.csv` awaits labels.

- TASK-04 (deterministic calculators) on branch task-04-deterministic-calculators: 4 calc endpoints + 11 tests, 43/43 backend tests green; ready for review. Current focus: reviewer runs tests and merges; TASK-08 (citation gate) and TASK-13 (bill check) depend on these calculators.

- TASK-14 (SQLite persistence, analyses and drafts API) on branch task-14-sqlite-persistence: 15 new tests, 74/74 backend tests green; ready for review. Current focus: reviewer runs tests and merges; the agent (TASK-08/09) posts accepted analyses and drafts to these endpoints, and the backend enforces the tier-1 approval gate (409).

- TASK-07 (agent tools on the Cline SDK) on branch task-07-agent-tools: 12 tools + backend client + policies, 48/48 vitest, typecheck clean; ready for review. Current focus: TASK-08 builds the `Agent` with `createTools(createBackendClient(settings.backendUrl)).AVAILABLE_TOOLS` and `toolPolicies` (filter policies to the registered tools or keep all twelve listed).
- TASK-11 (live timeline, Policy X-ray, clocks) on branch task-11-live-timeline: frontend 52/52 vitest, agent suite green, build clean without services; in review. Includes a small agent fix: SSE responses now carry the CORS header for the frontend origin.

- TASK-13 (NPI classifier and bill check) on branch task-13-npi-bill-check: 22 new tests, 97/97 backend tests green; ready for review. Current focus: reviewer merges, then `agent/src/llm/tools.ts` drops `classify_npi`/`check_bill` from `PENDING_BACKEND` (left to the merger on purpose); TASK-08 can call both endpoints.


- TASK-08 (agent orchestration and citation gate) on branch task-08-agent-orchestration: gate + runner + SDK agent + llm mode, 77/77 vitest, 97/97 pytest, typecheck clean; ready for review. Current focus: a live `AGENT_MODE=llm` run with real credentials on cases A-C; TASK-09/15 consume the gated `Analysis`.
- TASK-17 (UI polish) on branch task-17-ui-polish: fonts, teal theme, shell, landing, verdict board, timeline stepper, Full-rule box; frontend 66/66; in review. Current focus: reviewer merges; after TASK-08 lands, retake `docs/screenshots/17-verdict-evidence-panel.png` so the Full-rule box shows live.


- TASK-09 (grievance drafting, local summary, chatbot baseline) on branch task-09-grievance-drafting: draft + baseline endpoints, 104/104 vitest, 97/97 pytest, typecheck clean; ready for review. Current focus: TASK-12 calls `POST /analyses/:id/draft` and `GET /baseline/:case_id`; PATCH /drafts/{id} on the backend approves tier 1 before tiers 2/3.

- TASK-16 (upload your own claim) on branch task-16-upload-claim: backend 147/147 and frontend 74/74 tests green; ready for review. The "Check your own claim" link now sits in the TASK-17 landing hero beside "Try a sample case". Current focus: reviewer merges; uploaded `user_*` cases need the live agent because the scripted agent has no answer key for them.
- TASK-12 (action centre and compare view) on branch task-12-action-compare: Action and Compare tabs, .ics export, approval gate in the UI; frontend 99/99, build clean; ready for review. Current focus: record the chatbot baselines for cases A-C so the Compare tab has content for the demo.

- TASK-15 (eval and replay) on branch task-15-eval-replay: ready for review. Current focus: a teammate reads data/eval/candidates.csv awards and fills data/eval/awards.csv by hand; only then run scripts/eval.ts once with AGENT_MODE=llm.
- TASK-18 (dashboard and demo sign-in) on branch task-18-dashboard-demo-signin: backend 164/164 (after rebasing onto TASK-15) and frontend 103/103 tests green, tsc and lint clean; ready for review. Current focus: reviewer merges; the case-page saved-result fallback touches the same file as TASK-12 (tabs), so check it after both are in.

