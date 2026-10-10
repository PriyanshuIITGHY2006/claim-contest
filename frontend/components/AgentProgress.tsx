"use client"

import { useEffect, useState } from "react"
import { Lightbulb } from "lucide-react"
import { STAGES, TIPS, quotesVerified, stageReached } from "@/lib/agentSteps"
import type { AgentEvent } from "@/lib/api"

const TIP_MS = 7000

/** What the agent is doing, in five plain stages, with a rotating tip while the user waits. */
export function AgentProgress({ events, running }: { events: readonly AgentEvent[]; running: boolean }) {
  const [tip, setTip] = useState(0)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setTip((current) => (current + 1) % TIPS.length), TIP_MS)
    return () => clearInterval(timer)
  }, [running])

  const reached = running ? stageReached(events) : STAGES.length
  const verified = quotesVerified(events)

  return (
    <div data-testid="agent-progress" className="space-y-3 rounded-xl border border-teal-100 bg-teal-50/50 p-4">
      <ol className="grid grid-cols-5 gap-1.5" aria-label="Analysis progress">
        {STAGES.map((stage, index) => {
          const done = index < reached
          const current = running && index === reached
          return (
            <li key={stage} className="space-y-1.5" aria-current={current ? "step" : undefined}>
              <div
                className={`h-1.5 rounded-full ${done ? "bg-teal-600" : current ? "animate-pulse bg-teal-400" : "bg-slate-200"}`}
              />
              <p className={`text-[11px] leading-tight ${done || current ? "font-medium text-teal-900" : "text-slate-500"}`}>
                {stage}
              </p>
            </li>
          )
        })}
      </ol>
      <p className="text-sm text-slate-700">
        {running ? (
          <>
            Step {Math.min(reached + 1, STAGES.length)} of {STAGES.length}: {STAGES[Math.min(reached, STAGES.length - 1)].toLowerCase()}.
            {verified > 0 && ` ${verified} quote${verified === 1 ? "" : "s"} verified so far.`} This usually takes one to two minutes.
          </>
        ) : (
          <>All checks finished. {verified} quote{verified === 1 ? "" : "s"} verified word-for-word against the source documents.</>
        )}
      </p>
      {running && (
        <p data-testid="agent-tip" className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-xs text-slate-600">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          <span>
            <span className="font-semibold text-slate-800">Did you know? </span>
            {TIPS[tip]}
          </span>
        </p>
      )}
    </div>
  )
}
