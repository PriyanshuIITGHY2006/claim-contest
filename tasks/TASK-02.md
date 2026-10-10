# TASK-02: Policy and regulation text extraction with clause search

## Goal
Turn the PDFs in `data/` into clauses (column-aware) and expose search, so the agent can find the clause that governs a deduction.

## Files to touch
- `backend/app/services/documents.py` (create)
- `backend/app/services/search.py` (create): small BM25 implementation (no extra dependency)
- `backend/app/routes/documents.py` (create), register in `backend/app/main.py` (modify)
- `backend/app/text.py` (create): `normalise(text) -> str`
- `backend/tests/test_documents.py` (create)
- `backend/requirements.txt` (modify: add `pymupdf`)

## Interface
- Document registry: `star_fho_v19`, `hdfc_optima_secure`, `niva_reassure2` (policies), `MC24`, `OMB17` (regulations); file paths from `data/policies/anchors.yaml` and `data/rules/rules.yaml`.
- `GET /documents`, `GET /documents/{doc_id}/clauses`, `POST /policy/search {doc_id, query, k}` → `Clause[]` (see systemPatterns).
- `normalise`: Unicode NFKC (fixes "ﬁ"), curly→straight quotes, `(\w)-\s+(\w)` → `\1-\2`, remove OMB17 amendment markers `1 [` and `]`, collapse whitespace, lowercase.
- Extraction: PyMuPDF `page.get_text("blocks")`, sort blocks by column (x0 < page_width/2 first) then y; split clauses at numbered headings / capitalised headings; keep `page`.

## Acceptance tests
1. `normalise("ﬁrst  non- disclosure “x”")` == `first non-disclosure "x"`.
2. Every `quote` in `data/policies/anchors.yaml` for `star_fho_v19` appears in the normalised concatenated text of that document.
3. `POST /policy/search` with `{doc_id:"star_fho_v19", query:"proportionate deduction associated medical expenses pharmacy implants"}` returns, in the top 3, a clause containing "do not include Cost of pharmacy".
4. `POST /policy/search` with query "moratorium eight continuous years" returns a clause containing "eight continuous years" in the top 3.
5. Unknown `doc_id` → 404.

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- Allowed dependencies: pymupdf

## Notes
Cache extracted clauses in memory at startup (PDFs are small). Hindi lines in MC24 can be skipped for search but must not break extraction.
- Base to build on: TASK-01 is merged (`backend/app/settings.py` gives `settings.data_dir`; tests import the app the same way as `backend/tests/test_cases.py`).
- Install into the existing venv: `cd backend && .venv/bin/pip install pymupdf`.
- If an anchor quote is not found, print the nearest extracted text around it before changing the extraction logic; do not edit `anchors.yaml` to make a test pass.
