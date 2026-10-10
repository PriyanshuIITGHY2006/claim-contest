import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { Archive, ArrowLeft, RotateCw, TriangleAlert } from "lucide-react"
import { ActionCentre } from "@/components/ActionCentre"
import { CompareView } from "@/components/CompareView"
import { LiveTimeline } from "@/components/LiveTimeline"
import { PolicyXray } from "@/components/PolicyXray"
import { TatClocks, type ClockKind, type ClockResult } from "@/components/TatClocks"
import { VerdictBoard } from "@/components/VerdictBoard"
import { Card, CardContent } from "@/components/ui/card"
import {
  ApiError,
  calcDeadlines,
  calcTat,
  getAnalysis,
  getBaseline,
  getCase,
  getRule,
  getStoredAnalysis,
  startAnalysis,
  type Analysis,
  type Baseline,
  type Case,
  type DeadlineStep,
  type Rule,
} from "@/lib/api"

export const dynamic = "force-dynamic"

const TABS = [
  { id: "analysis", label: "Analysis" },
  { id: "xray", label: "X-ray" },
  { id: "clocks", label: "Clocks" },
  { id: "action", label: "Action" },
  { id: "compare", label: "Compare" },
] as const

type TabId = (typeof TABS)[number]["id"]

interface ClockSpec {
  kind: ClockKind
  ruleId: string
  from: string
  to: string
}

const CLOCK_SPECS: ClockSpec[] = [
  { kind: "cashless", ruleId: "MC24-15b", from: "cashless_request", to: "cashless_decision" },
  { kind: "discharge", ruleId: "MC24-16a", from: "discharge_request", to: "final_authorisation" },
]

interface CasePageProps {
  params: { id: string }
  searchParams: { analysis?: string; tab?: string }
}

function describe(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

function tabFrom(value: string | undefined): TabId {
  return TABS.find((tab) => tab.id === value)?.id ?? "analysis"
}

export default async function CasePage({ params, searchParams }: CasePageProps) {
  let caseData: Case
  try {
    caseData = await getCase(params.id)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    return <ErrorNotice message={describe(error, "Could not load the case.")} />
  }

  // One run per visit: the id goes into the URL so refreshes and tab switches reuse it.
  const requestedId = searchParams.analysis
  if (!requestedId) {
    let startedId: string
    try {
      startedId = (await startAnalysis(params.id)).analysis_id
    } catch (error) {
      return (
        <div className="space-y-6">
          <BackLink />
          <ErrorNotice message={describe(error, "Could not start the analysis.")} />
        </div>
      )
    }
    // Keep a valid requested tab so /case/x?tab=clocks does not land on the Analysis tab.
    const keptTab = TABS.find((candidate) => candidate.id === searchParams.tab)?.id
    redirect(
      `/case/${encodeURIComponent(params.id)}?analysis=${encodeURIComponent(startedId)}${keptTab ? `&tab=${keptTab}` : ""}`,
    )
  }

  let analysis: Analysis
  let saved = false
  try {
    analysis = await getAnalysis(requestedId)
  } catch (error) {
    // The agent keeps runs in memory only; after a restart the saved copy in the backend is used.
    const stored =
      error instanceof ApiError && error.status === 404 ? await loadStoredAnalysis(requestedId) : null
    if (stored) {
      analysis = stored
      saved = true
    } else {
      const message =
        error instanceof ApiError && error.status === 404
          ? "This analysis is no longer available, for example after the agent restarted."
          : describe(error, "Could not load the analysis.")
      return <RerunNotice caseId={params.id} message={message} />
    }
  }
  if (analysis.case_id !== params.id) {
    return <RerunNotice caseId={params.id} message="That analysis belongs to a different case." />
  }

  const tab = tabFrom(searchParams.tab)

  return (
    <div className="space-y-6">
      <BackLink />
      <div className="space-y-2">
        <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          {caseData.title}
        </h1>
        <p className="flex flex-col gap-y-0.5 text-sm text-slate-600 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
          <span className="font-medium text-slate-800">{caseData.policy.product}</span>
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          <span>{caseData.admission.hospital}</span>
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          <span>{caseData.admission.diagnosis}</span>
        </p>
      </div>

      <nav
        aria-label="Case views"
        className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1"
      >
        {TABS.map(({ id, label }) => (
          <Link
            key={id}
            href={`/case/${encodeURIComponent(params.id)}?analysis=${encodeURIComponent(requestedId)}&tab=${id}`}
            aria-current={tab === id ? "page" : undefined}
            className={
              tab === id
                ? "whitespace-nowrap rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-teal-800 shadow-sm"
                : "whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            }
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "analysis" && (
        <div className="space-y-6">
          {saved && <SavedResultNote finishedAt={analysis.finished_at} />}
          {analysis.status === "done" && <VerdictBoard caseData={caseData} analysis={analysis} />}
          {/* Once the result is in, it comes first; the agent's steps stay one click away. */}
          {!saved &&
            (analysis.status === "done" ? (
              <details data-testid="agent-steps" className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
                <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-slate-800 marker:hidden">
                  <span className="text-teal-700 group-open:hidden">Show </span>
                  <span className="hidden text-teal-700 group-open:inline">Hide </span>
                  how the agent reached this: every search, quote check and calculation
                </summary>
                <div className="px-2 pb-2">
                  <LiveTimeline analysisId={requestedId} refreshOnDone={false} />
                </div>
              </details>
            ) : (
              <LiveTimeline analysisId={requestedId} refreshOnDone={analysis.status === "running"} />
            ))}
        </div>
      )}
      {tab === "xray" && (
        <PolicyXray
          policy={caseData.policy}
          verdicts={analysis.verdicts}
          rules={await loadOverrideRules(analysis)}
        />
      )}
      {tab === "clocks" && (
        <ClocksTab analysis={analysis} outcome={await loadClocks(caseData)} />
      )}
      {tab === "action" && (
        <ActionTab analysis={analysis} caseData={caseData} outcome={await loadDeadlines(caseData)} />
      )}
      {tab === "compare" && (
        <CompareTab analysis={analysis} outcome={await loadBaseline(caseData.case_id)} />
      )}
    </div>
  )
}

/** The analysis the live agent saved to the backend, or null when it is not there or cannot be read. */
async function loadStoredAnalysis(analysisId: string): Promise<Analysis | null> {
  try {
    return await getStoredAnalysis(analysisId)
  } catch {
    // Not found, or the backend is down: either way the caller keeps its "Run a new analysis" notice.
    return null
  }
}

function SavedResultNote({ finishedAt }: { finishedAt: string | null | undefined }) {
  const finished = finishedAt ? new Date(finishedAt) : null
  const when =
    finished && !Number.isNaN(finished.getTime())
      ? finished.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
      : null
  return (
    <p
      data-testid="saved-result"
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600"
    >
      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
      Saved result{when ? ` · finished ${when}` : ""}
    </p>
  )
}

/** The settlement letter's date is not in the case data, so the discharge date stands in (stated in the UI). */
const assumedDecisionDate = (caseData: Case) => caseData.admission.discharged.slice(0, 10)

type DeadlinesOutcome = { deadlines: DeadlineStep[] } | { unavailableReason: string }

// Read-only on the server: no draft is created here; the user prepares one from ActionCentre.
async function loadDeadlines(caseData: Case): Promise<DeadlinesOutcome> {
  try {
    return { deadlines: await calcDeadlines(assumedDecisionDate(caseData)) }
  } catch (error) {
    return { unavailableReason: describe(error, "The deadlines could not be calculated.") }
  }
}

function ActionTab({ analysis, caseData, outcome }: { analysis: Analysis; caseData: Case; outcome: DeadlinesOutcome }) {
  if (analysis.status !== "done") {
    return <Notice message="The letter can be prepared once the analysis has finished." />
  }
  if ("unavailableReason" in outcome) return <ErrorNotice message={outcome.unavailableReason} />
  return (
    <ActionCentre
      analysisId={analysis.analysis_id}
      caseTitle={caseData.title}
      decisionDate={assumedDecisionDate(caseData)}
      deadlines={outcome.deadlines}
    />
  )
}

type BaselineOutcome = { baseline: Baseline | null } | { unavailableReason: string }

async function loadBaseline(caseId: string): Promise<BaselineOutcome> {
  try {
    return { baseline: await getBaseline(caseId) }
  } catch (error) {
    return { unavailableReason: describe(error, "The chatbot comparison could not be loaded.") }
  }
}

function CompareTab({ analysis, outcome }: { analysis: Analysis; outcome: BaselineOutcome }) {
  if ("unavailableReason" in outcome) {
    return <CompareView analysis={analysis} baseline={null} unavailableReason={outcome.unavailableReason} />
  }
  return <CompareView analysis={analysis} baseline={outcome.baseline} />
}

function Notice({ message }: { message: string }) {
  return (
    <Card className="border-slate-200 bg-slate-50">
      <CardContent className="p-4 text-sm text-slate-700">{message}</CardContent>
    </Card>
  )
}

async function loadOverrideRules(analysis: Analysis): Promise<Rule[]> {
  const ids = new Set(
    analysis.verdicts.flatMap((verdict) =>
      verdict.regulation_override ? [verdict.regulation_override.rule_id] : [],
    ),
  )
  // A rule that cannot be fetched only costs the "MC24 para 13" wording, so it falls back to the id.
  const found = await Promise.all(Array.from(ids, (id) => getRule(id).catch(() => null)))
  return found.filter((rule): rule is Rule => rule !== null)
}

type ClockOutcome = { clocks: ClockResult[] } | { unavailableReason: string }

async function loadClocks(caseData: Case): Promise<ClockOutcome> {
  const timeOf = (event: string) => caseData.timeline.find((item) => item.event === event)?.at
  try {
    const clocks = await Promise.all(
      CLOCK_SPECS.map(async (spec): Promise<ClockResult | null> => {
        const requestedAt = timeOf(spec.from)
        const decidedAt = timeOf(spec.to)
        if (!requestedAt || !decidedAt) return null
        const rule = await getRule(spec.ruleId)
        if (rule.limit_minutes == null) {
          throw new ApiError("backend", null, `Rule ${spec.ruleId} has no time limit.`)
        }
        const result = await calcTat({
          requested_at: requestedAt,
          decided_at: decidedAt,
          limit_minutes: rule.limit_minutes,
        })
        return { kind: spec.kind, rule_id: spec.ruleId, result }
      }),
    )
    return { clocks: clocks.filter((clock): clock is ClockResult => clock !== null) }
  } catch (error) {
    return { unavailableReason: describe(error, "The timing check failed.") }
  }
}

function ClocksTab({ analysis, outcome }: { analysis: Analysis; outcome: ClockOutcome }) {
  if ("unavailableReason" in outcome) {
    return <TatClocks clocks={[]} unavailableReason={outcome.unavailableReason} />
  }
  // MC24-16a sets the three-hour limit; MC24-16b says the insurer bears the extra
  // charges. A discharge-delay verdict may cite either.
  const dischargeRules = new Set(["MC24-16a", "MC24-16b"])
  const bornePaise = analysis.verdicts
    .filter((verdict) => verdict.citations.some((citation) => dischargeRules.has(citation.source_id)))
    .reduce((paise, verdict) => paise + Math.round(verdict.recoverable_amount * 100), 0)
  return (
    <TatClocks clocks={outcome.clocks} insurerBears={bornePaise > 0 ? bornePaise / 100 : undefined} />
  )
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 transition-colors hover:text-teal-800"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      All cases
    </Link>
  )
}

function RerunNotice({ caseId, message }: { caseId: string; message: string }) {
  return (
    <div className="space-y-6">
      <BackLink />
      <Card role="alert" className="border-amber-200 bg-amber-50 shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm text-amber-900">
          <p>{message}</p>
          {/* No prefetch: opening this link starts a new run, which can spend model credits. */}
          <Link
            href={`/case/${encodeURIComponent(caseId)}`}
            prefetch={false}
            className="inline-flex items-center gap-1 font-medium underline"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            Run a new analysis
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <Card role="alert" className="border-rose-200 bg-rose-50">
      <CardContent className="flex items-start gap-3 p-4 text-sm text-rose-800">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {message}
      </CardContent>
    </Card>
  )
}

