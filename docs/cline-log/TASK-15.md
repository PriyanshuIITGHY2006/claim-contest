# TASK-15 log - evaluation harness and Ombudsman replay

Branch: `task-15-eval-replay` · Owner: Sumedha

## What was built
- **Backend:** `get_precedent(id)` and `GET /precedents/{precedent_id}` return `PrecedentDetail` (full `text`, no `score`); 404 for an unknown id. `GET /eval/awards` (`routes/eval.py`, stdlib `csv`) returns every column of `data/eval/awards.csv`; `[]` for a header-only or missing file. One `include_router` line in `main.py`.
- **Agent:** `src/replay.ts` has `removeDecision`, `buildReplayCase`, the in-memory `ReplayRegistry`, `toVerdictStatus`, `agreement`, `citationVerificationRate`, `toCsv` and the scripted replay stream. `backend.ts` gains `getPrecedent` (URL-encoded id) and `getEvalAwards`. `server.ts` gains `POST /replay/:precedent_id` only.
- **Scripts:** `scripts/candidates.ts` (run; backend only, no credits) wrote `data/eval/candidates.csv` with 25 awards, 5 per ground. `scripts/eval.ts` is written and **not run**.
- **Spec:** `systemPatterns.md` `GET /eval/awards` row now lists all columns; `POST /replay` row documents 404, 422 and 502.

## Decision removal
Line by line (award text has no blank lines):
1. Cut from the first short line (<= 40 chars) that is a bare heading `decision | observation(s) | finding(s) | conclusion(s) | order | award` (optionally "of the Forum", plus punctuation) to the end. "Order dated ..." and "Award No. ..." headers are not headings.
2. Drop every line matching `award | dismissed | allowed | directed | ex-gratia | complaint is` (case-insensitive). `directed` is wider than the task's "directed to pay" because awards also say "directed to process". `ex-gratia` and `complaint is` were added after Book17#288, whose decision line has none of the four task keywords.
3. A long outcome line (>= 60 chars) also drops the next line, because PDF lines wrap ("... an ex-gratia of" / "Rs.2,000/- ...").
4. If under 300 characters remain, `POST /replay` answers 422 `skipped: too little text after redaction` and `eval.ts` reports the same line for that award.

Last 3 kept lines of three real awards (backend text, run against the live backend), so a person can confirm nothing leaks:

**Mediclaim-Book17.pdf#288** (keyword outcome partly), 2,569 -> kept lines end:
```
actual amount could not be worked out in the absence of the exact quantum of discount
*********************************************************************************************
Office of Insurance Ombudsman, Chennai
```
**Mediclaim-Book20.pdf#13** (keyword outcome dismissed), 555 -> 494 chars:
```
paid Rs.6,330/- subsequent to his grievance with R.O., by deducting an amount of
Rs.1,760/-  on the basis of eligible room rent under Sum Insured of the policy.
*********************************************************
```
**Mediclaim-Book9.pdf#132** (keyword outcome allowed), 1,748 -> 1,530 chars:
```
ailments or the medication which was being taken for the same.  Hence the decision
of the TPA/insurer to reject the claim under the condition of pre-existing illness and
Chennai  Ombudsman Centre
```
A person should read these. What removal cannot do is hide **reasoning that points to the outcome**. In Book17#288 the kept text still says "There is some merit in the argument of the insured". In Book9#132 it keeps the expert's trauma finding and the lead-in "Hence the decision of the TPA/insurer to reject the claim ...", whose end is cut. The stated outcome is gone; an agent (or a reader) can still infer it. This is inherent to replaying a reasoned award and is noted as an open issue.

## Tests (written first, seen failing, then passing)
- `backend/tests/test_precedent_detail.py` (4) and `test_eval.py` (4). Real ids are sent with `%23`; the 404 test uses `Mediclaim-Book3.pdf%23999999`. Backend 105/105 (was 97).
- `agent/test/replay.test.ts` (34): redaction (task keywords, the Book17#288 ex-gratia sentence, Book20#13, Book9#132, the heading cut, header look-alikes, 6 heading spellings); the 300-character floor; agreement (accuracy, majority baseline, per-label counts, `needs_info` is a miss, empty input); citation rate; CSV quoting; `buildReplayCase` (passes `caseSchema`, id `replay:<id>`, D1, `Unknown (historical award)`, no `outcome` field, no decision in `letter_text`); `get_case` override (replay id served from memory with no backend call, other ids unchanged); `POST /replay` (200 with `analysis_id`, 404, 502, 422); gate behaviour for replay cases. Agent 114/114 (was 80). `npm run typecheck` clean.
- No test calls a model. Typecheck of `scripts/*.ts`: `npx tsc --noEmit --strict --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --module NodeNext --moduleResolution NodeNext --target ES2022 --lib ES2023 --types node --esModuleInterop --verbatimModuleSyntax --skipLibCheck scripts/candidates.ts scripts/eval.ts` -> exit 0. No `tsconfig.json` change.
- Live (scripted mode, backend :8000, agent :8100): `POST /replay/Mediclaim-Book17.pdf%23288` -> `{analysis_id}`, analysis `done` with no verdicts, case id `replay:Mediclaim-Book17.pdf#288`; the unknown id -> 404 `Unknown precedent_id: Mediclaim-Book3.pdf#999999`. A first try returned 415 only because PowerShell's `Invoke-RestMethod` adds a form content type to a body-less POST; with `-ContentType application/json -Body '{}'` it works (a client that sends no content type is fine).

## Agreement statement (not yet true)
- Agreement is meant to be measured on **historical (pre-2024) awards** (2003-2014), so it is never current accuracy.
- Labels **to be confirmed by a person**: `data/eval/awards.csv` is header-only. Nobody has read the 25 candidates and filled it in, and it was not filled from `keyword_outcome` or from model output.
- So `scripts/eval.ts` **cannot produce numbers yet**: with no rows it prints that there is nothing to measure. Once a teammate has confirmed 10-15 rows, run it once with `AGENT_MODE=llm` and paste the summary here; only then may this log say the labels were confirmed by a person.
- `scripts/eval.ts` was not run (it spends credits).

## Decisions and deviations
- **Gate change (`agent/src/gate.ts`, not on the task list; you chose this over a nominal amount):** the spec's replay deduction has `amount: 0`, and the gate rejects a contestable verdict that recovers 0, so no replay could ever end `contestable`. For a case id starting `replay:` every verdict must recover exactly 0; citations are still fully checked. Real cases behave as before (tested: a contestable verdict recovering 0 is still rejected for `case_a`). `gate.ts` is TASK-08's file; it needs a reviewer's eye.
- **Other files outside the list:** `agent/src/llm/agent.ts`, `agent/src/llm/tools.ts` (the approved optional case override; default unchanged). `scripts/` is not in `tsconfig.json`, so it is checked by the one-off command above.
- `.clinerules` asks for `docs/cline-log/TASK-NN.md`; this is it.
- `npm install` was needed in `agent/` (the `@cline/sdk` folder was missing locally); `package.json` and the lockfile are unchanged.
- `ruff` is not installed in this environment, so backend lint was not run.

- **Merge with `main` (TASK-09, TASK-16, TASK-17):** conflicts in `backend.ts`, `server.ts` and the memory-bank files were resolved by keeping both sides (new routes and methods sit side by side). TASK-09 made `policy.doc_id`, `patient` and `admission` required in `caseSchema`, which broke the replay case; `buildReplayCase` now fills them with "Unknown (historical award)" placeholders (`policy.product` is unchanged, `doc_id: "historical_award"`). I dropped the extra `policy.note` I had added. After the merge: agent 138/138, backend 158/158 (needed `pip install python-multipart`, already in `requirements.txt`), typecheck and the scripts check clean.

## Open issues
- `awards.csv` has no labels (see above); the headline measurement does not exist yet.
- Redaction removes the stated outcome but not reasoning that implies it (see "Decision removal"). Treat replay results as "the agent read award reasoning", not as a blind prediction.
- In `llm` mode a replay verdict recovers 0 by construction; only the status is compared.
- Replay cases live in memory and are lost on restart.
- TASK-09 (in review) also edits `agent/src/server.ts` and `backend.ts`; expect a small merge in the same two files (both sides add routes/methods).

## Review fixes
- Answer leak in replays: the agent's `find_precedents` tool could return the very award being replayed, with its excerpt and keyword `outcome`, so in `llm` mode the agent could look up the result it is asked to predict. `createTools` takes an optional `isHiddenPrecedent`; the production runner hides every award that is registered as a replay. Other awards (and normal analyses with no replay registered) are unchanged. Two new tests.
- Review checks that held: the gate change only applies to `replay:` ids, which come only from the in-memory replay registry (a `POST /analyses` with a `replay:` id goes to the backend and fails with "Unknown case_id"); every citation check still applies to replay verdicts, and a contestable verdict recovering 0 is still rejected for real cases; `get_case` still strips `expected` for replay cases; `buildReplayCase` carries no `outcome`; `GET /precedents/{id}` handles the URL-encoded `#` and returns 404 for unknown ids; `GET /eval/awards` reads only `data/eval/awards.csv`. After merging `main`: backend 158 and agent 140 pass, `tsc` clean.
- Still open (not code): `data/eval/awards.csv` has no person-confirmed labels, so `scripts/eval.ts` has nothing to measure. A teammate must read 10–15 candidates in `data/eval/candidates.csv` and record the outcomes; then run `eval.ts` once in `llm` mode.

