# TASK-03: Rule base and quote verifier

## Goal
Load `data/rules/rules.yaml`, expose rules and search, and verify that any quoted text really exists in its source. This is the citation gate.

## Files to touch
- `backend/app/services/rules.py`, `backend/app/services/verify.py` (create)
- `backend/app/routes/rules.py` (create), register in `backend/app/main.py` (modify)
- `backend/tests/test_rules.py`, `backend/tests/test_verify.py` (create)

## Interface
- `GET /rules`, `GET /rules/{rule_id}`, `POST /rules/search {query,k}` (reuse BM25 from TASK-02 if merged; otherwise a local keyword scorer).
- `POST /verify-quote {source_type: "rule"|"policy", source_id, quote}` → `{verified, match, score, page}`.
  - rule: compare `normalise(quote)` against `normalise(rule.text)`; policy: against the normalised document text (TASK-02) or, if TASK-02 is not merged yet, against `anchors.yaml` quotes.
  - exact substring → `exact`, verified; else rapidfuzz `partial_ratio` ≥ 92 → `fuzzy`, verified; else `none`, not verified.
  - A rule with `verified: false` always returns `verified: false`.

## Acceptance tests
1. `GET /rules` returns 27 rules, all `verified: true`; `MC24-13` has `page` 23 and `overrides_policy` true.
2. Verifying the exact `MC24-17c` text returns `exact`, verified.
3. Verifying "Policyholder shall not be required to submit the documents" (a substring) returns verified.
4. Verifying "Policyholder must submit all documents within 7 days" returns `none`, not verified.
5. With a test fixture rule marked `verified: false`, verification always returns not verified.
7. Verifying the clean text of `PPI24-B-VI-3-i` against its Part B source (OCR artefacts) returns `fuzzy`, verified.
6. `POST /rules/search {query:"discharge three hours delay hospital charges"}` returns `MC24-16b` in the top 3.

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- Allowed dependencies: rapidfuzz
