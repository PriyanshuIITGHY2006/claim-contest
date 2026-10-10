# System patterns

Diagrams and the record of what was merged from the two architecture proposals: `docs/ARCHITECTURE.md`.

## Architecture

```
┌──────────────────── frontend/ (Next.js, port 3000) ────────────────────┐
│ Start · Live analysis · Verdict board · Policy X-ray · Clocks ·        │
│ Action centre · Compare                                                │
└──────────┬───────────────────────────────────────────▲─────────────────┘
           │ REST (lib/api.ts)                         │ SSE (agent events)
┌──────────▼──────────────────┐   tool calls   ┌───────┴─────────────────┐
│ backend/ (FastAPI, :8000)   │◄───────────────┤ agent/ (Node 22, :8100) │
│ cases · documents/clauses · │     (REST)     │ Cline SDK Agent +       │
│ rules · quote verifier ·    │                │ custom tools; streams   │
│ calculators · precedents ·  │                │ steps; validates result │
│ deadlines                   │                └─────────────────────────┘
└─────────────────────────────┘
        reads data/ (PDFs, rules.yaml, anchors.yaml, cases/*.json)
```

- The frontend reads case data and evidence from the backend, and starts/streams analyses from the agent service.
- The agent service is the only place that imports `@cline/sdk` (the LLM client). It never computes money or dates itself.
- The backend has no LLM calls. It owns parsing, search, verification and all arithmetic.

## Key decisions (and why)

- **Code vs model.** Code: PDF text, clause search, quote verification, proportionate deduction, waiting period/moratorium, TAT breaches, deadlines, totals. Model: interpreting deduction labels, choosing clauses/rules, verdict status, explanations, letters. Reason: models hallucinate citations and slip on arithmetic; verdicts must be checkable.
- **Citation gate.** A verdict is accepted only if every citation passed `POST /verify-quote` and every rupee amount came from a calculator result. Otherwise the agent must retry; after 2 failures the deduction becomes `needs_info`.
- **Regulation over policy.** Rules with `overrides_policy: true` win over policy wording (MC24-13 vs the Star policy's 8-year moratorium).
- **Proportionate deduction rests on the policy wording.** The 2020 standardisation and product-filing circulars (IRDAI/HLT/REG/CIR/193/07/2020, /151/06/2020) are repealed by MC24 Annexure-6, so the "not on pharmacy, consumables, implants, diagnostics" protection is cited from each policy's own definition of associated medical expenses (Star FHO has it), not from a regulation.
- **Only verified rules are citable.** Rules with `verified: false` appear as "needs verification".
- **Sample cases first.** The demo runs on `data/cases/*.json`; a user can also upload a settlement letter and bill (text PDFs), confirm the pre-filled details, and analyse the resulting `user_*` case (stored as JSON in the SQLite `cases` table; the PDFs themselves are never stored).
- **Persistence.** SQLite (`backend/app/db.py`, stdlib `sqlite3`) stores cases, analyses, verdicts, flags, drafts and ladder steps; the agent posts its accepted result to the backend.
- **Confidence and drafting threshold.** Each verdict carries `confidence` (0–1). A contestable deduction goes into the grievance only if `confidence >= 0.75`; lower ones are shown as "review".
- **Human approval gate.** Tier 1 draft is shown immediately; Tier 2/3 drafts are shown only after the user sets `human_approved` on the Tier 1 draft.
- **Escalation ladder.** Tier 1 insurer GRO (14 days, PPI24-B-VI-2-i) → Tier 2 Bima Bharosa → Tier 3 Ombudsman (within one year, up to Rs 50 lakh, free; OMB17-14-3a/3b, PPI24-B-VI-3-i/ii).
- **Non-payable items.** Classified by deterministic matching against the policy's own annexure lists (items subsumed into room / procedure charges / costs of treatment), not the repealed 2020 IRDAI lists.
- **Precedents.** The six award books are split at `Case No` headers into individual awards (about 1,170); search is keyword/BM25 over those.

## Data model (JSON field names are snake_case everywhere)

```
BillLine     { line_id, date, particulars, category, rate, units, amount }
             category ∈ room | nursing | professional_fee | ot | procedure | pharmacy |
                        consumables | implant | diagnostics | non_medical
Deduction    { deduction_id, label, amount, line_ids: string[], insurer_reason }
Case         { case_id, title, synthetic_notice, policy: PolicyRef, patient, admission,
               bill: { lines: BillLine[], total }, settlement: { claimed, approved,
               total_deducted, deductions: Deduction[], letter_text },
               timeline: TatEvent[], expected: ExpectedVerdict[] }
Patient      { name, age }
Admission    { hospital, admitted: ISO datetime, discharged: ISO datetime, diagnosis, room_category, cashless: boolean }
ExpectedVerdict { deduction_id, status: valid | contestable | needs_info, recoverable: number, basis: string[] }
PolicyRef    { doc_id, file, product, uin, version, schedule: { sum_insured, inception_date,
               eligible_room_rent_per_day?, continuous_coverage?, declared_conditions? } }
TatEvent     { event: cashless_request | cashless_decision | discharge_request |
               final_authorisation, at: ISO datetime }
Clause       { clause_id, doc_id, heading, text, page }
Rule         { id, doc, para, page, verified, ground, text, test, overrides_policy?, limit_minutes? }
Citation     { source_type: "policy" | "rule", source_id, quote, verified: boolean }
Verdict      { deduction_id, status: valid | contestable | needs_info, recoverable_amount,
               reasoning, citations: Citation[], calculation?: CalcResult,
               confidence: number, regulation_override?: { policy_says, law_says, rule_id },
               include_in_grievance?: boolean }   (set by the TASK-08 gate: false for
               contestable verdicts with confidence < 0.75)
Precedent    { precedent_id, book, case_no, year?, excerpt, outcome?, score }
Analysis     { analysis_id, case_id, status: running | done | error, verdicts: Verdict[],
               total_recoverable, flags: Flag[], started_at, finished_at }
Flag         { kind: tat_breach | letter_not_specific | regulation_override, rule_id, detail }
Draft        { draft_id, analysis_id, tier: 1 | 2 | 3, language: en | hi | as, letter_markdown,
               local_summary, human_approved: boolean }
LadderStep   { tier, stage, earliest, latest, rule_id, completed }
NpiResult    { line_id, list: room | procedure | treatment | none, matched_item?: string | null (null when list is none), payable_separately }
BillCheck    { line_id?, issue: line_math | total_mismatch | duplicate | above_price_cap, expected, found }
AgentEvent   { seq, type: step | tool_call | tool_result | verdict | done | error,
               message, data?, at }
```

## Interfaces

### Backend (FastAPI, `http://localhost:8000`)

| Method & path | Request | Response |
|---|---|---|
| GET `/health` | — | `{ status: "ok" }` |
| GET `/cases` | — | `{ id, title, summary }[]`: the five samples first, then uploaded cases (SQLite), newest first |
| GET `/cases/{case_id}` | — | `Case`; `user_*` ids are looked up in SQLite only (never a file path); 404 unknown |
| GET `/documents` | — | `{ doc_id, title, kind: policy|regulation|award_book, pages }[]` |
| GET `/documents/{doc_id}/clauses` | — | `Clause[]` |
| POST `/policy/search` | `{ doc_id, query, k=5 }` | `Clause[]` |
| GET `/rules` | — | `Rule[]` |
| GET `/rules/{rule_id}` | — | `Rule` |
| POST `/rules/search` | `{ query, k=5 }` | `Rule[]` |
| POST `/verify-quote` | `{ source_type, source_id, quote }` | `{ verified, match: exact|fuzzy|none, score, page? }` (fuzzy threshold 92) |
| POST `/calc/proportionate` | `{ eligible_room_rent, actual_room_rent, days, lines: BillLine[], exempt_categories?, deduction?: { amount, line_ids } }` | `{ ratio, room_difference, associated_total, exempt_total, correct_deduction, per_line: { line_id, category, associated, deduction }[], recoverable_amount: number \| null }` — `recoverable_amount` = `max(0, deduction.amount − Σ correct per_line deduction on deduction.line_ids)`; use it only for proportionate-deduction items (non-payable items are judged separately) |
| POST `/calc/waiting-period` | `{ inception_date, event_date, policy_months, regulation_months? }` | `{ months_completed, applicable_months, elapsed, overridden }` |
| POST `/calc/tat` | `{ requested_at, decided_at, limit_minutes }` | `{ elapsed_minutes, limit_minutes, breached, over_by_minutes }` |
| POST `/calc/deadlines` | `{ decision_date, grievance_sent_on? }` | `{ steps: { stage, earliest, latest, rule_id, note }[] }` |
| POST `/precedents/search` | `{ query, k=3 }` | `Precedent[]` |
| GET `/precedents/{precedent_id}` | — (id URL-encoded, `#` → `%23`) | `{ precedent_id, book, case_no, year, excerpt, outcome, text }` (full award text; 404 if unknown) |
| POST `/classify/npi` | `{ doc_id, lines: BillLine[] }` | `NpiResult[]` (one per line, same order; only `non_medical`/`consumables`/`pharmacy` lines are matched, others return `list: none`; 404 when the doc_id has no NPI list) |
| POST `/calc/bill-check` | `{ lines: BillLine[], printed_total? }` | `BillCheck[]` (empty = consistent) |
| POST `/analyses` | `Analysis` (from the agent) | `{ analysis_id }` (stored) |
| GET `/analyses/{id}` | — | `Analysis` |
| GET `/analyses?case_id=<optional>` | — | `AnalysisSummary[]` = `{ analysis_id, case_id, status, total_recoverable, finished_at }[]`, newest first (`finished_at` desc, nulls last, then insertion order desc); filtered by `case_id` when given; `[]` when nothing matches |
| POST `/drafts` · GET `/drafts/{id}` · PATCH `/drafts/{id}` | `Draft` · — · `{ human_approved }` | `Draft`. POST always stores `human_approved: false`; 404 unknown `analysis_id`; **409** if the `draft_id` already exists (never overwritten); **409** for tier 2/3 unless a tier-1 draft of the same analysis has `human_approved: true`. `POST /analyses` returns 201 and is idempotent per `analysis_id`; 422 if `total_recoverable` differs from Σ verdict `recoverable_amount` by more than 1 paise, or `deduction_id`s repeat; verdicts/flags come back in posted order |
| POST `/cases/upload` | multipart: `settlement_pdf`, `bill_pdf` (text PDFs, `%PDF` header, max 10 MB each), form field `doc_id` (a registered policy) | `CaseDraft { doc_id, claimed?, approved?, deductions: Deduction[], bill_lines: BillLine[], letter_text, warnings: string[] }`; not stored. 422: not a PDF, over 10 MB, no text layer ("Scanned documents are not supported yet; please upload a text PDF"), unknown `doc_id`. Regex pre-fill only; no model calls |
| POST `/cases` | `NewCase { doc_id, schedule, patient, admission, bill_lines, deductions, claimed, approved, letter_text, timeline? }` | 201 `{ case_id }` (`user_` + 8 hex). Stored in SQLite as a full `Case` (`expected: []`, `bill.total` = Σ lines, `settlement.total_deducted` = Σ deductions). 422 for a deduction naming an unknown line, `approved > claimed`, or a deduction amount above the bill total |
| GET `/eval/awards` | — | every row of `data/eval/awards.csv` as an object with all its columns (`precedent_id, ground, outcome, rule_relevance, notes`); `[]` when there are no rows |

Defaults: `exempt_categories` = `["pharmacy","consumables","implant","diagnostics"]`; associated = `["nursing","professional_fee","ot","procedure"]` (Star FHO folds nursing into room). Money is rounded to 2 decimals.

### Agent service (Node, `http://localhost:8100`)

| Method & path | Request | Response |
|---|---|---|
| GET `/health` | — | `{ status: "ok" }` |
| POST `/analyses` | `{ case_id }` | `{ analysis_id }` |
| GET `/analyses/{id}/events` | — | SSE stream of `AgentEvent` (ends with `done` or `error`) |
| GET `/analyses/{id}` | — | `Analysis` |
| POST `/analyses/{id}/draft` | `{ tier: 1 | 2 | 3, language: en | hi | as }` | `Draft` (saved via backend; tier 2/3 refused until tier 1 `human_approved`) |
| POST `/replay/{precedent_id}` | — | `{ analysis_id }`: runs the agent on an Ombudsman award with the decision removed (case id `replay:<precedent_id>`; `#` sent as `%23`). 404 unknown id, 422 `skipped: too little text after redaction` (under 300 characters), 502 backend failure. Replay verdicts recover 0; scripted mode ends with no verdicts |
| GET `/baseline/{case_id}` | — | `{ answer_markdown, errors: { claim, why_wrong }[] }` (recorded plain-chatbot answer from `data/baseline/`) |

### Agent tools (each wraps one backend call; all `autoApprove: true`, read-only)

`get_case`, `search_policy`, `search_rules`, `get_rule`, `verify_quote`, `calc_proportionate`, `calc_waiting_period`, `calc_tat`, `calc_deadlines`, `classify_npi`, `check_bill`, `find_precedents`, `submit_verdicts` (final structured output, validated with zod), `draft_grievance`.
