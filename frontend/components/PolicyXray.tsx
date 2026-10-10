import { BedDouble, CalendarDays, Scale } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { formatINR } from "@/lib/format"
import type { PolicyRef, Rule, Verdict } from "@/lib/api"

interface PolicyXrayProps {
  policy: PolicyRef
  verdicts: Verdict[]
  /** Rules cited by the overrides, used to print "MC24 para 13". */
  rules: Pick<Rule, "id" | "doc" | "para">[]
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function PolicyXray({ policy, verdicts, rules }: PolicyXrayProps) {
  const { schedule } = policy
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]))
  const overrides = verdicts.flatMap((verdict) =>
    verdict.regulation_override ? [verdict.regulation_override] : [],
  )

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="xray-room-rent">
          <CardContent className="space-y-3 p-5 sm:p-6">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                <BedDouble className="h-4 w-4" aria-hidden="true" />
              </span>
              Room-rent cap
            </p>
            <p className="font-heading text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
              {schedule.eligible_room_rent_per_day != null
                ? `${formatINR(schedule.eligible_room_rent_per_day)} / day`
                : "No daily cap"}
            </p>
            <p className="text-xs text-slate-500">{policy.product}</p>
          </CardContent>
        </Card>

        <Card data-testid="xray-coverage">
          <CardContent className="space-y-3 p-5 sm:p-6">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
              </span>
              Cover started
            </p>
            <p className="font-heading text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {formatDate(schedule.inception_date)}
            </p>
            <p className="text-xs text-slate-500">
              {schedule.continuous_coverage ? "Continuous coverage declared" : "Continuous coverage not declared"}
            </p>
          </CardContent>
        </Card>
      </div>

      {overrides.map((override) => {
        const rule = rulesById.get(override.rule_id)
        const source = rule ? `${rule.doc} para ${rule.para}` : override.rule_id
        return (
          <Card
            key={override.rule_id}
            data-testid={`xray-override-${override.rule_id}`}
            className="border-sky-200 bg-sky-50"
          >
            <CardContent className="space-y-2 p-5 sm:p-6">
              <Badge variant="outline" className="gap-1 border-sky-300 bg-white font-medium text-sky-800">
                <Scale className="h-3 w-3" aria-hidden="true" />
                Regulation overrides this
              </Badge>
              <p className="font-heading text-base font-bold leading-snug text-sky-950 sm:text-lg">
                Policy: {override.policy_says} → Law: {override.law_says} ({source})
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
