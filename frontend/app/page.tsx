import Link from "next/link"
import {
  ArrowRight,
  BedDouble,
  Clock,
  FileWarning,
  HeartPulse,
  Scale,
  ShieldCheck,
  TriangleAlert,
  Upload,
  type LucideIcon,
} from "lucide-react"
import { HowItWorks } from "@/components/HowItWorks"
import { Reveal } from "@/components/Reveal"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ApiError, getCase, listCases, type Case } from "@/lib/api"
import { formatINR } from "@/lib/format"

export const dynamic = "force-dynamic"

async function loadCases(): Promise<Case[]> {
  // Uploaded claims (user_ ids) are the user's own, not sample cases.
  const summaries = (await listCases()).filter((summary) => !summary.id.startsWith("user_"))
  return Promise.all(summaries.map((summary) => getCase(summary.id)))
}

interface CaseTheme {
  name: string
  keywords: string[]
  Icon: LucideIcon
}

// "control" is checked first: the control case's deduction is also labelled "Claim repudiated".
const THEMES: CaseTheme[] = [
  { name: "Scale", keywords: ["control"], Icon: Scale },
  { name: "BedDouble", keywords: ["room"], Icon: BedDouble },
  { name: "HeartPulse", keywords: ["non-disclosure", "repudiat"], Icon: HeartPulse },
  { name: "Clock", keywords: ["discharge"], Icon: Clock },
  { name: "FileWarning", keywords: ["document", "papers"], Icon: FileWarning },
]

function themeFor(sampleCase: Case): CaseTheme {
  const text = [sampleCase.title, ...sampleCase.settlement.deductions.map((d) => d.label)]
    .join(" ")
    .toLowerCase()
  return THEMES.find((theme) => theme.keywords.some((keyword) => text.includes(keyword))) ?? THEMES[0]!
}

function hospitalName(hospital: string): string {
  return hospital.replace(/\s*\(SYN-\d+\)\s*$/, "")
}

export default async function StartPage() {
  let cases: Case[] = []
  let failure: string | null = null
  try {
    cases = await loadCases()
  } catch (error) {
    failure = error instanceof ApiError ? error.message : "Could not load the sample cases."
  }

  return (
    <div className="space-y-16">
      <Reveal>
        <section className="space-y-5 pt-2 sm:pt-6">
          <h1 className="max-w-3xl text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl sm:leading-[1.1]">
            Find out if your insurer cut too much — with the exact clause
          </h1>
          <p className="max-w-2xl text-base text-slate-600 sm:text-lg">
            The agent audits every deduction in your settlement letter against the policy wording and
            IRDAI rules, then shows what looks recoverable.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
            <Button asChild size="lg" className="bg-brand hover:bg-brand-hover">
              <a href="#cases">Try a sample case</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/upload">
                <Upload className="h-4 w-4" aria-hidden="true" />
                Check your own claim
              </Link>
            </Button>
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <ShieldCheck className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
              IRDAI rules · Ombudsman awards · every quote verified
            </p>
          </div>
        </section>
      </Reveal>

      <HowItWorks />

      <section id="cases" aria-labelledby="cases-heading" className="scroll-mt-24 space-y-6">
        <div className="space-y-1">
          <h2 id="cases-heading" className="text-2xl font-bold tracking-tight text-slate-900">
            Sample cases
          </h2>
          <p className="text-sm text-slate-600">Synthetic data. Pick one to see the full audit.</p>
        </div>

        {failure && (
          <Card role="alert" className="rounded-2xl border-rose-200 bg-rose-50 shadow-sm">
            <CardContent className="flex items-start gap-3 p-4 text-sm text-rose-800">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {failure}
            </CardContent>
          </Card>
        )}

        <div aria-label="Sample cases" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cases.map((sampleCase, index) => {
            const { Icon, name } = themeFor(sampleCase)
            return (
              <Reveal key={sampleCase.case_id} delay={index * 0.06} className="h-full">
                <Link
                  href={`/case/${sampleCase.case_id}`}
                  prefetch={false}
                  data-theme-icon={name}
                  className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Card className="h-full rounded-2xl border-slate-200 shadow-sm transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
                    <CardContent className="flex h-full flex-col gap-3 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <p className="text-right text-xs font-medium text-slate-500">
                          {sampleCase.policy.product}
                        </p>
                      </div>
                      <h3 className="text-base font-semibold leading-snug text-slate-900">
                        {sampleCase.title}
                      </h3>
                      <p className="text-sm text-slate-600">
                        {hospitalName(sampleCase.admission.hospital)}
                      </p>
                      <div className="mt-auto flex items-end justify-between pt-2">
                        <div>
                          <p className="text-xs text-slate-500">Deducted</p>
                          <p className="font-heading text-2xl font-bold tabular-nums text-slate-900">
                            {formatINR(sampleCase.settlement.total_deducted)}
                          </p>
                        </div>
                        <ArrowRight
                          className="h-5 w-5 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-teal-700"
                          aria-hidden="true"
                        />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </Reveal>
            )
          })}
        </div>
      </section>
    </div>
  )
}
