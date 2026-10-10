"use client"

import { useEffect, useState } from "react"
import { BookOpen, CircleDashed, Check, Scale } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { StatusChip } from "@/components/StatusChip"
import { formatINR } from "@/lib/format"
import { getRule, type BillLine, type CalcResult, type Citation, type Deduction, type Verdict } from "@/lib/api"

interface EvidencePanelProps {
  deduction: Deduction | undefined
  verdict: Verdict | null
  billLines: BillLine[]
  onClose: () => void
}

/**
 * Text of a rule, fetched only for a verified rule citation. It is context under the quote, so a
 * failed fetch simply leaves the box out rather than turning a verified citation into an error.
 */
function useFullRuleText(citation: Citation): string | null {
  const [loaded, setLoaded] = useState<{ id: string; text: string } | null>(null)
  const wanted = citation.source_type === "rule" && citation.verified ? citation.source_id : null

  useEffect(() => {
    if (wanted === null) return
    let cancelled = false
    getRule(wanted)
      .then((rule) => {
        if (!cancelled) setLoaded({ id: wanted, text: rule.text })
      })
      .catch(() => {
        if (!cancelled) setLoaded(null)
      })
    return () => {
      cancelled = true
    }
  }, [wanted])

  return wanted !== null && loaded?.id === wanted && loaded.text.trim() ? loaded.text : null
}

function CitationItem({ citation }: { citation: Citation }) {
  const hasQuote = citation.quote.trim().length > 0
  const fullRule = useFullRuleText(citation)
  return (
    <li
      data-testid={`citation-${citation.source_id}`}
      className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {citation.source_type === "policy" ? "Policy" : "Rule"}
        </span>
        <span className="font-mono text-xs text-slate-900">{citation.source_id}</span>
        {citation.verified ? (
          <Badge
            variant="outline"
            className="ml-auto gap-1 border-emerald-200 bg-emerald-50 font-medium text-emerald-700"
          >
            <Check className="h-3 w-3" data-testid="verified-tick" aria-hidden="true" />
            Verified against source
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="ml-auto gap-1 border-slate-200 bg-slate-50 font-medium text-slate-600"
          >
            <CircleDashed className="h-3 w-3" aria-hidden="true" />
            Not yet verified
          </Badge>
        )}
      </div>
      {hasQuote && (
        <blockquote
          data-testid="citation-quote"
          className={
            citation.verified
              ? "rounded-r-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-slate-800"
              : "border-l-2 border-slate-300 pl-3 text-sm italic text-slate-700"
          }
        >
          {citation.quote}
        </blockquote>
      )}
      {fullRule !== null && (
        <div data-testid="full-rule" className="space-y-1 rounded-xl bg-slate-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            Full rule
          </p>
          <p className="text-sm leading-relaxed text-slate-600">{fullRule}</p>
        </div>
      )}
    </li>
  )
}

function formatValue(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)
}

function CalculationSteps({ calculation }: { calculation: CalcResult }) {
  const sections: { title: string; values: Record<string, unknown> }[] = [
    { title: "Inputs", values: calculation.inputs },
    { title: "Result", values: calculation.result },
  ]
  return (
    <div className="space-y-3">
      <p className="font-mono text-xs text-slate-500">{calculation.calculator}</p>
      {sections.map(({ title, values }) => (
        <div key={title}>
          <p className="mb-1 text-xs font-medium text-slate-500">{title}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {Object.entries(values).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-slate-500">{key}</dt>
                <dd className="tabular-nums text-slate-900">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {children}
    </section>
  )
}

export function EvidencePanel({ deduction, verdict, billLines, onClose }: EvidencePanelProps) {
  return (
    <Sheet open={verdict !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        data-testid="evidence-panel"
        className="w-full space-y-5 overflow-y-auto bg-slate-50 sm:max-w-xl"
      >
        {verdict && (
          <>
            <SheetHeader className="pr-6 text-left">
              <SheetTitle>{deduction?.label ?? verdict.deduction_id}</SheetTitle>
              <SheetDescription>
                {deduction?.insurer_reason ?? "Insurer reason not available."}
              </SheetDescription>
              <div className="flex items-center gap-3 pt-1">
                <StatusChip status={verdict.status} />
                <span className="text-sm tabular-nums text-slate-600">
                  Recoverable {formatINR(verdict.recoverable_amount)}
                </span>
              </div>
            </SheetHeader>

            {verdict.regulation_override && (
              <div className="space-y-1 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm">
                <p className="flex items-center gap-1 font-medium text-sky-800">
                  <Scale className="h-4 w-4" aria-hidden="true" />
                  Regulation overrides this
                </p>
                <p className="text-sky-900">
                  Policy: {verdict.regulation_override.policy_says} → Law:{" "}
                  {verdict.regulation_override.law_says} ({verdict.regulation_override.rule_id})
                </p>
              </div>
            )}

            <Section title="Why">
              <p className="text-sm text-slate-700">{verdict.reasoning}</p>
            </Section>

            <Separator />

            <Section title="Citations">
              {verdict.citations.length > 0 ? (
                <ul className="space-y-2">
                  {verdict.citations.map((citation) => (
                    <CitationItem
                      key={`${citation.source_type}:${citation.source_id}`}
                      citation={citation}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No citations attached.</p>
              )}
            </Section>

            <Separator />

            <Section title="Bill lines">
              {billLines.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {billLines.map((line) => (
                    <li key={line.line_id} className="flex justify-between gap-4">
                      <span className="text-slate-700">
                        <span className="font-mono text-xs text-slate-500">{line.line_id}</span>{" "}
                        {line.particulars}
                      </span>
                      <span className="tabular-nums text-slate-900">{formatINR(line.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No bill lines linked to this deduction.
                </p>
              )}
            </Section>

            <Separator />

            <Section title="Calculation steps">
              {verdict.calculation ? (
                <CalculationSteps calculation={verdict.calculation} />
              ) : (
                <p className="text-sm text-muted-foreground">No calculation was needed.</p>
              )}
            </Section>

            <Separator />

            <Section title="Similar Ombudsman cases">
              <p className="text-sm text-muted-foreground">No similar cases attached yet.</p>
            </Section>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
