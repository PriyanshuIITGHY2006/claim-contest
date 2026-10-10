import { randomUUID } from "node:crypto"
import {
  analysisSchema,
  type AgentEvent,
  type AgentEventType,
  type Analysis,
} from "./types.js"

/** An event before `seq` and `at` are stamped by the store. */
export type NewAgentEvent = Omit<AgentEvent, "seq" | "at"> & {
  type: AgentEventType
  message: string
  data?: unknown
}

/** Fields of an analysis that only the finished run knows. */
export type AnalysisResult = Pick<
  Analysis,
  "status" | "verdicts" | "total_recoverable" | "flags" | "finished_at"
>

export type EventListener = (event: AgentEvent) => void
export type StateListener = (analysis: Analysis) => void

export interface AnalysisStore {
  createAnalysis(caseId: string): Analysis
  getAnalysis(analysisId: string): Analysis | undefined
  /** Appends an event, stamping a strictly increasing per-analysis `seq`. */
  append(analysisId: string, event: NewAgentEvent): AgentEvent
  events(analysisId: string): AgentEvent[]
  /** Replays the backlog, then streams live events. Returns an unsubscribe fn. */
  subscribe(analysisId: string, listener: EventListener): () => void
  /** Notified whenever an analysis reaches a terminal state. */
  onStateChange(listener: StateListener): () => void
  finish(analysisId: string, result: AnalysisResult): Analysis
}

export function createAnalysisStore(): AnalysisStore {
  const analyses = new Map<string, Analysis>()
  const logs = new Map<string, AgentEvent[]>()
  const listeners = new Map<string, Set<EventListener>>()
  const stateListeners = new Set<StateListener>()

  function requireAnalysis(analysisId: string): Analysis {
    const analysis = analyses.get(analysisId)
    if (!analysis) throw new Error(`Unknown analysis_id: ${analysisId}`)
    return analysis
  }

  return {
    createAnalysis(caseId) {
      const analysis: Analysis = {
        analysis_id: randomUUID(),
        case_id: caseId,
        status: "running",
        verdicts: [],
        total_recoverable: 0,
        flags: [],
        started_at: new Date().toISOString(),
        finished_at: null,
      }
      analyses.set(analysis.analysis_id, analysis)
      logs.set(analysis.analysis_id, [])
      listeners.set(analysis.analysis_id, new Set())
      return analysis
    },

    getAnalysis(analysisId) {
      return analyses.get(analysisId)
    },

    append(analysisId, event) {
      requireAnalysis(analysisId)
      const log = logs.get(analysisId) ?? []
      const stamped: AgentEvent = {
        seq: log.length + 1,
        type: event.type,
        message: event.message,
        at: new Date().toISOString(),
        ...(event.data === undefined ? {} : { data: event.data }),
      }
      log.push(stamped)
      logs.set(analysisId, log)
      for (const listener of listeners.get(analysisId) ?? []) listener(stamped)
      return stamped
    },

    events(analysisId) {
      return [...(logs.get(analysisId) ?? [])]
    },

    subscribe(analysisId, listener) {
      requireAnalysis(analysisId)
      let set = listeners.get(analysisId)
      if (!set) {
        set = new Set()
        listeners.set(analysisId, set)
      }
      for (const event of logs.get(analysisId) ?? []) listener(event)
      set.add(listener)
      return () => {
        set?.delete(listener)
      }
    },

    onStateChange(listener) {
      stateListeners.add(listener)
      return () => {
        stateListeners.delete(listener)
      }
    },

    finish(analysisId, result) {
      const analysis = requireAnalysis(analysisId)
      const finished: Analysis = analysisSchema.parse({ ...analysis, ...result })
      analyses.set(analysisId, finished)
      for (const listener of stateListeners) listener(finished)
      return finished
    },
  }
}
