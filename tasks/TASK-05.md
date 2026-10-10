# TASK-05: Ombudsman precedent finder

## Goal
Split the six award books in `data/` into individual awards and make them searchable, so a verdict can show "similar Ombudsman cases".

## Files to touch
- `backend/app/services/precedents.py` (create)
- `backend/app/routes/precedents.py` (create), register in `backend/app/main.py` (modify)
- `backend/tests/test_precedents.py` (create)
- `data/eval/awards.csv` (create, header only + rows added by the demo owner)

## Interface
- Books: `Mediclaim-Book3.pdf`, `Mediclaim-Book9.pdf`, `Mediclaim-Book17.pdf`, `Mediclaim-Book20.pdf`, `GroupMediclaim-Book11.pdf`, `GroupMediclaim-Book17.pdf`.
- Split at lines matching `^\s*(G\.?\s*I\.?\s*)?(Case|Complaint)\s*No\.?\s*[:.\-]?\s*\S` (case-insensitive). Case numbers use dashes, dots or slashes (`14-003-0583-12`, `11.004.0216`, `IO/KCH/GI/10-004-223/2011-12`). If a header line follows another header line within 3 lines, it belongs to the same award (some awards print both a Case No. and a Complaint No.). Drop exact duplicate awards (same `case_no` and same first 200 characters of text; GroupMediclaim-Book17 repeats awards). `precedent_id` = `<book>#<n>`, `case_no` (the text after "No." on the first header line), `year` = most frequent 4-digit year 2000–2016 in the award text, `excerpt` = first 600 chars after the header, `outcome` best-effort from keywords ("dismissed", "allowed", "partly") or null.
- `POST /precedents/search {query,k}` → `Precedent[]` (BM25 from TASK-02).
- `awards.csv` columns: `precedent_id,ground,outcome,rule_relevance,notes`.

## Acceptance tests
1. At least 800 awards are parsed in total across the six books after de-duplication (a pdftotext count finds about 1,195 unique header lines, some of which belong to the same award), and no book yields zero.
2. Every precedent has a non-empty `case_no` and `excerpt`.
3. Searching "room rent proportionate deduction" returns k results with score > 0.
4. Searching "pre-existing disease non-disclosure" returns at least one excerpt containing "pre-existing" or "PED".

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- No new dependencies

## Notes
Awards are 2003–2014 and predate the 2024 rules; the UI must show the year.
- Extract text with PyMuPDF the same way as `app/services/documents.py` (reuse its helpers where sensible) and rank with `app.services.search.BM25Index` over `app.text.normalise`d text.
- Header formats vary by book; print per-book counts while developing. Do not lower the test thresholds to make tests pass; fix the splitter.
- Cache parsed awards per process (like documents).
