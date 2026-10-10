import type { AgentEvent } from "@/lib/api"

/** Plain-language description of what each agent tool is doing, for people who are not lawyers. */
const FRIENDLY: Record<string, string> = {
  get_case: "Reading your settlement letter and itemised bill",
  search_policy: "Searching your policy wording for the clause behind this deduction",
  search_rules: "Looking up the IRDAI rules that protect you",
  get_rule: "Reading the full text of an IRDAI rule",
  verify_quote: "Checking this quote word-for-word against the original document",
  calc_proportionate: "Recomputing the room-rent cut with exact arithmetic",
  calc_waiting_period: "Counting how many months your policy has been in force",
  calc_tat: "Timing how long the insurer took to approve",
  calc_deadlines: "Working out your complaint deadlines",
  find_precedents: "Finding similar cases decided by the Insurance Ombudsman",
  classify_npi: "Checking items against the policy's non-payable list",
  check_bill: "Checking the hospital bill's arithmetic",
  submit_verdicts: "Writing up the verdict for each deduction",
}

export function friendlyStep(tool: string | null): string | null {
  return tool ? (FRIENDLY[tool] ?? null) : null
}

export const STAGES = [
  "Reading your claim",
  "Finding policy clauses",
  "Checking IRDAI rules",
  "Verifying every quote",
  "Calculating your amount",
] as const

const STAGE_OF: Record<string, number> = {
  get_case: 0,
  search_policy: 1,
  search_rules: 2,
  get_rule: 2,
  find_precedents: 2,
  verify_quote: 3,
  calc_proportionate: 4,
  calc_waiting_period: 4,
  calc_tat: 4,
  calc_deadlines: 4,
  classify_npi: 4,
  check_bill: 4,
  submit_verdicts: 4,
}

function toolOf(event: AgentEvent): string | null {
  const data = event.data as { tool?: unknown } | undefined
  return typeof data?.tool === "string" ? data.tool : null
}

/** The furthest stage the agent has reached so far (0-based), from the tools it has called. */
export function stageReached(events: readonly AgentEvent[]): number {
  return events.reduce((stage, event) => Math.max(stage, STAGE_OF[toolOf(event) ?? ""] ?? 0), 0)
}

/** How many quotes have passed the word-for-word check so far. */
export function quotesVerified(events: readonly AgentEvent[]): number {
  return events.filter((event) => (event.data as { verified?: unknown } | undefined)?.verified === true).length
}

export const TIPS = [
  "After 60 months of continuous cover, an insurer cannot reject a claim for non-disclosure unless there was fraud (IRDAI Master Circular 2024, para 13).",
  "Final discharge approval must come within 3 hours of the hospital's request; extra charges after that are the insurer's to bear (para 16).",
  "A rejection or deduction letter must cite the specific policy terms it relies on (para 17).",
  "The Insurance Ombudsman is free and handles complaints up to Rs 50 lakh, within one year of the insurer's final reply.",
  "Every quote you see here has been checked word-for-word against the original document.",
  "Every rupee amount is computed by code, never guessed by the AI.",
] as const
