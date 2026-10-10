import { z } from "zod"
import type { AnalysisStore } from "./store.js"
import type { Case, Verdict, VerdictStatus } from "./types.js"

/**
 * Ombudsman replay (TASK-15): an award with its decision removed becomes a
 * Case-shaped input for the agent, and the agent's verdict is compared with the
 * outcome a person read from the award. Pure functions only; no SDK, no model.
 */

export const REPLAY_CASE_PREFIX = "replay:"
export const MIN_REPLAY_CHARS = 300

export const isReplayCaseId = (caseId: string): boolean => caseId.startsWith(REPLAY_CASE_PREFIX)

export const outcomeSchema = z.enum(["allowed", "partly", "dismissed"])
export type Outcome = z.infer<typeof outcomeSchema>
const OUTCOMES = outcomeSchema.options

/** `GET /precedents/{id}` on the backend. */
export const precedentDetailSchema = z.object({
  precedent_id: z.string(),
  book: z.string(),
  case_no: z.string(),
  year: z.number().nullish(),
  excerpt: z.string(),
  outcome: outcomeSchema.nullish(),
  text: z.string(),
})
export type PrecedentDetail = z.infer<typeof precedentDetailSchema>

export function parsePrecedentDetail(raw: unknown): PrecedentDetail {
  const parsed = precedentDetailSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`Invalid precedent from the backend: ${parsed.error.message}`)
  return parsed.data
}

/* ---- Decision removal ---- */

// A heading line that opens the part of an award where the outcome is stated.
// "Order dated ..." and "Award No. ..." headers do not match: only the bare word,
// optionally "of the Forum", plus punctuation.
const DECISION_HEADING =
  /^\s*(?:decision|observations?|findings?|conclusions?|order|award)(?:\s+of\s+the\s+forum)?[\s:\-\u2013\u2014.]*$/i
const MAX_HEADING_CHARS = 40

// `directed` is broader than the task's "directed to pay": awards also say
// "directed to process", and over-removing a line costs less than leaking an outcome.
const OUTCOME_LINE = /award|dismissed|allowed|directed|ex-gratia|complaint is/i

// PDF lines wrap at about 80 characters: a long outcome line usually continues
// on the next line ("... an ex-gratia of" / "Rs.2,000/- ..."). Only that one
// following line goes too, so a stray "allowed" mid-paragraph cannot swallow the rest.
const WRAPPED_LINE_CHARS = 60

/**
 * Removes the decision from an award, line by line (award text has no blank
 * lines): everything from the first decision heading to the end, then every
 * line that states an outcome plus the wrapped line after a long one.
 */
export function removeDecision(text: string): string {
  const lines = text.split("\n")
  const headingAt = lines.findIndex((line) => line.trim().length <= MAX_HEADING_CHARS && DECISION_HEADING.test(line))
  const before = headingAt === -1 ? lines : lines.slice(0, headingAt)

  const kept: string[] = []
  let continuesPrevious = false
  for (const line of before) {
    const statesOutcome = OUTCOME_LINE.test(line)
    if (!statesOutcome && !continuesPrevious) kept.push(line)
    continuesPrevious = statesOutcome && line.trim().length >= WRAPPED_LINE_CHARS
  }
  return kept.join("\n")
}

export const hasEnoughReplayText = (text: string): boolean => text.trim().length >= MIN_REPLAY_CHARS

/* ---- Case-like replay input ---- */

export type ReplayCase = Case & {
  bill: { lines: never[]; total: number }
}

const UNKNOWN = "Unknown (historical award)"

/** The award text with the decision removed, shaped like a sample case with one placeholder deduction. */
export function buildReplayCase(precedent: PrecedentDetail): ReplayCase {
  return {
    case_id: `${REPLAY_CASE_PREFIX}${precedent.precedent_id}`,
    title: `Replay of an Ombudsman award (${precedent.case_no})`,
    // Required by caseSchema (TASK-09 letters); an award names no policy, patient or stay, so nothing is invented.
    policy: { doc_id: "historical_award", product: UNKNOWN },
    patient: { name: UNKNOWN },
    admission: { hospital: UNKNOWN, admitted: "", discharged: "" },
    settlement: {
      claimed: 0,
      approved: 0,
      total_deducted: 0,
      deductions: [
        { deduction_id: "D1", label: "Claim repudiated or reduced", amount: 0, line_ids: [], insurer_reason: "" },
      ],
      letter_text: removeDecision(precedent.text),
    },
    bill: { lines: [], total: 0 },
    timeline: [],
    expected: [],
  }
}

/** In-memory replay cases, so `get_case` can serve them without a backend round trip. */
export interface ReplayRegistry {
  register(replayCase: ReplayCase): void
  get(caseId: string): ReplayCase | undefined
}

export function createReplayRegistry(): ReplayRegistry {
  const cases = new Map<string, ReplayCase>()
  return {
    register: (replayCase) => {
      cases.set(replayCase.case_id, replayCase)
    },
    get: (caseId) => cases.get(caseId),
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Scripted-mode replay: no verdicts exist for an award (there is no answer key
 * and no model), so it streams its steps and finishes with an empty result.
 */
export async function runScriptedReplay(options: {
  store: AnalysisStore
  analysisId: string
  replayCase: ReplayCase
  delayMs: number
}): Promise<void> {
  const { store, analysisId, replayCase, delayMs } = options
  const steps = [
    `Reading the award text of ${replayCase.title} with its decision removed.`,
    "Scripted mode has no model, so no verdict is produced; set AGENT_MODE=llm for a real replay.",
  ]
  for (const message of steps) {
    store.append(analysisId, { type: "step", message })
    await sleep(delayMs)
  }
  store.append(analysisId, {
    type: "done",
    message: "Replay complete: no verdicts in scripted mode.",
    data: { total_recoverable: 0 },
  })
  store.finish(analysisId, {
    status: "done",
    verdicts: [],
    total_recoverable: 0,
    flags: [],
    finished_at: new Date().toISOString(),
  })
}

/* ---- Agreement with the labelled outcome ---- */

/** Label mapping: allowed or partly -> contestable; dismissed -> valid. `needs_info` never matches. */
export function toVerdictStatus(outcome: Outcome): VerdictStatus {
  return outcome === "dismissed" ? "valid" : "contestable"
}

export interface LabelledPrediction {
  label: Outcome
  predicted: VerdictStatus
}

export interface LabelCount {
  total: number
  correct: number
}

export interface Agreement {
  total: number
  correct: number
  accuracy: number
  /** Accuracy of always answering the more common verdict class. */
  majorityBaseline: number
  perLabel: Record<Outcome, LabelCount>
}

export function agreement(rows: readonly LabelledPrediction[]): Agreement {
  const perLabel = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, { total: 0, correct: 0 }])) as Record<
    Outcome,
    LabelCount
  >
  const classCounts = { valid: 0, contestable: 0 }
  let correct = 0
  for (const { label, predicted } of rows) {
    const expected = toVerdictStatus(label)
    perLabel[label].total += 1
    classCounts[expected === "valid" ? "valid" : "contestable"] += 1
    if (expected === predicted) {
      perLabel[label].correct += 1
      correct += 1
    }
  }
  const total = rows.length
  return {
    total,
    correct,
    accuracy: total === 0 ? 0 : correct / total,
    majorityBaseline: total === 0 ? 0 : Math.max(classCounts.valid, classCounts.contestable) / total,
    perLabel,
  }
}

export interface CitationRate {
  verified: number
  total: number
  rate: number
}

/** Share of citations in the final verdicts that passed `verify_quote`. */
export function citationVerificationRate(verdicts: readonly Verdict[]): CitationRate {
  const citations = verdicts.flatMap((verdict) => verdict.citations)
  const verified = citations.filter((citation) => citation.verified).length
  return { verified, total: citations.length, rate: citations.length === 0 ? 0 : verified / citations.length }
}

/* ---- CSV (scripts write data/eval/candidates.csv) ---- */

const csvCell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

export function toCsv(columns: readonly string[], rows: readonly Record<string, string>[]): string {
  const lines = [columns.map(csvCell).join(",")]
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column] ?? "")).join(","))
  return `${lines.join("\n")}\n`
}
