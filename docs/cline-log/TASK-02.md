# TASK-02 — Policy and regulation text extraction with clause search

Branch: `task-02-document-search` · Owner: PriyanshuIITGHY2006

**Built:** the PDF → clause pipeline and clause search in `backend/`:
- `app/text.py` — `normalise()`: NFKC (fixes the "ﬁ" ligature), curly→straight quotes/dashes, `(\w)-\s+(\w)` → `\1-\2`, OMB17 amendment markers (`1 [`, `]`) removed, whitespace collapsed, lowercased. Single folding point for every PDF-text comparison.
- `app/services/documents.py` — registry built from `data/policies/anchors.yaml` (3 policies) and `data/rules/rules.yaml` (`MC24`, `OMB17`); column-aware extraction with PyMuPDF `page.get_text("blocks")` sorted by column (x0 < width/2 first) → y → x; clause splitting at numbered (`12. Moratorium Period:`), all-caps and definition (`Associated medical expenses:`) headings plus standalone `Note:` lines; each clause keeps its 1-based page and its heading line, so concatenated clause text reproduces the document; results cached per process (`lru_cache`).
- `app/services/search.py` — dependency-free Okapi BM25 (`k1=1.5`, `b=0.75`) over `normalise`d clause text; zero-score documents dropped, ties keep corpus order.
- `app/routes/documents.py` + `app/main.py` — `GET /documents`, `GET /documents/{doc_id}/clauses`, `POST /policy/search` (404 on unknown `doc_id`); routes stay thin.
- `app/models/schemas.py` — `DocumentKind`, `DocumentSummary`, `PolicySearchRequest` (`k` default 5, 1–50). `backend/requirements.txt` — `pymupdf>=1.28`.

**Cline usage:**
- **Plan/Act:** Plan mode first to load context (task file, memory bank, `systemPatterns.md` interfaces, both YAML registries) and to probe all five PDFs with throwaway scripts in `/tmp` — block ordering, `normalise`, clause splitting and BM25 ranking were validated against the anchors.yaml quotes *before* any repo file was written; then Act mode for tests-first implementation.
- **Model:** Act mode on the session's configured Act model (the agent cannot read its own model id, so it is not recorded here).
- **Workflows:** `/start-task.md` (claim on `tasks/BOARD.md`, one branch per task, memory bank loaded, plan first) and `/finish-task.md` (tests, scope check, progress notes, this log, commit). Team workflow per `AGENTS.md`: acceptance tests written before implementation, append-only memory-bank updates, board set to `review` on `main`.
- **Built-in tools/commands:** `read_files` (context + reading redirected command output, since shell-integration capture was unreliable), `run_commands` (pytest, git, `/tmp` exploration and smoke scripts), `editor` (create/modify backend files, memory-bank appends).
- **MCP tools:** none used for this task.

**Tests:** `backend/tests/test_documents.py` — 8 new tests, all passing; whole backend suite `12 passed` from both `backend/` and the repo root:
1. `normalise("ﬁrst  non- disclosure “x”")` == `first non-disclosure "x"`.
2. `GET /documents` returns exactly the 5 registry ids with correct titles/kinds and distinct page counts (star_fho_v19 16, hdfc_optima_secure 29, niva_reassure2 2) — proves each id reads its own PDF.
3. All 6 `star_fho_v19` quotes in `anchors.yaml` appear in the normalised concatenated clause text (335 clauses extracted).
4. `POST /policy/search` (pharmacy/implants query) → clause containing "do not include Cost of pharmacy" at rank 1 (`Associated medical expenses:`, p4).
5. `POST /policy/search` "moratorium eight continuous years" → `12. Moratorium Period:` at rank 1, page 13; `k` defaults to 5.
6. Unknown `doc_id` → 404 on both the clauses endpoint and `POST /policy/search`.
7–8. BM25 unit tests without any PDF: term-frequency ranking, zero-score documents dropped, empty query, `k` cap, query folding (curly quotes, case, hyphen break).

**Checkpoint restores:** 0

**Review fixes:** none to the code. Review checks: 12/12 tests pass from backend/; cold extraction of all five PDFs takes about 0.6 s, so lazy caching is fine for the demo; spot searches on the other documents return the governing clauses (MC24 13 'Policy/Claim cannot be contested', MC24 16 'Final authorization for Discharge', OMB17 rule 14). Data note: `data/Reassure-2-0-Policy.pdf` is a 2-page product brochure, not the policy wording, so `niva_reassure2` returns few or no clauses; no sample case depends on it.

**Plan corrections (before/during implementation):**
- The repo had moved on since the initial reads (TASK-06 merged): `schemas.py` uses `class X(str, Enum)` rather than `StrEnum`, and `main.py` imports routers as `from app.routes.cases import router as cases_router`. The first attempt used the older shapes and failed at import; corrected to the current file conventions.
- `_resolve_pdf` first flattened the YAML paths to a bare filename; changed to drop the repo-relative `data/` prefix so nested paths and a relocated `DATA_DIR` both resolve.
- Extraction tuning was driven by the anchors, not by guesswork: column-then-y block ordering was required (content-stream order interleaves the two columns), and for OMB17 removing both `1 [` and `]` gave the best verbatim match against `rules.yaml`. `anchors.yaml` was never edited to make a test pass.
