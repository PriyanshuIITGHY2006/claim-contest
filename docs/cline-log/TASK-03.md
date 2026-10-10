# TASK-03 — Rule base and quote verifier

Branch: `task-03-rules-verify` · Owner: github-kaustavbhowal21

**Built:** Rule base, keyword search, and quote verifier (the citation gate) in `backend/`. Added the `rapidfuzz` dependency.
- Loaded `data/rules/rules.yaml` (27 rules) and exposed `GET /rules` and `GET /rules/{id}` (404 on unknown).
- `POST /rules/search` via a deterministic local keyword scorer (BM25 from TASK-02 is not merged yet).
- `POST /verify-quote` → `{verified, match, score, page}`: normalises both sides (NFKC, curly quotes, hyphenated line breaks, OMB17 `1 [`/`]` amendment markers), then exact substring → `exact`, `rapidfuzz.fuzz.partial_ratio ≥ 92` → `fuzzy`, else `none`. A rule with `verified: false` never verifies. Policy quotes fall back to `data/policies/anchors.yaml` until TASK-02 provides extracted text.

**Cline usage:**
- **Plan/Act:** Started in Plan mode to load context (`tasks/TASK-03.md`, memory-bank, `systemPatterns.md`, `data/rules/rules.yaml`, `data/policies/anchors.yaml`, the TASK-01 backend code) and present a plan; the user approved, supplied the GitHub handle, and switched to Act mode to implement.
- **Workflows:** `/start-task.md` (claim on `tasks/BOARD.md` committed/pushed to `main`, branch `task-03-rules-verify`, load memory bank, plan-first) and `/finish-task.md` (tests, scope check, progress notes, this log, board → `review`). Team workflow per `AGENTS.md`: one branch per task, acceptance tests written before implementation (TDD), and `main` reconciled with the concurrent TASK-06 merge via `git pull --rebase`.
- **Built-in tools/commands:** `read_files` and `search_codebase` (context gathering), `run_commands` (git checkout/pull --rebase/branch/commit/push, `python -m venv` + `pip install`, `pytest`), `editor` (create backend files + tests, memory-bank/board edits), `ask_question` (checkpoint count).
- **MCP tools:** none used for this task.

**Tests:** `backend/tests/test_rules.py` and `backend/tests/test_verify.py` — 10 new tests; `14 passed` together with TASK-01's 4.
- 7 acceptance criteria: 27 rules all `verified:true` + `MC24-13` page 23/`overrides_policy` (#1), exact `MC24-17c` → `exact` (#2), substring → verified (#3), non-match → `none` (#4), `verified:false` fixture never verifies (#5), `POST /rules/search` → `MC24-16b` in top 3 (#6), clean `PPI24-B-VI-3-i` vs OCR-artefact source → `fuzzy` (#7).
- Plus an unknown-rule 404 test and a policy-anchor verification test.

**Checkpoint restores:** 0

**Review fixes:** (30 tests pass after review, 16 added)
- Citation gate: a quote longer than its source no longer verifies (`partial_ratio` scored a real rule padded with invented text as 100).
- Fuzzy matches must neither drop nor add numbers, number/unit words or negation/obligation words versus the matched source window ("one hour" → "three hours", "60" → "96 months", a dropped "not" are rejected); OCR-split words such as "mont hs" still count.
- Fuzzy matches may not add words: every quote word must occur in the matched window once spacing and punctuation are removed.
- Quotes under 5 words never verify.
- After TASK-02 merged: `verify.py` uses the shared `app.text.normalise` (local copy removed); policy quotes are verified against the extracted document text with the clause `page` instead of `anchors.yaml`; unknown policy ids return 404 like unknown rules.
- `/rules/search` uses the TASK-02 `BM25Index` (local scorer removed); acceptance #6 still passes.
- `match` typed as `Literal["exact","fuzzy","none"]`; `verify_quote` parameters typed (no `Any`).

- Second review: a quote that starts right after a source negation no longer verifies, exact or fuzzy ("policy and claim of health insurance shall be contestable..." cut from MC24-13's "No policy and claim..." inverted the rule and returned `exact`).
- Second review: fuzzy matches must keep the source's word order (two swapped words previously passed at 0.97).
- Second review checks that held: one-word meaning flips are rejected (insurer→insured, after→before, beyond→within, additional→reduced, borne→waived); misspelled quotes are rejected; policy quotes verify in about 10 ms. 32 tests pass.

**Assumptions / limitations:**
- Test #7 exercises the pure `match_quote()` against a source with the rule's documented OCR artefacts (`p .rovided`, `com plaints`); PPI24 Part B is not in the TASK-02 document registry.
- Rule quotes are verified against `rules.yaml` text, not the PDFs; the rule base itself was checked verbatim at kickoff.
- A verified quote can still drop a trailing exception (e.g. stop before "except for established fraud"). The agent (TASK-08) should show the full rule text next to any quote.
