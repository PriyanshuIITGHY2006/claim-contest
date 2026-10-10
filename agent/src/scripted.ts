import { readFile } from "node:fs/promises"
import path from "node:path"
import { caseSchema, type Case, type Citation, type Flag, type Verdict } from "./types.js"
import type { AnalysisStore } from "./store.js"
import { BackendError, type BackendClient } from "./backend.js"

/** Loads one sample case from `data/cases/<case_id>.json`. */
export type CaseLoader = (caseId: string) => Promise<Case>

export interface ScriptedOutcome {
  verdicts: Verdict[]
  flags: Flag[]
  totalRecoverable: number
}

/** Expected entries that are not settlement deductions become flags instead of verdicts. */
const FLAG_KIND_BY_EXPECTED_ID: Record<string, Flag["kind"]> = {
  LETTER: "letter_not_specific",
  TAT_CASHLESS: "tat_breach",
  TAT_DISCHARGE: "tat_breach",
}

/** Scripted verdicts are deterministic, so confidence is fixed until TASK-08 lands. */
const SCRIPTED_CONFIDENCE = 0.9
const POLICY_BASIS_PREFIX = "policy:"

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * `basis` entries are anchors, not verbatim text, so scripted citations carry the
 * anchor or rule id with `verified: false`; TASK-07/08 verify real quotes via the
 * backend's POST /verify-quote.
 */
export function buildCitation(basis: string): Citation {
  return basis.startsWith(POLICY_BASIS_PREFIX)
    ? {
        source_type: "policy",
        source_id: basis.slice(POLICY_BASIS_PREFIX.length),
        quote: "",
        verified: false,
      }
    : { source_type: "rule", source_id: basis, quote: "", verified: false }
}

/**
 * Loads a case from the backend's GET /cases/{id}, which serves the sample cases
 * and the cases users upload (stored in SQLite, not on disk).
 */
export function createBackendCaseLoader(client: BackendClient): CaseLoader {
  return async (caseId) => {
    let raw: unknown
    try {
      raw = await client.getCase(caseId)
    } catch (error) {
      if (error instanceof BackendError && error.status === 404) {
        throw new Error(`Unknown case_id: ${caseId}`, { cause: error })
      }
      throw error
    }
    const parsed = caseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`Invalid case ${caseId} from the backend: ${parsed.error.message}`)
    }
    return parsed.data
  }
}

export function createCaseLoader(dataDir: string): CaseLoader {
  return async (caseId) => {
    const file = path.join(dataDir, "cases", `${caseId}.json`)
    let raw: string
    try {
      raw = await readFile(file, "utf8")
    } catch (error) {
      throw new Error(`Unknown case_id: ${caseId} (${file})`, { cause: error })
    }
    const parsed = caseSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      throw new Error(`Invalid case file for ${caseId}: ${parsed.error.message}`)
    }
    return parsed.data
  }
}

/** Pure replay of a case's `expected` verdicts into verdicts, flags and a total. */
export function buildScriptedOutcome(sampleCase: Case): ScriptedOutcome {
  const deductionIds = new Set(
    sampleCase.settlement.deductions.map((deduction) => deduction.deduction_id),
  )
  const verdicts: Verdict[] = []
  const flags: Flag[] = []
  let totalRecoverable = 0

  for (const expected of sampleCase.expected) {
    if (!deductionIds.has(expected.deduction_id)) {
      const kind = FLAG_KIND_BY_EXPECTED_ID[expected.deduction_id]
      if (!kind) continue
      flags.push({
        kind,
        rule_id: expected.basis[0] ?? "",
        detail: expected.note ?? expected.deduction_id,
      })
      continue
    }

    verdicts.push({
      deduction_id: expected.deduction_id,
      status: expected.status,
      recoverable_amount: expected.recoverable,
      reasoning: expected.note ?? `Scripted verdict for ${expected.deduction_id}.`,
      citations: expected.basis.map(buildCitation),
      confidence: SCRIPTED_CONFIDENCE,
    })
    totalRecoverable += expected.recoverable
  }

  return { verdicts, flags, totalRecoverable: roundMoney(totalRecoverable) }
}

export interface ScriptedRunOptions {
  store: AnalysisStore
  analysisId: string
  sampleCase: Case
  delayMs?: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Emits the scripted event stream and finalises the analysis in the store. */
export async function runScripted(options: ScriptedRunOptions): Promise<void> {
  const { store, analysisId, sampleCase } = options
  const delayMs = options.delayMs ?? 400
  const { settlement } = sampleCase

  try {
    const steps = [
      `Reading the settlement letter for ${sampleCase.case_id}: Rs ${settlement.claimed} claimed, Rs ${settlement.approved} approved.`,
      `Auditing ${settlement.deductions.length} deduction(s) against the policy wording.`,
      "Cross-reading IRDAI master circulars for regulation overrides.",
      "Recomputing every amount from the itemised bill lines.",
    ]
    for (const message of steps) {
      store.append(analysisId, { type: "step", message })
      await sleep(delayMs)
    }

    const outcome = buildScriptedOutcome(sampleCase)

    for (const flag of outcome.flags) {
      store.append(analysisId, {
        type: "step",
        message: `Flag raised (${flag.kind}): ${flag.detail}`,
        data: flag,
      })
      await sleep(delayMs)
    }

    for (const verdict of outcome.verdicts) {
      store.append(analysisId, {
        type: "verdict",
        message: `${verdict.deduction_id}: ${verdict.status} (Rs ${verdict.recoverable_amount} recoverable)`,
        data: verdict,
      })
      await sleep(delayMs)
    }

    store.append(analysisId, {
      type: "done",
      message: `Analysis complete: Rs ${outcome.totalRecoverable} recoverable.`,
      data: { total_recoverable: outcome.totalRecoverable },
    })

    store.finish(analysisId, {
      status: "done",
      verdicts: outcome.verdicts,
      total_recoverable: outcome.totalRecoverable,
      flags: outcome.flags,
      finished_at: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    store.append(analysisId, { type: "error", message })
    store.finish(analysisId, {
      status: "error",
      verdicts: [],
      total_recoverable: 0,
      flags: [],
      finished_at: new Date().toISOString(),
    })
  }
}
