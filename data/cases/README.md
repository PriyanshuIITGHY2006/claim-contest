# Synthetic test cases

All cases are **synthetic**: fictional people, hospitals and amounts. Regenerate with `python3 data/cases/build_cases.py`; amounts are computed by the script, never typed by hand.

| Case | Policy | Situation | Expected outcome |
|---|---|---|---|
| `case_a` | Star FHO V.19 | Deluxe room (Rs 8,000/day) above Rs 5,000 eligibility; insurer applied the proportionate cut to every head | D3 contestable: **Rs 40,719.76** (pharmacy, consumables, stent, diagnostics are not associated medical expenses). D1, D2, D4 valid. Letter lacks specific clause (MC24-17b) |
| `case_b` | Star FHO V.19 | Repudiated for undisclosed hypertension after 7 years 5 months of cover; letter relies on the policy's 8-year moratorium | Contestable: **Rs 1,10,000** (MC24-13 and IPR24-S3-8: 60 months overrides the policy wording) |
| `case_c` | Star FHO V.19 | Control: declared diabetes, 18 months of cover | **Valid** rejection. The policy's 48 months is capped at 36 (IPR24-PED36) but has not elapsed either way |
| `case_d` | HDFC ERGO Optima Secure | Final discharge authorisation 5h30m after request; Rs 3,750 retention charges deducted; cashless decision took 2h15m | Contestable: **Rs 3,750** (MC24-16a/b). Cashless TAT breach recorded (MC24-15b). Letter lacks specific clause (MC24-17b) |
| `case_e` | HDFC ERGO Optima Secure | Cashless claim closed because the insured did not submit indoor case papers | Contestable: **Rs 67,000** (MC24-17c; PPI24-B-V-1-ii: no claim rejected or closed for want of documents) |

Each JSON file has `policy`, `patient`, `admission`, `bill.lines` (with `category`), `settlement.deductions`, `timeline` (TAT events) and `expected` verdicts with the rule or policy anchor IDs from `data/rules/rules.yaml` and `data/policies/anchors.yaml`.

Line categories: `room`, `nursing`, `professional_fee`, `ot`, `procedure` (associated medical expenses), `pharmacy`, `consumables`, `implant`, `diagnostics` (not associated), `non_medical`.
