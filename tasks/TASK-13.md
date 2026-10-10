# TASK-13: Non-payable item classifier and bill arithmetic check

## Goal
Two deterministic checks the agent calls on every bill: which lines the policy folds into other charges, and whether the hospital's arithmetic is right.

## Files to touch
- `backend/app/services/npi.py`, `backend/app/services/bill_check.py` (create)
- `backend/app/routes/checks.py` (create), register in `backend/app/main.py` (modify)
- `data/policies/npi/star_fho_v19.yaml` (create): the three lists from the Star policy annexure ("ITEMS THAT ARE TO BE SUBSUMED INTO ROOM CHARGES / PROCEDURE CHARGES / COSTS OF TREATMENT"), extracted from the PDF text
- `backend/tests/test_npi.py`, `backend/tests/test_bill_check.py` (create)

## Interface
- `POST /classify/npi {doc_id, lines}` → `NpiResult[]`: rapidfuzz `token_set_ratio` ≥ 85 between `particulars` and list items; `payable_separately` false when matched.
- `POST /calc/bill-check {lines, printed_total?}` → `BillCheck[]`: `rate*units != amount` (±0.01), sum ≠ printed total, exact duplicate lines (same date, particulars, amount), stent above its NPPA ceiling.
- Stent ceilings (per stent, exclusive of GST, from 1 Apr 2026; NPPA S.O. 1587(E), revision under DPCO 2013 Schedule-I Sl. No. 28): drug-eluting (incl. bioresorbable) Rs 39,186.03; bare-metal Rs 10,762.15. Keep them as named constants with that source in a comment. A line is a stent when its `category` is `implant` and `particulars` contains "stent"; it is bare-metal when it also contains "bare metal" or "BMS", otherwise drug-eluting. Flag only when `rate` (per unit, before GST) is strictly above the ceiling; `expected` = ceiling, `found` = rate.
- NPI matching: compare `normalise()`d text (from `app.text`); a line matches the best-scoring list item if `token_set_ratio` ≥ 85, else `list: none`, `matched_item: null`, `payable_separately: true`. Only `non_medical`, `consumables` and `pharmacy` lines are classified; other categories return `list: none` (a surgeon's fee is never a non-payable item).
- Extract the three lists from the PDF text with `app.services.documents` helpers into the YAML once; the YAML is committed and loaded at runtime (do not parse the PDF per request). Unknown `doc_id` (no YAML) → 404.

## Acceptance tests
1. Case A "Admission kit" and "Documentation charges" → list `room`, not payable separately.
2. Case A "Pharmacy - medicines" → list `none`.
3. A line with rate 100, units 3, amount 400 → `line_math` issue with expected 300.
4. Case A lines with printed_total 260586.03 → no issues.
5. A stent line at 45,000 → `above_price_cap` with expected 39186.03.
6. Case A's stent at exactly 39,186.03 → no `above_price_cap` issue (the cap is inclusive).
7. Two identical lines (same date, particulars, amount) → one `duplicate` issue naming the second line.
8. `/classify/npi` for a doc_id without an NPI list → 404.

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- No new dependencies (rapidfuzz comes from TASK-03; if not merged yet, add it here)
