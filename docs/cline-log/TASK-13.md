# TASK-13 — Non-payable item classifier and bill arithmetic check

Branch: `task-13-npi-bill-check` · Owner: PriyanshuIITGHY2006

**Built:** Two deterministic bill checks in `backend/`. No new dependencies (`rapidfuzz` and `app.text.normalise` come from TASK-03).
- `data/policies/npi/star_fho_v19.yaml`: the three annexure lists (page 16 of the Star FHO wording), rebuilt once from the PDF text with the TASK-02 extraction helpers. The numbered two-column table was reassembled by serial number and the script refused to write unless the counts were exactly 37 room / 23 procedure / 18 treatment (they were). The YAML is loaded at runtime; the PDF is never parsed per request.
- `app/services/npi.py` + `POST /classify/npi`: only `non_medical`, `consumables` and `pharmacy` lines are classified; the best list item with `token_set_ratio` >= 85 on `normalise()`d text wins. Subset-match guard: a match also needs a shared non-generic token (generic set: charges, charge, fee, fees, expense, expenses, cost, costs, item, items, other, others, misc, miscellaneous), so "Other charges" is `none` while "Documentation charges" still matches room. `doc_id` is validated against `^[a-z0-9_]+$` before it touches a path; no list (or an unsafe id) -> 404.
- `app/services/bill_check.py` + `POST /calc/bill-check`: `line_math` (rate x units vs amount, +-0.01), `total_mismatch` (vs `printed_total`, +-0.01), `duplicate` (same date, particulars, amount; names every repeat after the first), `above_price_cap` (stent per-unit rate strictly above the NPPA ceiling; drug-eluting 39,186.03, bare-metal 10,762.15 as named constants with the S.O. 1587(E) source). All arithmetic in `Decimal`.
- `app/routes/checks.py` holds both routes and their request models; registered in `app/main.py`.
- `NpiResult.matched_item` is now `str | None` in `schemas.py` (the spec returns null when nothing matches); `memory-bank/systemPatterns.md` was updated first, plus a note on `/classify/npi` behaviour.

**Cline usage:**
- **Plan/Act:** Plan mode first: claimed the task, read the memory bank, `TASK-13.md`, the schemas, the document extractor and the agent's tool list, and inspected the PDF annexure. The plan raised one decision (`matched_item` nullability) and a risk (`token_set_ratio` scores 100 for any subset). The user approved, chose option A and specified the generic-token guard, then Act mode implemented tests-first.
- **Workflows:** `/start-task.md` (claim committed and pushed to `main`, branch `task-13-npi-bill-check`, plan-first) and `/finish-task.md`.
- **Built-in tools/commands:** `read_files`, `search_codebase`, `editor` (large test file written in chunks), `run_commands` (git, throwaway extraction and probe scripts, pytest).
- **MCP tools:** none used.

**Tests:** `backend/tests/test_npi.py` (7) and `backend/tests/test_bill_check.py` (15) — written first and run red (21 failed, 1 passed: no endpoints yet), then green; full backend suite `97 passed`.
- Acceptance 1–8: case A admission kit and documentation charges -> room, medicines -> none, 100 x 3 billed 400 -> `line_math` expected 300, case A with its printed total -> no issues, a stent at 45,000 -> `above_price_cap` expected 39186.03, case A's stent at exactly 39,186.03 -> no issue (inclusive), duplicate names the second line, no NPI list -> 404.
- Extra: category restriction (a surgeon's fee is never classified), subset-match guard (including `_shares_specific_token` unit cases), bare-metal ceiling by "bare metal" or "BMS", per-unit cap on a two-stent line, three identical lines flag the second and third, path-traversal doc_id -> 404.
- Sanity run over all five sample cases: no false bill-check issues; only case A's admission kit and documentation lines match an NPI list.

**Checkpoint restores:** 0

**Review fixes:**
- No code fixes to the TASK-13 files. At merge the agent's `PENDING_BACKEND` set in `agent/src/llm/tools.ts` was emptied, so `classify_npi` and `check_bill` are now in `AVAILABLE_TOOLS` (12 tools); the TASK-07 tool-list test was updated to expect them. 49 agent tests pass.
- Review checks that held: all 78 list items (37/23/18) appear verbatim in the policy PDF text; correct matches for "Hand wash" (room), "Registration charges" and "Diet charges" (treatment); no classification for a surgeon's fee, bare "Charges", "Room service charges", "Medicine charges" or "Food and beverages"; a path-traversal `doc_id` returns 404; a bare-metal stent above Rs 10,762.15 is flagged while two drug-eluting stents at exactly the ceiling are not; a rate x units error is caught; a correct printed total passes. 97 backend tests pass.
- Known limitation: the policy spells "PULSEOXYMETER CHARGES" as one word, so a bill line "Pulse oximeter charges" returns `none`.

**Assumptions / limitations:**
- Only Star FHO has an NPI list; HDFC Optima Secure and Niva ReAssure return 404 until their lists are extracted.
- Matching is wording-based: misspellings or abbreviations that share no whole word with a list item (e.g. "Admn kit") are not matched.
- Guide wire and balloon catheter (consumables) is `none`: the Star lists do not name it, so it stays payable separately.
- `duplicate` flags exact repeats only; a legitimately repeated charge (same day, same amount) will also be flagged and needs the user's judgement.
- `agent/src/llm/tools.ts` still lists `classify_npi` and `check_bill` as `PENDING_BACKEND`; the merger flips that (kept out of this task's scope on purpose).
