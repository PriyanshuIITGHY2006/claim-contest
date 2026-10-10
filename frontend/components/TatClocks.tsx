import { Clock, Info, TriangleAlert } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { formatINR } from "@/lib/format"
import type { TatResult } from "@/lib/api"

export type ClockKind = "cashless" | "discharge"

export interface ClockResult {
  kind: ClockKind
  /** Rule that sets the limit, e.g. MC24-16a; shown on the breach label. */
  rule_id: string
  /** Answer of POST /calc/tat. */
  result: TatResult
}

interface TatClocksProps {
  clocks: ClockResult[]
  /** Amount the insurer must bear for the discharge delay, when a verdict gives one. */
  insurerBears?: number
  /** Why the timing check could not run; shown in place of the clocks. */
  unavailableReason?: string
}

const TITLES: Record<ClockKind, string> = {
  cashless: "Cashless approval",
  discharge: "Discharge approval",
}

/** 330 -> "5h 30m", 180 -> "3h", 45 -> "45m". Display only. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

export function TatClocks({ clocks, insurerBears, unavailableReason }: TatClocksProps) {
  if (unavailableReason !== undefined) {
    return (
      <Card data-testid="clocks-unavailable" className="border-slate-200 bg-slate-50">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-slate-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
          <p>
            We couldn&apos;t check the timings just now. Try again in a moment.
            <span className="mt-1 block text-xs text-slate-500">{unavailableReason}</span>
          </p>
        </CardContent>
      </Card>
    )
  }

  if (clocks.length === 0) {
    return (
      <p data-testid="clocks-empty" className="text-sm text-slate-600">
        No cashless or discharge approval times were recorded for this case.
      </p>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {clocks.map((clock) => (
        <ClockCard
          key={clock.kind}
          clock={clock}
          insurerBears={clock.kind === "discharge" ? insurerBears : undefined}
        />
      ))}
    </div>
  )
}

function ClockCard({ clock, insurerBears }: { clock: ClockResult; insurerBears?: number }) {
  const { elapsed_minutes, limit_minutes, breached, over_by_minutes } = clock.result
  // Bar widths are layout only: the longer of the two spans the track.
  const scale = Math.max(elapsed_minutes, limit_minutes)
  const elapsedPct = (elapsed_minutes / scale) * 100
  const limitPct = (limit_minutes / scale) * 100

  return (
    <Card data-testid={`clock-${clock.kind}`}>
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
            <Clock className="h-4 w-4" aria-hidden="true" />
          </span>
          <h3 className="text-sm font-semibold text-slate-900">{TITLES[clock.kind]}</h3>
        </div>

        <p className="font-heading text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
          {formatDuration(elapsed_minutes)} (limit {formatDuration(limit_minutes)})
        </p>

        <div className="relative h-3 rounded-full bg-slate-100" aria-hidden="true">
          <div
            className={`h-3 rounded-full ${breached ? "bg-rose-500" : "bg-emerald-500"}`}
            style={{ width: `${elapsedPct}%` }}
          />
          <div className="absolute -top-1 h-5 w-0.5 bg-slate-700" style={{ left: `${limitPct}%` }} />
        </div>

        {breached ? (
          <div className="space-y-2">
            <p
              data-testid="breach-label"
              className="flex items-start gap-2 text-sm font-medium text-rose-700"
            >
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              Breach of {clock.rule_id}: {formatDuration(over_by_minutes)} over
            </p>
            {insurerBears !== undefined && (
              <p className="text-sm text-slate-700">
                Extra hospital charges the insurer must bear:{" "}
                <span className="font-semibold tabular-nums">{formatINR(insurerBears)}</span>
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm font-medium text-emerald-700">Within the limit</p>
        )}
      </CardContent>
    </Card>
  )
}
