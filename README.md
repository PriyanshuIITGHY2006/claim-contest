# Claim Contest

Contest an unfair health-insurance deduction, with the exact clause.

Indian settlement letters cut claims with one-line labels ("proportionate deduction", "non-payable items", "PED non-disclosure"). Claim Contest reads the case (settlement letter, itemised bill, policy) and, for every deduction, returns:
- a verdict: **valid**, **contestable** or **needs info**;
- verbatim quotes from the policy wording and IRDAI rules, each verified against the source text;
- the exact recoverable amount, computed by deterministic calculators, never by the model;
- a grievance letter, a plain-language summary (English, Hindi, Assamese) and the escalation path (insurer → Bima Bharosa → Insurance Ombudsman).

Self-help tool, not legal advice. All demo data is synthetic.

Built for the Cline AI Builders Hackathon, IIT Guwahati, by Priyanshu Debnath, Kaustav Bhowal and Sumedha Bhattacharya.

## Features
- **Deduction audit** with a live agent timeline and a verdict board; each row opens the verified quotes and the full rule text.
- **Citation gate:** a quote is shown only if it was verified against its source in the same run; a contestable amount must equal a calculator result; a regulation override must cite its rule.
- **Regulation override detection**, e.g. a policy's 8-year moratorium vs the 60-month limit in the IRDAI Master Circular 2024.
- **TAT clocks:** 1-hour cashless and 3-hour discharge limits, with the amount the insurer must bear.
- **Upload your own claim:** text PDFs of the settlement letter and bill are pre-filled by patterns (no model), confirmed by the user, then analysed.
- **Action centre:** tiered grievance letters with a human approval gate, deadlines as .ics.
- **Ombudsman precedents** (1,205 awards) and an evaluation harness that replays historical awards with the decision removed.
- **My claims** dashboard with saved results.

## Architecture
```
frontend/  Next.js 14 · Tailwind · shadcn/ui        → REST + SSE
agent/     Node 22 · Cline SDK (@cline/sdk) · fastify → 12 custom tools call the backend
backend/   FastAPI · SQLite · no model calls        → PDF search, rules, quote verifier, calculators
data/      policy wordings, IRDAI circulars, rules.yaml, Ombudsman award books, synthetic cases
```
Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · interfaces: [`memory-bank/systemPatterns.md`](memory-bank/systemPatterns.md) · Cline SDK usage: [`docs/CLINE_SDK.md`](docs/CLINE_SDK.md).

## How we used Cline
Every feature was built in Cline from a task spec (`tasks/TASK-NN.md`) with workspace rules (`.clinerules/`), a memory bank (`memory-bank/`), and `/start-task.md` / `/finish-task.md` workflows: Plan mode first, tests first in Act mode, cross-review before merge. The product's agent itself runs on the Cline SDK. Full record: [`docs/CLINE_USAGE.md`](docs/CLINE_USAGE.md) and one log per task in [`docs/cline-log/`](docs/cline-log/).

## Run it
Requirements: Python 3.11+, Node 22+.

1. `cp .env.example .env`. Keep `AGENT_MODE=scripted` to run without a model, or set `AGENT_MODE=llm` with `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`.
2. Backend: `cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/uvicorn app.main:app --port 8000`
3. Agent: `cd agent && npm install && npm run dev` (port 8100)
4. Frontend: `cd frontend && npm install && npm run dev` (port 3000)

Tests: `cd backend && .venv/bin/pytest -q` · `cd agent && npx vitest run` · `cd frontend && npx vitest run`

Uploaded claims need `AGENT_MODE=llm`; scripted mode replays the sample cases' expected results.
