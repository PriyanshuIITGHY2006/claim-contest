import { FlaskConical } from "lucide-react"
import { RecoverableBar } from "@/components/RecoverableBar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { formatINR } from "@/lib/format"

interface SummaryCardProps {
  totalRecoverable: number
  totalDeducted: number
  syntheticNotice: string
}

export function SummaryCard({ totalRecoverable, totalDeducted, syntheticNotice }: SummaryCardProps) {
  return (
    <Card
      data-testid="summary-card"
      className="overflow-hidden border-teal-100 bg-gradient-to-br from-white to-teal-50/60"
    >
      <CardContent className="space-y-5 p-5 sm:p-8">
        <Badge
          variant="outline"
          title={syntheticNotice}
          className="gap-1 border-slate-200 bg-white font-medium text-slate-600"
        >
          <FlaskConical className="h-3 w-3" aria-hidden="true" />
          SYNTHETIC DATA
        </Badge>
        <p className="text-base text-slate-600 sm:text-lg">
          <span className="block font-heading text-4xl font-bold tabular-nums tracking-tight text-teal-700 sm:text-6xl">
            {formatINR(totalRecoverable)}
          </span>{" "}
          of{" "}
          <span className="font-semibold tabular-nums text-slate-900">
            {formatINR(totalDeducted)}
          </span>{" "}
          deducted looks recoverable
        </p>
        <RecoverableBar recoverable={totalRecoverable} deducted={totalDeducted} />
        <p className="text-xs text-slate-500">{syntheticNotice}</p>
      </CardContent>
    </Card>
  )
}
