"use client"

import { useState } from "react"
import { CalendarPlus, Copy, Download, FileDown, FileText, Lock, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  ApiError,
  approveDraft,
  calcDeadlines,
  letterPdf,
  requestDraft,
  type DeadlineStep,
  type Draft,
  type DraftLanguage,
  type DraftTier,
} from "@/lib/api"
import { buildIcs, deadlineEvents } from "@/lib/ics"
import { LetterPreview } from "@/components/LetterPreview"

interface ActionCentreProps {
  analysisId: string
  caseTitle: string
  /** Assumed decision date (discharge date), ISO YYYY-MM-DD. */
  decisionDate: string
  /** POST /calc/deadlines for `decisionDate`, loaded by the page. */
  deadlines: DeadlineStep[]
}

const TIERS: { tier: DraftTier; title: string; to: string }[] = [
  { tier: 1, title: "Insurer grievance", to: "Grievance Redressal Officer" },
  { tier: 2, title: "Bima Bharosa", to: "IRDAI complaint portal" },
  { tier: 3, title: "Insurance Ombudsman", to: "Ombudsman complaint" },
]

const LANGUAGES: { value: DraftLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी (Hindi)" },
  { value: "as", label: "অসমীয়া (Assamese)" },
]

const ASSUMED_DECISION_NOTE =
  "Assumed decision date: date of discharge. Replace it with the date on your settlement letter."

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
const formatDate = (iso: string) => DATE.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`))

const messageOf = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback)

function saveFile(name: string, type: string, content: string | Blob) {
  const url = URL.createObjectURL(typeof content === "string" ? new Blob([content], { type }) : content)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function ActionCentre({ analysisId, caseTitle, decisionDate, deadlines }: ActionCentreProps) {
  const [tier, setTier] = useState<DraftTier>(1)
  const [language, setLanguage] = useState<DraftLanguage>("en")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [letter, setLetter] = useState("")
  const [view, setView] = useState<"write" | "preview">("write")
  const [tier1Approved, setTier1Approved] = useState(false)
  const [tier1DraftId, setTier1DraftId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [sentOn, setSentOn] = useState("")
  const [steps, setSteps] = useState<DeadlineStep[]>(deadlines)
  const [stepsError, setStepsError] = useState<string | null>(null)

  const [pdfBusy, setPdfBusy] = useState(false)

  async function downloadPdf() {
    setPdfBusy(true)
    setError(null)
    try {
      const title = `${TIERS.find((entry) => entry.tier === tier)?.title ?? "Grievance"} letter (tier ${tier})`
      saveFile(`grievance-tier-${tier}.pdf`, "application/pdf", await letterPdf(title, letter))
      setStatus("PDF downloaded.")
    } catch (failure) {
      setError(messageOf(failure, "The PDF could not be prepared."))
    } finally {
      setPdfBusy(false)
    }
  }

  async function prepare(nextTier: DraftTier, nextLanguage: DraftLanguage) {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await requestDraft(analysisId, nextTier, nextLanguage)
      setDraft(result)
      setLetter(result.letter_markdown)
      setTier(nextTier)
      setView("write")
      if (nextTier === 1) {
        setTier1DraftId(result.draft_id)
        // A new tier-1 draft is a new row on the backend; it needs its own approval.
        setTier1Approved(result.human_approved)
      }
    } catch (failure) {
      setError(messageOf(failure, "The letter could not be prepared."))
    } finally {
      setBusy(false)
    }
  }

  async function toggleApproval(checked: boolean) {
    if (!tier1DraftId) return
    setBusy(true)
    setError(null)
    try {
      const updated = await approveDraft(tier1DraftId, checked)
      setTier1Approved(updated.human_approved)
    } catch (failure) {
      setError(messageOf(failure, "The approval could not be saved."))
    } finally {
      setBusy(false)
    }
  }

  function changeLanguage(next: DraftLanguage) {
    setLanguage(next)
    // Only re-draft when a letter already exists; choosing a language alone never writes a draft.
    if (draft) void prepare(tier, next)
  }

  async function changeSentOn(value: string) {
    setSentOn(value)
    setStepsError(null)
    if (!value) {
      setSteps(deadlines)
      return
    }
    try {
      setSteps(await calcDeadlines(decisionDate, value))
    } catch (failure) {
      setStepsError(messageOf(failure, "The deadlines could not be recalculated."))
    }
  }

  async function copyLetter() {
    try {
      await navigator.clipboard.writeText(letter)
      setStatus("Copied to the clipboard.")
    } catch (failure) {
      setStatus(`Could not copy: ${failure instanceof Error ? failure.message : String(failure)}`)
    }
  }

  const grievanceSent = sentOn !== "" && stepsError === null
  const events = deadlineEvents(steps, grievanceSent)

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <ol aria-label="Escalation tiers" className="grid gap-2 sm:grid-cols-3">
            {TIERS.map((item) => {
              const locked = item.tier !== 1 && !tier1Approved
              const active = draft !== null && tier === item.tier
              return (
                <li key={item.tier}>
                  <button
                    type="button"
                    disabled={locked || busy || (item.tier === 1 && draft === null)}
                    onClick={() => void prepare(item.tier, language)}
                    aria-current={active ? "step" : undefined}
                    className={
                      active
                        ? "flex w-full items-start gap-2 rounded-xl border border-teal-300 bg-teal-50 p-3 text-left"
                        : "flex w-full items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
                    }
                  >
                    <span className="text-sm">
                      <span className="block font-semibold text-slate-900">
                        Tier {item.tier} · {item.title}
                      </span>
                      <span className="block text-xs text-slate-600">{item.to}</span>
                    </span>
                    {locked && <Lock className="ml-auto h-4 w-4 shrink-0 text-slate-400" aria-label="locked until tier 1 is approved" />}
                  </button>
                </li>
              )
            })}
          </ol>

          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              <span className="block font-medium text-slate-700">Language</span>
              <select
                aria-label="Language"
                value={language}
                disabled={busy}
                onChange={(event) => changeLanguage(event.target.value as DraftLanguage)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
              >
                {LANGUAGES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {draft === null && (
              <Button type="button" onClick={() => void prepare(1, language)} disabled={busy}>
                <FileText aria-hidden="true" />
                {busy ? "Preparing…" : "Prepare letter"}
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            The language sets the plain-language summary; the letter itself stays in English so the insurer and the Ombudsman can act on it.
          </p>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {draft && (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div data-testid="local-summary" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
              {draft.local_summary}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Letter view" className="inline-flex rounded-lg bg-slate-100 p-1">
                {(["write", "preview"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={view === mode}
                    onClick={() => setView(mode)}
                    className={view === mode ? "rounded-md bg-white px-3 py-1 text-sm font-semibold shadow-sm" : "rounded-md px-3 py-1 text-sm text-slate-600"}
                  >
                    {mode === "write" ? "Edit" : "Preview"}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void copyLetter()}>
                  <Copy aria-hidden="true" />
                  Copy
                </Button>
                <Button type="button" size="sm" disabled={pdfBusy} onClick={() => void downloadPdf()}>
                  <FileDown aria-hidden="true" />
                  {pdfBusy ? "Preparing PDF…" : "Download PDF"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => saveFile(`grievance-tier-${tier}.md`, "text/markdown", letter)}>
                  <Download aria-hidden="true" />
                  Download .md
                </Button>
              </div>
            </div>

            {view === "write" ? (
              <textarea
                aria-label="Letter"
                value={letter}
                onChange={(event) => setLetter(event.target.value)}
                rows={18}
                className="w-full rounded-xl border border-slate-300 p-3 font-mono text-sm leading-relaxed"
              />
            ) : (
              <LetterPreview markdown={letter} />
            )}

            <p data-testid="action-status" aria-live="polite" className="min-h-5 text-sm text-slate-600">
              {status}
            </p>

            {tier === 1 && (
              <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <input
                  type="checkbox"
                  checked={tier1Approved}
                  disabled={busy || tier1DraftId === null}
                  onChange={(event) => void toggleApproval(event.target.checked)}
                  className="mt-0.5"
                />
                <span>I have reviewed and approve the tier 1 letter. This unlocks the Bima Bharosa and Ombudsman drafts.</span>
              </label>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Escalation timeline</h2>
            <label className="space-y-1 text-sm">
              <span className="block font-medium text-slate-700">I sent my grievance on</span>
              <input
                type="date"
                aria-label="I sent my grievance on"
                value={sentOn}
                min={decisionDate}
                onChange={(event) => void changeSentOn(event.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1"
              />
            </label>
          </div>
          {stepsError && (
            <p role="alert" className="text-sm text-rose-800">
              {stepsError}
            </p>
          )}
          <Timeline steps={steps} grievanceSent={grievanceSent} />
          <Button
            type="button"
            variant="outline"
            onClick={() => saveFile("escalation-deadlines.ics", "text/calendar", buildIcs(events, { caseTitle }))}
            disabled={events.length === 0}
          >
            <CalendarPlus aria-hidden="true" />
            Add deadlines to calendar (.ics)
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function Timeline({ steps, grievanceSent }: { steps: DeadlineStep[]; grievanceSent: boolean }) {
  const insurer = steps.find((step) => step.stage === "insurer_grievance")
  const ombudsman = steps.find((step) => step.stage === "ombudsman")
  return (
    <ol data-testid="escalation-timeline" className="space-y-3 border-l-2 border-teal-200 pl-4 text-sm text-slate-700">
      <li>
        <span className="font-semibold text-slate-900">Tier 1 · Insurer grievance. </span>
        {grievanceSent && insurer
          ? `The insurer must reply by ${formatDate(insurer.latest)} (within 14 days of receiving it, ${insurer.rule_id}).`
          : `Send the letter now. The insurer must resolve it within 14 days of receiving it (${insurer?.rule_id ?? "PPI24-B-VI-2-i"}).`}
      </li>
      <li>
        <span className="font-semibold text-slate-900">Tier 2 · Bima Bharosa. </span>
        If the reply is unsatisfactory, complain to IRDAI at bimabharosa.irdai.gov.in or call 155255.
      </li>
      <li>
        <span className="font-semibold text-slate-900">Tier 3 · Insurance Ombudsman. </span>
        {grievanceSent && ombudsman
          ? `From ${formatDate(ombudsman.earliest)} if there is no reply (earlier if the insurer rejects it, OMB17-14-3a)`
          : "If the insurer rejects the grievance, does not reply within one month after you sent it, or the reply is unsatisfactory (OMB17-14-3a)"}
        {ombudsman ? `, and no later than ${formatDate(ombudsman.latest)} (within one year, ${ombudsman.rule_id}).` : "."}
        {" "}Free of charge, for claims up to Rs 50 lakh.
      </li>
      <li className="text-xs text-slate-500">{ASSUMED_DECISION_NOTE}</li>
    </ol>
  )
}
