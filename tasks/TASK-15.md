# TASK-15: Evaluation harness and Ombudsman replay

## Goal
Measure agreement with real Ombudsman decisions and offer a "replay an Ombudsman case" demo with the outcome hidden.

## Files to touch
- `backend/app/services/precedents.py` (modify: add `get_precedent(precedent_id)` returning the parsed award with its full `text`; no change to parsing or search)
- `backend/app/routes/precedents.py` (modify: `GET /precedents/{precedent_id}` → `PrecedentDetail`, 404 for an unknown id)
- `backend/app/models/schemas.py` (modify: add `PrecedentDetail` = `Precedent` fields without `score`, plus `text`)
- `backend/app/routes/eval.py` (create): `GET /eval/awards`; register in `backend/app/main.py` (modify)
- `backend/tests/test_eval.py`, `backend/tests/test_precedent_detail.py` (create)
- `data/eval/candidates.csv` (create, generated): candidate awards for labelling (see "Labels")
- `data/eval/awards.csv` (modify: rows confirmed by a person, see "Labels")
- `agent/src/backend.ts` (modify: `getPrecedent(id)`)
- `agent/src/replay.ts` (create): decision removal, case-like input, label mapping, agreement metric
- `agent/src/server.ts` (modify: `POST /replay/:precedent_id`; keep other routes untouched)
- `agent/src/gate.ts` (modify: for `replay:` cases skip only the recoverable-amount check, so a contestable verdict with `recoverable_amount: 0` is accepted; every citation check still applies) and a test in `agent/test/gate.test.ts`
- `agent/src/llm/agent.ts`, `agent/src/llm/tools.ts` (modify: optional case override so `get_case` returns the in-memory replay case for its id; default behaviour unchanged) and one test for it
- `agent/scripts/eval.ts` (create): runs all labelled awards, prints agreement and citation-verification rate
- `agent/scripts/candidates.ts` (create): writes `data/eval/candidates.csv`
- `agent/test/replay.test.ts` (create)
- `memory-bank/systemPatterns.md` (modify: add the `GET /precedents/{precedent_id}` row)

## Interface
- `GET /precedents/{precedent_id}` → `{ precedent_id, book, case_no, year, excerpt, outcome, text }`. Ids look like `<book>#<n>`, so clients send them URL-encoded (`encodeURIComponent`, `#` → `%23`).
- `GET /eval/awards` → the rows of `data/eval/awards.csv` as JSON objects (all columns; empty list when there are no rows).
- `POST /replay/:precedent_id` → `{ analysis_id }`; the analysis streams on the existing `/analyses/:id/events`.
- Replay input: a `Case`-shaped object with `case_id = "replay:<precedent_id>"`, one deduction `{ deduction_id: "D1", label: "Claim repudiated or reduced", amount: 0, line_ids: [], insurer_reason: "" }`, empty bill, empty timeline, empty `expected`, and `settlement.letter_text` = the award text with the decision removed. The `policy` block names no real insurer product (`product: "Unknown (historical award)"`).
- Label mapping for agreement: award `allowed` or `partly` ↔ verdict `contestable`; award `dismissed` ↔ verdict `valid`; `needs_info` counts as a miss.

## Labels (a person decides; never the model)
1. `agent/scripts/candidates.ts` searches `POST /precedents/search` with grounds matching the sample cases (proportionate / room rent, non-disclosure / pre-existing disease, waiting period, documents not submitted, cashless delay), takes about 25 distinct awards, and writes `data/eval/candidates.csv` with `precedent_id, ground, keyword_outcome, excerpt`. `keyword_outcome` is the backend's keyword guess and is only a hint.
2. A teammate reads the end of each candidate award (`GET /precedents/{id}`) and copies 10–15 rows into `data/eval/awards.csv` with the outcome they read (`allowed | partly | dismissed`), the ground and a short note. Mix outcomes; include some `dismissed`.
3. The implementer must not fill `awards.csv` from `keyword_outcome` or from model output. If fewer than 10 rows are confirmed when the task ends, ship with what exists and say so in the log.

## Acceptance tests (no model calls)
1. Decision removal strips paragraphs containing "award", "dismissed", "allowed", "directed to pay" (case-insensitive) and keeps the others in order.
2. Agreement metric: given predictions and labels, returns correct accuracy, the majority-class baseline and the counts per label.
3. `GET /eval/awards` returns the CSV rows as JSON (fixture CSV via `tmp_path`/settings, plus empty CSV → `[]`).
4. `GET /precedents/{id}` returns the full text for a real id (URL-encoded `#`) and 404 for an unknown id.
5. `buildReplayCase(precedent)` produces a case that validates against the agent's case schema, with the decision paragraphs absent from `letter_text`.

## Do not
- touch files not listed above
- add dependencies (none needed)
- change existing interfaces other than adding the routes above (update `systemPatterns.md` first)
- run `scripts/eval.ts` in tests; it calls the model and spends credits

## Notes
- Awards are 2003–2014 (pre-2024 rules); report results as "agreement on historical awards", never as current accuracy.
- `scripts/eval.ts` runs one real analysis per labelled award (about 10–15 model runs); run it once at the end with `AGENT_MODE=llm` and paste its summary into the log.
