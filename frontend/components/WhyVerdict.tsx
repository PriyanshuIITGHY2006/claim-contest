import { BadgeCheck, Calculator, FileText, Gavel, Scale, type LucideIcon } from "lucide-react"
import { formatINR } from "@/lib/format"
import type { Citation, Deduction, Verdict } from "@/lib/api"

interface WhyVerdictProps {
  deduction: Deduction | undefined
  verdict: Verdict
}

function confidenceLabel(confidence: number): { label: string; tone: string } {
  if (confidence >= 0.85) return { label: "High", tone: "bg-emerald-500" }
  if (confidence >= 0.6) return { label: "Medium", tone: "bg-amber-500" }
  return { label: "Low", tone: "bg-rose-500" }
}

function conclusion(verdict: Verdict): string {
  if (verdict.status === "contestable") {
    return `Contestable: ${formatINR(verdict.recoverable_amount)} looks recoverable.`
  }
  if (verdict.status === "valid") return "Valid: the insurer's deduction looks correct under the policy and the rules."
  return "Needs more information before this deduction can be judged."
}

function firstQuote(citations: Citation[], type: Citation["source_type"]): Citation | undefined {
  return citations.find((citation) => citation.source_type === type && citation.verified && citation.quote.trim())
}

function Step({ Icon, title, children }: { Icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700 ring-1 ring-teal-200">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 space-y-1 pt-0.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        <div className="text-sm leading-relaxed text-slate-800">{children}</div>
      </div>
    </li>
  )
}

/** Step-by-step explanation of one verdict, built only from the verdict's own evidence. */
export function WhyVerdict({ deduction, verdict }: WhyVerdictProps) {
  const policyQuote = firstQuote(verdict.citations, "policy")
  const ruleQuote = firstQuote(verdict.citations, "rule")
  const verifiedCount = verdict.citations.filter((citation) => citation.verified).length
  const { label, tone } = confidenceLabel(verdict.confidence)
  const percent = Math.round(Math.min(1, Math.max(0, verdict.confidence)) * 100)

  return (
    <section aria-label="Why this verdict" className="space-y-4 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
      <h3 className="font-heading text-base font-bold text-slate-900">Why this verdict</h3>

      <ol className="relative before:absolute before:bottom-3 before:left-3.5 before:top-3 before:w-px before:bg-slate-200">
        <Step Icon={FileText} title="The insurer said">
          <p>{deduction?.insurer_reason ?? "Reason not given."}</p>
          {deduction && <p className="tabular-nums text-slate-500">Deducted {formatINR(deduction.amount)}</p>}
        </Step>
        {policyQuote && (
          <Step Icon={BadgeCheck} title="Your policy says">
            <p className="italic">“{policyQuote.quote}”</p>
          </Step>
        )}
        {ruleQuote && (
          <Step Icon={Gavel} title={`The rule says (${ruleQuote.source_id})`}>
            <p className="italic">“{ruleQuote.quote}”</p>
          </Step>
        )}
        {verdict.regulation_override && (
          <Step Icon={Scale} title="The law overrides the policy">
            <p>
              Policy: {verdict.regulation_override.policy_says} → Law: {verdict.regulation_override.law_says} (
              {verdict.regulation_override.rule_id})
            </p>
          </Step>
        )}
        <Step Icon={Calculator} title="The numbers">
          {verdict.calculation ? (
            <p>
              Computed by <span className="font-mono text-xs">{verdict.calculation.calculator}</span>, not by the AI:{" "}
              <span className="font-semibold tabular-nums">{formatINR(verdict.recoverable_amount)}</span> recoverable.
            </p>
          ) : (
            <p>No calculation was needed for this verdict.</p>
          )}
        </Step>
      </ol>

      <p data-testid="why-conclusion" className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
        {conclusion(verdict)}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div data-testid="why-evidence" className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">Evidence checked</p>
          <p>
            {verifiedCount} of {verdict.citations.length} quotes verified word-for-word against the source
          </p>
          <p>{verdict.calculation ? "Amount from a deterministic calculator" : "No amount to compute"}</p>
        </div>
        <div data-testid="why-confidence" className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">
            Agent confidence: {label} ({percent}%)
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1">Below 75%, a deduction is left out of the grievance letter.</p>
        </div>
      </div>
    </section>
  )
}
