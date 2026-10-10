"use client"

import { useState } from "react"
import { BedDouble, Ban, Flag as FlagIcon, Percent, Receipt, type LucideIcon } from "lucide-react"
import { EvidencePanel } from "@/components/EvidencePanel"
import { StatusChip } from "@/components/StatusChip"
import { SummaryCard } from "@/components/SummaryCard"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatINR } from "@/lib/format"
import type { Analysis, Case, Verdict } from "@/lib/api"

interface VerdictBoardProps {
  caseData: Case
  analysis: Analysis
}

const LABEL_ICONS: { keywords: string[]; Icon: LucideIcon }[] = [
  { keywords: ["room rent"], Icon: BedDouble },
  { keywords: ["proportionate"], Icon: Percent },
  { keywords: ["non-payable", "non payable"], Icon: Ban },
]

function iconFor(label: string): LucideIcon {
  const text = label.toLowerCase()
  return LABEL_ICONS.find((entry) => entry.keywords.some((keyword) => text.includes(keyword)))?.Icon ?? Receipt
}

export function VerdictBoard({ caseData, analysis }: VerdictBoardProps) {
  const [selected, setSelected] = useState<Verdict | null>(null)
  // The headline must match the rows the user can check, so sum them in paise
  // rather than trusting the agent's own total.
  const totalRecoverable =
    analysis.verdicts.reduce((paise, verdict) => paise + Math.round(verdict.recoverable_amount * 100), 0) / 100
  const deductions = new Map(
    caseData.settlement.deductions.map((deduction) => [deduction.deduction_id, deduction]),
  )
  const selectedDeduction = selected ? deductions.get(selected.deduction_id) : undefined
  const selectedLines = selectedDeduction
    ? caseData.bill.lines.filter((line) => selectedDeduction.line_ids.includes(line.line_id))
    : []

  return (
    <div className="space-y-6">
      <SummaryCard
        totalRecoverable={totalRecoverable}
        totalDeducted={caseData.settlement.total_deducted}
        syntheticNotice={caseData.synthetic_notice}
      />

      {analysis.flags.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Flags">
          {analysis.flags.map((flag) => (
            <li
              key={`${flag.kind}:${flag.rule_id}`}
              className="flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700"
            >
              <FlagIcon className="h-3 w-3" aria-hidden="true" />
              {flag.detail}
            </li>
          ))}
        </ul>
      )}

      <Card className="overflow-hidden">
        {/* Below sm the table becomes stacked grid rows (label + amount, chip underneath) so nothing is clipped at 375px. */}
        <Table className="block sm:table">
          <TableHeader className="hidden bg-slate-50 sm:table-header-group">
            <TableRow>
              <TableHead className="sm:px-4">Deduction</TableHead>
              <TableHead className="hidden text-right sm:table-cell sm:px-4">Deducted</TableHead>
              <TableHead className="sm:px-4">Status</TableHead>
              <TableHead className="text-right sm:px-4">Recoverable</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="block sm:table-row-group">
            {analysis.verdicts.map((verdict) => {
              const deduction = deductions.get(verdict.deduction_id)
              const RowIcon = iconFor(deduction?.label ?? "")
              return (
                <TableRow
                  key={verdict.deduction_id}
                  data-testid={`deduction-row-${verdict.deduction_id}`}
                  tabIndex={0}
                  className="grid cursor-pointer grid-cols-[1fr_auto] items-start gap-x-3 gap-y-2 px-4 py-4 transition-colors hover:bg-teal-50/60 focus-visible:bg-teal-50/60 focus-visible:outline-none sm:table-row sm:p-0"
                  onClick={() => setSelected(verdict)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      setSelected(verdict)
                    }
                  }}
                >
                  <TableCell className="col-start-1 row-start-1 p-0 font-medium text-slate-900 sm:px-4 sm:py-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                        <RowIcon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="leading-snug">{deduction?.label ?? verdict.deduction_id}</p>
                        <p className="mt-0.5 text-xs font-normal tabular-nums text-slate-500 sm:hidden">
                          Deducted {deduction ? formatINR(deduction.amount) : "—"}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums text-slate-700 sm:table-cell sm:px-4 sm:py-3">
                    {deduction ? formatINR(deduction.amount) : "—"}
                  </TableCell>
                  <TableCell className="col-start-1 row-start-2 p-0 pl-11 sm:px-4 sm:py-3">
                    <StatusChip status={verdict.status} />
                  </TableCell>
                  <TableCell className="col-start-2 row-start-1 p-0 text-right font-heading font-bold tabular-nums text-slate-900 sm:px-4 sm:py-3">
                    <span className="block text-xs font-normal text-slate-500 sm:hidden">Recoverable</span>
                    {formatINR(verdict.recoverable_amount)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      <EvidencePanel
        deduction={selectedDeduction}
        verdict={selected}
        billLines={selectedLines}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
