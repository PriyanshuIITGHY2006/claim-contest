import { Bot, ShieldCheck, TriangleAlert } from "lucide-react"
import { StatusChip } from "@/components/StatusChip"
import { Card, CardContent } from "@/components/ui/card"
import { formatINR } from "@/lib/format"
import type { Analysis, Baseline, BaselineError } from "@/lib/api"

interface CompareViewProps {
  analysis: Analysis
  /** `null` when no chatbot answer has been recorded for this case. */
  baseline: Baseline | null
  unavailableReason?: string
}

export interface MatchedErrors {
  byDeduction: Map<string, BaselineError[]>
  unmatched: BaselineError[]
}

/**
 * A baseline error is free text, so it is attached to the first deduction id
 * (e.g. "D3") it mentions in `claim` or `why_wrong`; data/baseline/README.md
 * asks recorders to include it. Errors naming no known deduction stay unmatched.
 */
export function matchErrors(errors: readonly BaselineError[], deductionIds: readonly string[]): MatchedErrors {
  const known = new Set(deductionIds)
  const byDeduction = new Map<string, BaselineError[]>()
  const unmatched: BaselineError[] = []
  for (const error of errors) {
    const ids = `${error.claim} ${error.why_wrong}`.match(/\bD\d+\b/g) ?? []
    const id = ids.find((candidate) => known.has(candidate))
    if (id === undefined) {
      unmatched.push(error)
      continue
    }
    byDeduction.set(id, [...(byDeduction.get(id) ?? []), error])
  }
  return { byDeduction, unmatched }
}

function ErrorItem({ error }: { error: BaselineError }) {
  return (
    <li className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm">
      <p className="font-medium text-rose-900">
        <span className="sr-only">Chatbot said: </span>
        {error.claim}
      </p>
      <p className="text-rose-800">
        <span className="font-semibold">Why it is wrong: </span>
        {error.why_wrong}
      </p>
    </li>
  )
}

export function CompareView({ analysis, baseline, unavailableReason }: CompareViewProps) {
  if (unavailableReason) {
    return (
      <Card role="alert" className="border-rose-200 bg-rose-50">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-rose-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          The chatbot comparison could not be loaded: {unavailableReason}
        </CardContent>
      </Card>
    )
  }
  if (baseline === null) {
    return (
      <Card className="border-slate-200 bg-slate-50">
        <CardContent className="p-4 text-sm text-slate-700">
          No recorded chatbot answer for this case yet. See data/baseline/README.md for how to record one.
        </CardContent>
      </Card>
    )
  }

  const { byDeduction, unmatched } = matchErrors(
    baseline.errors,
    analysis.verdicts.map((verdict) => verdict.deduction_id),
  )

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="baseline-heading" className="space-y-3">
        <h2 id="baseline-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Bot className="h-5 w-5 text-slate-500" aria-hidden="true" />
          Plain chatbot answer
        </h2>
        {/* Plain text on purpose: the recorded answer is shown verbatim, not rendered. */}
        <pre
          data-testid="baseline-answer"
          className="whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-white p-4 font-sans text-sm leading-relaxed text-slate-700"
        >
          {baseline.answer_markdown}
        </pre>
        {unmatched.length > 0 && (
          <div data-testid="compare-other-errors" className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-800">Other errors</h3>
            <ul className="space-y-2">
              {unmatched.map((error, index) => (
                <ErrorItem key={`${index}-${error.claim}`} error={error} />
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="ours-heading" className="space-y-3">
        <h2 id="ours-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <ShieldCheck className="h-5 w-5 text-teal-700" aria-hidden="true" />
          Our verified verdicts
        </h2>
        <ul className="space-y-3">
          {analysis.verdicts.map((verdict) => {
            const errors = byDeduction.get(verdict.deduction_id) ?? []
            return (
              <li
                key={verdict.deduction_id}
                data-testid={`compare-verdict-${verdict.deduction_id}`}
                className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{verdict.deduction_id}</span>
                  <StatusChip status={verdict.status} />
                  <span className="ml-auto tabular-nums font-semibold text-slate-900">
                    {formatINR(verdict.recoverable_amount)}
                  </span>
                </div>
                <p className="text-sm text-slate-700">{verdict.reasoning}</p>
                {errors.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                      Chatbot got this wrong
                    </p>
                    <ul className="space-y-2">
                      {errors.map((error, index) => (
                        <ErrorItem key={`${index}-${error.claim}`} error={error} />
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
