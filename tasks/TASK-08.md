# TASK-08: Agent orchestration and citation gate

## Goal
The real analysis: the agent works through every deduction with the tools, then submits structured verdicts that pass the citation gate.

## Files to touch
- `agent/src/llm/agent.ts` (create): builds the `Agent` (settings from env), system prompt, `submit_verdicts` tool
- `agent/src/llm/prompt.ts` (create)
- `agent/src/gate.ts` (create): pure function `acceptVerdicts(case, verdicts, verifications, calcResults)`
- `agent/src/runner.ts` (create): runs the agent for an analysis, maps SDK events to `AgentEvent`s, retries rejected verdicts (max 2, then `needs_info`)
- `agent/src/server.ts` (modify: `AGENT_MODE=llm` uses `runner.ts`, `scripted` keeps TASK-06)
- `agent/test/gate.test.ts` (create)

## Interface
- System prompt essentials: one verdict per deduction plus flags; cite only verified rules and policy text found via tools; quote verbatim; never state an amount that did not come from a calc tool; prefer regulation over policy when `overrides_policy`; say `valid` when the insurer is right; check the letter for MC24-17b and the timeline with `calc_tat`.
- `submit_verdicts` input = `{ verdicts: Verdict[], flags: Flag[] }` (zod); every verdict has `confidence` 0–1.
- Citations must be checked by the backend `POST /verify-quote` (TASK-03), never re-implemented in the agent. The gate (`backend/app/services/verify.py`) rejects quotes that start right after a negation or change words, numbers or order, but a verified quote can still stop before a trailing exception ("... except for established fraud"). So every citation shown to the user carries the full rule or clause text (`GET /rules/{id}`, or the clause from `POST /policy/search`) next to the quote.
- The agent never sees a case's `expected` verdicts (the answer key): use only the `get_case` tool output, which strips them, and never put case JSON from disk into the prompt.
- After the gate passes, POST the `Analysis` to the backend `/analyses` (TASK-14) if available; keep the in-memory copy either way.

## Acceptance tests (no model calls)
1. Gate rejects a verdict whose citation has `verified: false`.
2. Gate rejects a contestable verdict whose `recoverable_amount` does not equal a value returned by a calc tool in this analysis (for proportionate cuts, the `recoverable_amount` that `/calc/proportionate` returns when given the insurer's deduction).
3. Gate accepts case A expected verdicts built from real calc results.
4. Gate rejects verdicts missing a deduction of the case.
5. Gate marks contestable verdicts with `confidence < 0.75` as `include_in_grievance: false`.
6. Gate rejects a citation whose quote is verified but whose `source_id` differs from the rule or clause the verdict relies on (citation must support the verdict it is attached to).
7. Event mapping: an SDK `tool-started` event becomes an `AgentEvent` of type `tool_call` with the tool name.

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- No new dependencies
