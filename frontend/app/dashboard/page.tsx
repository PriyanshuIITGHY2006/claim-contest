import Link from "next/link"
import { ArrowRight, FilePlus2, TriangleAlert } from "lucide-react"
import { DemoGreeting } from "@/components/DemoUser"
import { Reveal } from "@/components/Reveal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ApiError, getCase, listAnalyses, listCases, type AnalysisSummary, type Case } from "@/lib/api"
import { formatINR } from "@/lib/format"

export const dynamic = "force-dynamic"

interface CaseRow {
  caseData: Case
  /** The newest finished analysis, or null when the case has none (or the lookup failed). */
  latest: AnalysisSummary | null
}

/** The first done analysis of a newest-first list: only a finished run counts as analysed. */
function newestDone(analyses: AnalysisSummary[]): AnalysisSummary | null {
  return analyses.find((analysis) => analysis.status === "done") ?? null
}

async function loadRow(caseId: string): Promise<CaseRow | null> {
  let caseData: Case
  try {
    caseData = await getCase(caseId)
  } catch {
    // A case that cannot be read costs its own card only, not the whole dashboard.
    return null
  }
  try {
    return { caseData, latest: newestDone(await listAnalyses(caseId)) }
  } catch {
    // Without the analyses list the case still shows, as not analysed yet.
    return { caseData, latest: null }
  }
}

async function loadRows(): Promise<CaseRow[]> {
  const summaries = await listCases()
  const rows = await Promise.all(summaries.map((summary) => loadRow(summary.id)))
  return rows.filter((row): row is CaseRow => row !== null)
}

function ClaimCard({ row }: { row: CaseRow }) {
  const { caseData, latest } = row
  const base = `/case/${encodeURIComponent(caseData.case_id)}`
  const href = latest ? `${base}?analysis=${encodeURIComponent(latest.analysis_id)}` : base
  return (
    <Link
      href={href}
      prefetch={false}
      className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card className="h-full rounded-2xl border-slate-200 shadow-sm transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
        <CardContent className="flex h-full flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            {latest ? (
              <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-800">
                Analysed
              </Badge>
            ) : (
              <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600">
                Not analysed yet
              </Badge>
            )}
            {caseData.case_id.startsWith("user_") && (
              <Badge variant="outline" className="rounded-full border-teal-200 bg-teal-50 text-teal-800">
                Uploaded
              </Badge>
            )}
          </div>
          <h3 className="text-base font-semibold leading-snug text-slate-900">{caseData.title}</h3>
          <p className="text-sm text-slate-600">{caseData.policy.product}</p>
          <div className="mt-auto flex items-end justify-between gap-3 pt-2">
            <div className="space-y-2">
              <div>
                <p className="text-xs text-slate-500">Deducted</p>
                <p className="font-heading text-xl font-bold tabular-nums text-slate-900">
                  {formatINR(caseData.settlement.total_deducted)}
                </p>
              </div>
              {latest && (
                <div>
                  <p className="text-xs text-slate-500">Looks recoverable</p>
                  <p className="font-heading text-xl font-bold tabular-nums text-teal-800">
                    {formatINR(latest.total_recoverable)}
                  </p>
                </div>
              )}
            </div>
            <ArrowRight
              className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-teal-700"
              aria-hidden="true"
            />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default async function DashboardPage() {
  let rows: CaseRow[] = []
  let failure: string | null = null
  try {
    rows = await loadRows()
  } catch (error) {
    failure = error instanceof ApiError ? error.message : "Could not load your claims."
  }

  return (
    <div className="space-y-8">
      <Reveal>
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              <DemoGreeting />
            </h1>
            <p className="text-slate-600">My claims</p>
          </div>
          <Button asChild size="lg" className="bg-brand hover:bg-brand-hover">
            <Link href="/upload">
              <FilePlus2 className="h-4 w-4" aria-hidden="true" />
              Check a new claim
            </Link>
          </Button>
        </section>
      </Reveal>

      {failure && (
        <Card role="alert" className="rounded-2xl border-rose-200 bg-rose-50 shadow-sm">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-rose-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {failure}
          </CardContent>
        </Card>
      )}

      {!failure && rows.length === 0 && (
        <p className="text-sm text-slate-600">No claims yet. Check a new claim to get started.</p>
      )}

      {rows.length > 0 && (
        <div aria-label="My claims" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row, index) => (
            <Reveal key={row.caseData.case_id} delay={index * 0.06} className="h-full">
              <ClaimCard row={row} />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  )
}
