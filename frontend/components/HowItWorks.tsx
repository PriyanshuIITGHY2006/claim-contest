import { FileText, Send, ShieldCheck, type LucideIcon } from "lucide-react"
import { Reveal } from "@/components/Reveal"

interface Step {
  title: string
  body: string
  Icon: LucideIcon
}

const STEPS: Step[] = [
  {
    title: "Share the settlement letter",
    body: "Start from a sample case: the letter, the itemised bill and the policy are already loaded.",
    Icon: FileText,
  },
  {
    title: "Agent checks policy + IRDAI rules",
    body: "Every deduction is read against the policy wording and the regulations, and every quote is verified.",
    Icon: ShieldCheck,
  },
  {
    title: "Get the grievance letter",
    body: "See what looks recoverable, with the clause behind each verdict, and take it to your insurer.",
    Icon: Send,
  },
]

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-heading" className="scroll-mt-24 space-y-6">
      <h2 id="how-heading" className="text-2xl font-bold tracking-tight text-slate-900">
        How it works
      </h2>
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map(({ title, body, Icon }, index) => (
          <li key={title}>
            <Reveal delay={index * 0.08} className="h-full">
              <div className="flex h-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Step {index + 1}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-slate-900">{title}</h3>
                <p className="text-sm leading-relaxed text-slate-600">{body}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  )
}
