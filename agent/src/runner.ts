import { acceptVerdicts, describeRejections, type Evidence, type Submission } from "./gate.js"
import { NO_SUBMISSION_FEEDBACK, buildRetryPrompt, buildUserPrompt } from "./llm/prompt.js"
import type { AnalysisResult, AnalysisStore, NewAgentEvent } from "./store.js"
import type { Analysis, Case, Flag, Verdict } from "./types.js"

/**
 * Runs one LLM analysis: agent turn -> citation gate -> up to MAX_RETRIES
 * corrective turns -> needs_info fallback -> backend + store. It never imports
 * @cline/sdk; `createSession` (src/llm/agent.ts) wraps the SDK Agent.
 */

export const MAX_RETRIES = 2

interface ToolCallPart {
  toolName: string
  input?: unknown
}

/** The SDK `subscribe` events the runner maps (v0.0.92 shapes); others pass through unmapped. */
export type SdkEvent =
  | { type: "tool-started"; iteration?: number; toolCall: ToolCallPart & Record<string, unknown>; snapshot?: unknown }
  | {
      type: "tool-finished"
      iteration?: number
      toolCall: ToolCallPart & Record<string, unknown>
      message?: unknown
      snapshot?: unknown
    }
  | { type: "turn-started"; iteration?: number; snapshot?: unknown }

/** One agent conversation. `start`/`retry` resolve to the last submit_verdicts input, if any. */
export interface AnalysisSession {
  start(prompt: string): Promise<Submission | undefined>
  retry(prompt: string): Promise<Submission | undefined>
  /** verify_quote and calc_* results recorded so far in this analysis. */
  evidence(): Evidence
}

export type SessionFactory = (onEvent: (event: SdkEvent) => void) => AnalysisSession

export interface RunAnalysisOptions {
  store: AnalysisStore
  analysisId: string
  sampleCase: Case
  createSession: SessionFactory
  /** POST /analyses on the backend; failures are reported but never fatal. */
  saveAnalysis?: (analysis: Analysis) => Promise<unknown>
}

/** Maps an SDK event to an AgentEvent for the SSE stream; other events are dropped. */
export function mapSdkEvent(event: SdkEvent): NewAgentEvent | undefined {
  switch (event.type) {
    case "tool-started": {
      const { toolName, input } = event.toolCall
      return { type: "tool_call", message: `Calling ${toolName}`, data: { tool: toolName, input } }
    }
    case "tool-finished": {
      const { toolName } = event.toolCall
      return { type: "tool_result", message: `${toolName} finished`, data: { tool: toolName } }
    }
    case "turn-started":
      return { type: "step", message: `Agent turn ${event.iteration ?? ""}`.trim() }
    default:
      return undefined
  }
}

/** Sum of recoverable amounts in paise, so it equals the backend's own check. */
export function totalRecoverable(verdicts: readonly Verdict[]): number {
  const paise = verdicts.reduce((sum, verdict) => sum + Math.round(verdict.recoverable_amount * 100), 0)
  return paise / 100
}

function needsInfo(deductionId: string, reasons: readonly string[]): Verdict {
  return {
    deduction_id: deductionId,
    status: "needs_info",
    recoverable_amount: 0,
    reasoning: `No verified verdict after ${MAX_RETRIES} retries: ${reasons.join("; ")}`,
    citations: [],
    confidence: 0,
    include_in_grievance: false,
  }
}

const verdictMessage = (verdict: Verdict): string =>
  `${verdict.deduction_id}: ${verdict.status} (Rs ${verdict.recoverable_amount} recoverable)`

interface GatedOutcome {
  verdicts: Verdict[]
  flags: Flag[]
}

/**
 * Agent turn, gate, and corrective retries. Verdicts accepted in an earlier
 * attempt are kept; after MAX_RETRIES the remaining deductions become needs_info.
 */
async function gatedVerdicts(
  session: AnalysisSession,
  sampleCase: Case,
  emit: (event: NewAgentEvent) => void,
): Promise<GatedOutcome> {
  const deductionIds = sampleCase.settlement.deductions.map((d) => d.deduction_id)
  const accepted = new Map<string, Verdict>()
  const lastReasons = new Map<string, string[]>()
  let flags: Flag[] = []
  let submission = await session.start(buildUserPrompt(sampleCase.case_id))

  for (let attempt = 0; ; attempt += 1) {
    const evidence = session.evidence()
    const result = acceptVerdicts(sampleCase, submission?.verdicts ?? [], evidence.verifications, evidence.calcs)
    for (const verdict of result.accepted) accepted.set(verdict.deduction_id, verdict)
    for (const rejection of result.rejected) lastReasons.set(rejection.deduction_id, rejection.reasons)
    if (submission) flags = submission.flags

    const outstanding = deductionIds.filter((id) => !accepted.has(id))
    if (outstanding.length === 0) break

    const feedback = submission
      ? describeRejections({
          ...result,
          rejected: result.rejected.filter((r) => !accepted.has(r.deduction_id)),
          missing: result.missing.filter((id) => !accepted.has(id)),
        })
      : NO_SUBMISSION_FEEDBACK
    emit({ type: "step", message: `Citation gate rejected ${outstanding.join(", ")}`, data: { feedback } })
    if (attempt >= MAX_RETRIES) break
    submission = await session.retry(buildRetryPrompt(feedback))
  }

  const verdicts = deductionIds.map(
    (id) => accepted.get(id) ?? needsInfo(id, lastReasons.get(id) ?? ["no verdict submitted"]),
  )
  return { verdicts, flags }
}

export async function runAnalysis(options: RunAnalysisOptions): Promise<void> {
  const { store, analysisId, sampleCase } = options
  const emit = (event: NewAgentEvent) => {
    store.append(analysisId, event)
  }

  try {
    let session: AnalysisSession | undefined
    session = options.createSession((sdkEvent) => {
      const mapped = mapSdkEvent(sdkEvent)
      if (!mapped) return
      // A finished verify_quote carries its result, so the timeline can show "quote verified".
      if (sdkEvent.type === "tool-finished" && sdkEvent.toolCall.toolName === "verify_quote" && session) {
        const last = session.evidence().verifications.at(-1)
        if (last) {
          mapped.data = {
            tool: "verify_quote",
            verified: last.verified,
            source_type: last.source_type,
            source_id: last.source_id,
          }
          mapped.message = last.verified
            ? `Quote verified against ${last.source_id}`
            : `Quote could not be verified against ${last.source_id}`
        }
      }
      emit(mapped)
    })
    emit({
      type: "step",
      message: `Auditing ${sampleCase.settlement.deductions.length} deduction(s) for ${sampleCase.case_id}.`,
    })

    const { verdicts, flags } = await gatedVerdicts(session, sampleCase, emit)
    for (const flag of flags) emit({ type: "step", message: `Flag raised (${flag.kind}): ${flag.detail}`, data: flag })
    for (const verdict of verdicts) emit({ type: "verdict", message: verdictMessage(verdict), data: verdict })

    const total = totalRecoverable(verdicts)
    const result: AnalysisResult = {
      status: "done",
      verdicts,
      total_recoverable: total,
      flags,
      finished_at: new Date().toISOString(),
    }
    const current = store.getAnalysis(analysisId)
    if (options.saveAnalysis && current) {
      try {
        await options.saveAnalysis({ ...current, ...result })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        emit({ type: "step", message: `Analysis not saved to the backend (kept in memory): ${reason}` })
      }
    }
    // `done` is emitted before `finish` so SSE subscribers always see it as the last event.
    emit({ type: "done", message: `Analysis complete: Rs ${total} recoverable.`, data: { total_recoverable: total } })
    store.finish(analysisId, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emit({ type: "error", message })
    store.finish(analysisId, {
      status: "error",
      verdicts: [],
      total_recoverable: 0,
      flags: [],
      finished_at: new Date().toISOString(),
    })
  }
}
