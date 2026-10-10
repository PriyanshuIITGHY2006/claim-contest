import { z } from "zod"
import { isReplayCaseId } from "./replay.js"
import { flagSchema, verdictSchema, type Case, type Citation, type Verdict } from "./types.js"

/**
 * The citation gate. Pure: it judges a submission against the evidence the
 * agent's own tool calls produced in this analysis. Quote matching is done by
 * the backend (POST /verify-quote); the gate only checks that each citation was
 * verified there, for the same source, and that every rupee came from a calc.
 */

/** Contestable verdicts below this confidence are kept but left out of the grievance. */
export const CONFIDENCE_THRESHOLD = 0.75

export const submissionSchema = z.object({
  verdicts: z.array(verdictSchema),
  flags: z.array(flagSchema).default([]),
})
export type Submission = z.infer<typeof submissionSchema>

/** One `verify_quote` call: its input plus the backend's answer (page kept for clause context). */
export interface VerificationRecord {
  source_type: Citation["source_type"]
  source_id: string
  quote: string
  verified: boolean
  match?: string
  score?: number
  page?: number | null
}

/** One `calc_*` call: the validated input and the backend's output. */
export interface CalcRecord {
  tool: string
  input: Record<string, unknown>
  output: unknown
}

export interface Evidence {
  verifications: VerificationRecord[]
  calcs: CalcRecord[]
}

export interface Rejection {
  deduction_id: string
  reasons: string[]
}

export interface GateResult {
  ok: boolean
  accepted: Verdict[]
  rejected: Rejection[]
  /** Deductions of the case with no verdict at all. */
  missing: string[]
}

type DeductionRef = { amount: number; line_ids: string[] }

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const normaliseQuote = (quote: string): string => quote.replace(/\s+/g, " ").trim()

const toPaise = (amount: number): number => Math.round(amount * 100)
const sameAmount = (a: number, b: number): boolean => Math.abs(toPaise(a) - toPaise(b)) <= 1

/** Records the evidence of one finished tool call; tools that produce none are ignored. */
export function recordToolResult(evidence: Evidence, tool: string, input: unknown, output: unknown): void {
  const args = asRecord(input)
  if (tool === "verify_quote") {
    const result = asRecord(output)
    const sourceType = args.source_type
    if (sourceType !== "policy" && sourceType !== "rule") return
    if (typeof args.source_id !== "string" || typeof args.quote !== "string") return
    evidence.verifications.push({
      source_type: sourceType,
      source_id: args.source_id,
      quote: args.quote,
      verified: result.verified === true,
      ...(typeof result.match === "string" ? { match: result.match } : {}),
      ...(typeof result.score === "number" ? { score: result.score } : {}),
      ...(typeof result.page === "number" || result.page === null ? { page: result.page } : {}),
    })
    return
  }
  if (tool.startsWith("calc_")) evidence.calcs.push({ tool, input: args, output })
}

function sameLineIds(given: unknown, expectedIds: readonly string[]): boolean {
  if (!Array.isArray(given) || given.length !== expectedIds.length) return false
  const left = given.map(String).sort()
  const right = [...expectedIds].sort()
  return left.every((id, index) => id === right[index])
}

/** `recoverable_amount` values from /calc/proportionate calls made for this deduction. */
function proportionateResultsFor(calcs: readonly CalcRecord[], deduction: DeductionRef): number[] {
  return calcs.flatMap((calc) => {
    if (calc.tool !== "calc_proportionate") return []
    const given = asRecord(calc.input.deduction)
    if (typeof given.amount !== "number" || !sameAmount(given.amount, deduction.amount)) return []
    if (!sameLineIds(given.line_ids, deduction.line_ids)) return []
    const recoverable = asRecord(calc.output).recoverable_amount
    return typeof recoverable === "number" ? [recoverable] : []
  })
}

function checkCitation(citation: Citation, verifications: readonly VerificationRecord[]): string | undefined {
  const label = `${citation.source_type}:${citation.source_id}`
  if (!citation.verified) return `citation ${label} is not verified`
  const quote = normaliseQuote(citation.quote)
  if (quote.length === 0) return `citation ${label} has an empty quote`
  const sameQuote = verifications.filter((v) => v.verified && normaliseQuote(v.quote) === quote)
  if (sameQuote.length === 0) return `citation ${label}: quote was never confirmed by verify_quote`
  const sameSource = sameQuote.some(
    (v) => v.source_type === citation.source_type && v.source_id === citation.source_id,
  )
  if (!sameSource) {
    const actual = sameQuote.map((v) => `${v.source_type}:${v.source_id}`).join(", ")
    return `citation ${label}: the quote was verified against ${actual}, not ${citation.source_id}`
  }
  return undefined
}

function checkAmount(
  verdict: Verdict,
  deduction: DeductionRef,
  calcs: readonly CalcRecord[],
  replay: boolean,
): string | undefined {
  const amount = verdict.recoverable_amount
  if (verdict.status !== "contestable" || replay) {
    // A replayed Ombudsman award has no rupee amount to recover (TASK-15), so every replay verdict recovers 0.
    const subject = replay ? "replay verdict" : `${verdict.status} verdict`
    return amount === 0 ? undefined : `${subject} must recover 0, not ${amount}`
  }
  if (amount <= 0) return "contestable verdict must recover a positive amount"

  const proportionate = proportionateResultsFor(calcs, deduction)
  if (proportionate.length > 0) {
    // A proportionate calculation for this deduction is authoritative: the full
    // deduction amount is no longer an acceptable shortcut.
    if (proportionate.some((value) => sameAmount(value, amount))) return undefined
    return `recoverable ${amount} does not match the calc_proportionate recoverable_amount ${proportionate.join(" / ")} for this deduction`
  }
  if (sameAmount(amount, deduction.amount)) return undefined
  const fromCalc = calcs.some((calc) => {
    const value = asRecord(calc.output).recoverable_amount
    return typeof value === "number" && sameAmount(value, amount)
  })
  return fromCalc
    ? undefined
    : `recoverable ${amount} was not returned by any calc tool and is not the full deduction amount ${deduction.amount}`
}

function checkVerdict(
  verdict: Verdict,
  deduction: DeductionRef,
  verifications: readonly VerificationRecord[],
  calcs: readonly CalcRecord[],
  replay: boolean,
): string[] {
  const reasons: string[] = []
  if (verdict.citations.length === 0) reasons.push("a verdict needs at least one citation")
  for (const citation of verdict.citations) {
    const problem = checkCitation(citation, verifications)
    if (problem) reasons.push(problem)
  }
  const override = verdict.regulation_override
  if (override && !verdict.citations.some((c) => c.source_type === "rule" && c.source_id === override.rule_id)) {
    reasons.push(`regulation_override rule ${override.rule_id} is not among this verdict's citations`)
  }
  const amountProblem = checkAmount(verdict, deduction, calcs, replay)
  if (amountProblem) reasons.push(amountProblem)
  return reasons
}

/**
 * Accepts or rejects each verdict. The result is `ok` only when every case
 * deduction has exactly one accepted verdict and nothing was rejected.
 */
export function acceptVerdicts(
  sampleCase: Pick<Case, "case_id" | "settlement">,
  verdicts: readonly Verdict[],
  verifications: readonly VerificationRecord[],
  calcResults: readonly CalcRecord[],
): GateResult {
  const replay = isReplayCaseId(sampleCase.case_id)
  const deductions = new Map(sampleCase.settlement.deductions.map((d) => [d.deduction_id, d]))
  const counts = new Map<string, number>()
  for (const verdict of verdicts) counts.set(verdict.deduction_id, (counts.get(verdict.deduction_id) ?? 0) + 1)

  const accepted: Verdict[] = []
  const rejected = new Map<string, string[]>()
  const reject = (id: string, reasons: string[]) => rejected.set(id, [...(rejected.get(id) ?? []), ...reasons])

  for (const verdict of verdicts) {
    const id = verdict.deduction_id
    const deduction = deductions.get(id)
    if (!deduction) {
      reject(id, [`${id} is not a deduction of this case`])
      continue
    }
    if ((counts.get(id) ?? 0) > 1) {
      if (!rejected.has(id)) reject(id, [`${id} was submitted more than once; submit exactly one verdict`])
      continue
    }
    const reasons = checkVerdict(verdict, deduction, verifications, calcResults, replay)
    if (reasons.length > 0) {
      reject(id, reasons)
      continue
    }
    accepted.push({
      ...verdict,
      include_in_grievance: verdict.status === "contestable" && verdict.confidence >= CONFIDENCE_THRESHOLD,
    })
  }

  const order = [...deductions.keys()]
  accepted.sort((a, b) => order.indexOf(a.deduction_id) - order.indexOf(b.deduction_id))
  const missing = order.filter((id) => !counts.has(id))
  const rejections = [...rejected].map(([deduction_id, reasons]) => ({ deduction_id, reasons }))

  return { ok: rejections.length === 0 && missing.length === 0, accepted, rejected: rejections, missing }
}

/** Plain-language feedback for the agent's retry turn. */
export function describeRejections(result: GateResult): string {
  const lines = result.rejected.map((r) => `- ${r.deduction_id}: ${r.reasons.join("; ")}`)
  for (const id of result.missing) lines.push(`- ${id}: no verdict was submitted for this deduction`)
  return lines.join("\n")
}
