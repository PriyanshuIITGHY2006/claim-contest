"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { motion, useReducedMotion } from "framer-motion"
import {
  BadgeCheck,
  Calculator,
  CircleCheck,
  FileText,
  Gavel,
  Search,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"
import { agentEventsUrl, type AgentEvent } from "@/lib/api"

interface LiveTimelineProps {
  analysisId: string
  /** True when the page was rendered while the run was still going, so the verdicts need a re-render once it ends. */
  refreshOnDone: boolean
}

type StreamState = "running" | "done" | "error"

const UNREADABLE_EVENT = "An update from the agent could not be read."
const LOST_CONNECTION = "The connection to the agent was lost before the analysis finished."

function isAgentEvent(value: unknown): value is AgentEvent {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.seq === "number" && typeof candidate.type === "string" && typeof candidate.message === "string"
}

function toolName(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null
  const tool = (data as Record<string, unknown>).tool
  return typeof tool === "string" ? tool : null
}

function isVerifiedQuote(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as Record<string, unknown>).verified === true
}

function iconForTool(tool: string | null): LucideIcon {
  if (tool === null) return Sparkles
  if (tool === "search_policy" || tool === "search_rules") return Search
  if (tool === "verify_quote") return BadgeCheck
  if (tool.startsWith("calc_")) return Calculator
  if (tool === "get_case") return FileText
  if (tool === "find_precedents") return Gavel
  return Sparkles
}

export function LiveTimeline({ analysisId, refreshOnDone }: LiveTimelineProps) {
  const router = useRouter()
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [state, setState] = useState<StreamState>("running")
  const [closing, setClosing] = useState<string | null>(null)
  const reduceMotion = useReducedMotion()
  // Refs, not effect dependencies: a new router object or a flipped refreshOnDone (after
  // router.refresh()) must not close and reopen the stream, which would replay every step.
  const refreshOnDoneRef = useRef(refreshOnDone)
  const refreshRef = useRef(router.refresh)
  refreshOnDoneRef.current = refreshOnDone
  refreshRef.current = router.refresh

  useEffect(() => {
    const source = new EventSource(agentEventsUrl(analysisId))
    let lastSeq = 0
    let closed = false
    let finished = false

    const close = () => {
      if (closed) return
      closed = true
      source.close()
    }

    const fail = (message: string) => {
      finished = true
      close()
      setClosing(message)
      setState("error")
    }

    source.onmessage = (message) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(message.data)
      } catch {
        fail(UNREADABLE_EVENT)
        return
      }
      if (!isAgentEvent(parsed)) {
        fail(UNREADABLE_EVENT)
        return
      }
      // The agent closes the stream after done/error and a browser reconnects on its own,
      // replaying the whole backlog; anything at or below the last seq is a repeat.
      if (parsed.seq <= lastSeq) return
      lastSeq = parsed.seq

      if (parsed.type === "done") {
        finished = true
        close()
        setState("done")
        setClosing(parsed.message)
        if (refreshOnDoneRef.current) refreshRef.current()
        return
      }
      if (parsed.type === "error") {
        fail(parsed.message)
        return
      }
      setEvents((previous) => [...previous, parsed as AgentEvent])
    }

    source.onerror = () => {
      if (finished) return
      fail(LOST_CONNECTION)
    }

    return close
  }, [analysisId])

  return (
    <section
      aria-label="Agent timeline"
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <h2 className="text-base font-semibold text-slate-900">What the agent did</h2>

      <ol className="relative">
        {events.map((event, index) => {
          const isLatest = index === events.length - 1
          const active = isLatest && state === "running"
          return (
            <motion.li
              key={event.seq}
              data-testid={`timeline-event-${event.seq}`}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: reduceMotion ? 0 : Math.min(index, 6) * 0.03 }}
              className="relative flex gap-3 pb-5 last:pb-0"
            >
              {!isLatest && (
                <span className="absolute left-4 top-8 -ml-px h-[calc(100%-1.5rem)] w-px bg-slate-200" aria-hidden="true" />
              )}
              <StepDot event={event} active={active} animate={!reduceMotion} />
              <div className="min-w-0 flex-1 space-y-1.5 pt-1 text-sm">
                <p className="leading-snug text-slate-800">{event.message}</p>
                <EventChips event={event} />
              </div>
            </motion.li>
          )
        })}
      </ol>

      {state === "running" && (
        <p className="pl-1 text-sm text-slate-500" role="status">
          The agent is working…
        </p>
      )}
      {state === "done" && (
        <p
          data-testid="timeline-done"
          className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          role="status"
        >
          <CircleCheck className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          {closing ?? "Analysis complete"}
        </p>
      )}
      {state === "error" && (
        <p
          data-testid="timeline-error"
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          {closing}
        </p>
      )}
    </section>
  )
}

function StepDot({ event, active, animate }: { event: AgentEvent; active: boolean; animate: boolean }) {
  const Icon = event.type === "verdict" ? CircleCheck : iconForTool(toolName(event.data))
  const tone =
    event.type === "verdict" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-teal-50 text-teal-700 ring-teal-200"
  return (
    <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center">
      {active && animate && (
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-teal-400/50" aria-hidden="true" />
      )}
      <span className={`relative flex h-8 w-8 items-center justify-center rounded-full ring-1 ${tone}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
    </span>
  )
}

function EventChips({ event }: { event: AgentEvent }) {
  const tool = toolName(event.data)
  const verified = event.type === "tool_result" && isVerifiedQuote(event.data)
  if (!tool && !verified) return null
  return (
    <div className="flex flex-wrap gap-2">
      {tool && (
        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">{tool}</span>
      )}
      {verified && (
        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
          quote verified ✓
        </span>
      )}
    </div>
  )
}
