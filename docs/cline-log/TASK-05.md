# TASK-05 — Ombudsman precedent finder

Branch: `task-05-precedent-finder` · Owner: github-PriyanshuIITGHY2006

**Built:** Award-book splitter + BM25 precedent ranking in `backend/`. No new dependencies (reuses `pymupdf` and the TASK-02 `BM25Index` / `normalise`).
- `app/services/precedents.py`: extracts each of the six `data/*.pdf` award books through the TASK-02 column-aware `documents._extract` (flattened to visual lines), splits into awards on `Case No.` / `Complaint No.` headers, de-duplicates, and derives `case_no`, `year` and a heuristic `outcome`.
- Header detection merges continuations within a 3-visual-line window (the books interleave `Case No.` and `Complaint No.`); `case_no` prefers the number on the header line and falls back to a case-insensitive `case no … <number>` scan of the body — this fixes empty `case_no` caused by case variants such as `Case No.:`.
- BM25 ranks over the **full** award text (not the 600-char excerpt), so an award matches on a term anywhere in it even when the excerpt does not show it.
- `app/routes/precedents.py`: `POST /precedents/search` → `list[Precedent]` (≤ k), registered in `app/main.py`.
- `Precedent` model (`schemas.py`): added optional `year` and `outcome` (`PrecedentOutcome` enum: allowed / dismissed / partly_allowed / other). `memory-bank/systemPatterns.md` was updated first.

**Cline usage:**
- **Plan/Act:** Started in Plan mode to load context (TASK-05.md, memory-bank, systemPatterns.md, the TASK-02 documents/search services) and empirically probe the six award PDFs (header counts, blank-`case_no` rate, year/outcome availability) before proposing a plan. Three ambiguities were surfaced; the user approved two changes (null `year`; BM25 over full award text) and chose `review`, then Act mode implemented it.
- **Workflows:** `/start-task.md` (claim on `tasks/BOARD.md` committed/pushed to `main`, branch `task-05-precedent-finder`, load memory bank, plan-first) and `/finish-task.md` (tests, scope check, progress notes, this log, board → `review`).
- **Built-in tools/commands:** `read_files` and `search_codebase` (context), `run_commands` (git checkout/pull --rebase/branch/commit/push, venv + pip install, throwaway probe scripts, pytest), `editor` (backend files + tests, schema / systemPatterns / board / memory-bank edits), `ask_question` (the two-change checkpoint).
- **MCP tools:** none used.

**Tests:** `backend/tests/test_precedents.py` — 9 tests; whole backend suite `41 passed`.
- 4 acceptance criteria: ≥ 800 de-dup awards with no empty book (#1 — 1,190 total), non-empty `case_no`/`excerpt` (#2), a room-rent query returns k positive-scored precedents (#3), a PED query returns an excerpt mentioning it (#4).
- Plus: the endpoint returns typed `Precedent`s with optional `year`/`outcome`; `k` defaults to 3; `_year` / `_outcome` / `_case_no` unit tests.

**Checkpoint restores:** 0

**Review fixes:**
- Headers printed as "Order No.: BPL/GI/08-09/10   Case No.: GI/NIA/0408/13" (Bhopal centre) were not detected, so about a dozen Bhopal awards were glued into one record (Mediclaim-Book9 #99, 40,079 characters, 9 "order dated" lines). The header pattern now also accepts an Order/Award No. line that carries a Case/Complaint No., and `case_no` is taken after the "Case No." label. Awards: 1,190 → 1,205; Mediclaim-Book9: 218 → 229, matching an independent pdftotext count. Two new tests (Order No. header unit test; no award may contain more than 3 "award/order dated" lines). 43 backend tests pass.
- Review checks that held: per-book counts match independent pdftotext header counts (Book3 278, Book17 368, Book20 288, Group-11 29, Group-17 9); every award has a case number and excerpt; a random sample of 10 outcome labels was 10/10 correct against the award's closing lines; years fall in 2000–2016 (38 awards have none and return null).
- Known limitation: the centre name and party names printed just above a header attach to the previous award's text, so excerpts start at the header line.

**Assumptions / limitations:**
- Header detection is visual-line based (block-level extraction would miss ~36% of headers in these layout-mangled books). A genuine award whose body never states a case number within the scan window could still yield an empty `case_no`, but none do in these six books.
- `year` is null for 38 awards whose header carries no year (e.g. "Case No. Shri Dinesh Kumar"); allowed per the approved change.
- `outcome` is heuristic keyword detection over the first ~4,000 chars (`partly … allowed/dismissed` > `dismissed` > `allowed`), not a guaranteed read of the final order.
- Dedup is `(case_no, first 200 chars)`: exact repeats (GroupMediclaim-Book17) collapse; the same case appearing with materially different text is kept.
- `data/eval/awards.csv` is left as a header-only skeleton (labelling is TASK-10 / the stretch eval).
