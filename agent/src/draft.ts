import { BackendError, type BackendClient } from "./backend.js"
import type { AnalysisStore } from "./store.js"
import { analysisSchema, caseSchema, type Analysis, type Case, type Verdict } from "./types.js"

/**
 * Grievance drafting (TASK-09). Every letter is built by code: the contested
 * table, amounts, dates, quotes, rule ids and the self-help notice. A model may
 * only supply the one narrative paragraph, and only if it contains no digits
 * (see src/llm/narrator.ts); otherwise the template paragraph is used.
 */

export type Tier = 1 | 2 | 3
export type Language = "en" | "hi" | "as"

/** Only contestable verdicts at or above this confidence are contested in a letter. */
export const GRIEVANCE_CONFIDENCE = 0.75

export const ASSUMED_DECISION_NOTE =
  "Assumed decision date: date of discharge. Replace it with the date on your settlement letter."

export const SELF_HELP_NOTICE = "Prepared by the policyholder using a self-help tool. Not legal advice."

export interface DeadlineStep {
  stage: string
  earliest: string
  latest: string
  rule_id: string
  note: string
}

export interface Draft {
  draft_id: string
  analysis_id: string
  tier: Tier
  language: Language
  letter_markdown: string
  local_summary: string
  human_approved: boolean
}

/** Writes the narrative paragraph; undefined means "use the template". */
export type Narrator = (input: {
  contested: readonly Verdict[]
  sampleCase: Case
  language: Language
  fallback: string
}) => Promise<string | undefined>

/** An error with the HTTP status the agent route should return. */
export class DraftError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "DraftError"
    this.status = status
  }
}

/** Decided here, not from `include_in_grievance` (the backend does not persist that flag). */
export function contestedVerdicts(verdicts: readonly Verdict[]): Verdict[] {
  return verdicts.filter((v) => v.status === "contestable" && v.confidence >= GRIEVANCE_CONFIDENCE)
}

const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Indian digit grouping, always two decimals: 110000 -> "1,10,000.00". */
export function formatInr(amount: number): string {
  return INR.format(amount)
}

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })

/** "2027-08-07" -> "7 August 2027" (UTC, so the calendar date never shifts). */
export function formatDate(isoDate: string): string {
  return DATE.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`))
}

const sumPaise = (verdicts: readonly Verdict[]): number =>
  verdicts.reduce((sum, v) => sum + Math.round(v.recoverable_amount * 100), 0) / 100

/** Markdown table cells must not break the table. */
const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()

function citationSource(verdict: Verdict): string {
  return verdict.citations.map((c) => `${c.source_type} ${c.source_id}`).join("; ")
}

function contestedTable(contested: readonly Verdict[], sampleCase: Case): string {
  const labels = new Map(sampleCase.settlement.deductions.map((d) => [d.deduction_id, d.label]))
  const rows = contested.map((v) => {
    // Scripted-mode citations have no quote yet; never print an empty "" as if quoted.
    const quotes = v.citations
      .map((c) => (c.quote.trim().length > 0 ? `"${cell(c.quote)}"` : "(quote not verified)"))
      .join("<br>")
    return `| ${v.deduction_id} | ${cell(labels.get(v.deduction_id) ?? "")} | Rs ${formatInr(v.recoverable_amount)} | ${quotes} | ${cell(citationSource(v))} |`
  })
  return [
    "| Deduction | Insurer's label | Amount recoverable | Verbatim quote | Source |",
    "|---|---|---|---|---|",
    ...(rows.length > 0 ? rows : ["| – | No deduction is contested | Rs 0.00 | – | – |"]),
  ].join("\n")
}

/**
 * The default narrative paragraph. Deliberately digit-free: amounts and dates
 * appear only in the code-built table and deadline lines.
 */
export function templateNarrative(contested: readonly Verdict[], language: Language): string {
  if (language === "hi") {
    return contested.length > 0
      ? "मैंने अपनी पॉलिसी और IRDAI के नियमों से दावे के निपटान की जाँच की है। नीचे दी गई कटौतियाँ पॉलिसी की शर्तों के अनुसार नहीं हैं, इसलिए मैं इनकी राशि वापस करने का अनुरोध करता/करती हूँ।"
      : "मैंने अपनी पॉलिसी और IRDAI के नियमों से दावे के निपटान की जाँच की है।"
  }
  if (language === "as") {
    return contested.length > 0
      ? "মই মোৰ পলিচী আৰু IRDAI-ৰ নিয়মৰ সৈতে দাবীৰ নিষ্পত্তি পৰীক্ষা কৰিছোঁ। তলত দিয়া কৰ্তনবোৰ পলিচীৰ চৰ্ত অনুসৰি নহয়, সেয়েহে মই এই ধন ঘূৰাই দিবলৈ অনুৰোধ কৰিছোঁ।"
      : "মই মোৰ পলিচী আৰু IRDAI-ৰ নিয়মৰ সৈতে দাবীৰ নিষ্পত্তি পৰীক্ষা কৰিছোঁ।"
  }
  if (contested.length === 0) {
    return "I have checked the settlement against my policy wording and the IRDAI rules."
  }
  // Reasoning sentences with digits are skipped rather than edited: amounts and
  // ids belong to the code-built table, and a half-stripped sentence misleads.
  const grounds = contested
    .flatMap((v) => v.reasoning.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 0 && !/\d/.test(sentence))
  const unique = [...new Set(grounds)]
  return [
    "I have checked the settlement of my claim against my policy wording and the IRDAI rules.",
    "The deductions listed in the table below are not supported by the terms of my policy.",
    ...unique.map((ground) => `- ${ground}`),
  ].join("\n")
}

export interface BuildDraftInput {
  analysis: Analysis
  sampleCase: Case
  tier: Tier
  language: Language
  deadlines: readonly DeadlineStep[]
  narrative: string
  draftId: string
}

const stepFor = (deadlines: readonly DeadlineStep[], stage: string) => deadlines.find((d) => d.stage === stage)

function header(sampleCase: Case): string[] {
  const { policy, patient, admission } = sampleCase
  return [
    `- Policyholder / patient: ${patient.name} — [Address] — [Phone] — [Email]`,
    `- Policy: ${policy.product}${policy.uin ? ` (UIN ${policy.uin})` : ""} — Policy number: [Policy number]`,
    `- Claim number: [Claim number]`,
    `- Hospital: ${admission.hospital}; admitted ${formatDate(admission.admitted)}, discharged ${formatDate(admission.discharged)}`,
    `- Amount claimed: Rs ${formatInr(sampleCase.settlement.claimed)}; amount deducted: Rs ${formatInr(sampleCase.settlement.total_deducted)}`,
  ]
}

function tierIntro(tier: Tier, sampleCase: Case): string[] {
  if (tier === 1) {
    return [
      "To: The Grievance Redressal Officer, [Insurer name and address]",
      "",
      `Subject: Grievance against the settlement of my claim under ${sampleCase.policy.product}`,
    ]
  }
  if (tier === 2) {
    return [
      "To: IRDAI Bima Bharosa (https://bimabharosa.irdai.gov.in, toll-free 155255)",
      "",
      "Subject: Complaint — insurer did not resolve my grievance about a health-insurance claim settlement",
      "",
      "Category: Health insurance — claim partly or wholly rejected. Previous grievance reference: [Insurer grievance number] dated [date].",
    ]
  }
  return [
    "To: The Insurance Ombudsman, [Office having jurisdiction over my address]",
    "",
    "Subject: Complaint under Rule 14 of the Insurance Ombudsman Rules, 2017 (Annexure VI-A)",
    "",
    "Annexure VI-A details:",
    "1. Complainant name and address: [Name], [Address], [Phone], [Email]",
    "2. Insurer and branch: [Insurer name], [Branch]",
    "3. Policy number / type: [Policy number] / health insurance",
    "4. Claim number: [Claim number]",
    "5. Date of representation to the insurer: [Date of tier-1 grievance]; insurer's reply: [Date or 'no reply']",
    "6. Nature of complaint: partial or full rejection of a health-insurance claim",
    "7. Relief sought: payment of the amount below with interest as per IRDAI rules",
  ]
}

function deadlineLines(tier: Tier, deadlines: readonly DeadlineStep[]): string[] {
  const insurer = stepFor(deadlines, "insurer_grievance")
  const ombudsman = stepFor(deadlines, "ombudsman")
  const lines = [`- ${ASSUMED_DECISION_NOTE}`]
  // The reply window and the Ombudsman wait run from the grievance, whose date is
  // unknown when drafting; dating them from the decision would put them in the past.
  if (insurer) {
    lines.push(`- The insurer must resolve this grievance within 14 days of receiving it (${insurer.rule_id}).`)
  }
  if (ombudsman) {
    lines.push(
      `- If the insurer rejects the grievance, does not reply within one month after I sent it, or the reply is unsatisfactory, I may complain to the Insurance Ombudsman (OMB17-14-3a), no later than ${formatDate(ombudsman.latest)} (within one year, ${ombudsman.rule_id}).`,
    )
  }
  if (tier === 3) {
    lines.push(
      "- The Ombudsman can hear complaints where the claim amount is up to Rs 50 lakh (PPI24-B-VI-3-i).",
      "- Complaining to the Insurance Ombudsman is free of charge; no fee is payable (PPI24-B-VI-3-ii).",
    )
  }
  return lines
}

const REQUEST: Record<Tier, string> = {
  1: "I request you to review the deductions listed above and pay the amount recoverable, with a written reply that cites the specific policy terms you rely on.",
  2: "I request IRDAI to direct the insurer to review these deductions and pay the amount recoverable.",
  3: "I request the Ombudsman to direct the insurer to pay the amount recoverable stated above.",
}

/** Builds one draft. Pure: every number and date comes from the analysis, case and deadlines. */
export function buildDraft(input: BuildDraftInput): Draft {
  const { analysis, sampleCase, tier, language, deadlines, narrative } = input
  const contested = contestedVerdicts(analysis.verdicts)
  const total = sumPaise(contested)
  const letter = [
    ...tierIntro(tier, sampleCase),
    "",
    "## Details",
    ...header(sampleCase),
    "",
    "## Grounds",
    narrative,
    "",
    "## Contested deductions",
    contestedTable(contested, sampleCase),
    "",
    `**Total recoverable: Rs ${formatInr(total)}**`,
    "",
    "## Request",
    REQUEST[tier],
    "",
    "## Deadlines",
    ...deadlineLines(tier, deadlines),
    "",
    "Signature: ____________________   Date: [date]",
    "",
    `_${SELF_HELP_NOTICE}_`,
  ].join("\n")

  return {
    draft_id: input.draftId,
    analysis_id: analysis.analysis_id,
    tier,
    language,
    letter_markdown: letter,
    local_summary: localSummary(language, contested, total, stepFor(deadlines, "ombudsman")?.latest),
    human_approved: false,
  }
}

/** A short plain-language summary; numbers are formatted by code in every language. */
function localSummary(language: Language, contested: readonly Verdict[], total: number, latest?: string): string {
  const amount = `Rs ${formatInr(total)}`
  const ids = contested.map((v) => v.deduction_id).join(", ")
  const date = latest ? formatDate(latest) : undefined
  if (language === "hi") {
    return contested.length > 0
      ? `आपके दावे से ${amount} गलत तरीके से काटे गए लगते हैं (${ids})। पहले बीमा कंपनी के शिकायत अधिकारी को यह पत्र भेजें।${date ? ` बीमा लोकपाल के पास शिकायत की अंतिम तिथि: ${date}।` : ""} यह एक स्व-सहायता उपकरण है, कानूनी सलाह नहीं।`
      : `हमें कोई कटौती गलत नहीं लगी (${amount})। यह एक स्व-सहायता उपकरण है, कानूनी सलाह नहीं।`
  }
  if (language === "as") {
    return contested.length > 0
      ? `আপোনাৰ দাবীৰ পৰা ${amount} ভুলকৈ কটা হোৱা যেন লাগে (${ids})। প্ৰথমে বীমা কোম্পানীৰ অভিযোগ বিষয়াক এই পত্ৰ পঠিয়াওক।${date ? ` বীমা লোকপালৰ ওচৰত অভিযোগৰ শেষ তাৰিখ: ${date}।` : ""} এইটো এটা আত্ম-সহায় সঁজুলি, আইনী পৰামৰ্শ নহয়।`
      : `কোনো কৰ্তন ভুল যেন লগা নাই (${amount})। এইটো এটা আত্ম-সহায় সঁজুলি, আইনী পৰামৰ্শ নহয়।`
  }
  return contested.length > 0
    ? `${amount} of your claim looks wrongly deducted (${ids}). Send this letter to the insurer's grievance officer first.${date ? ` Last date to complain to the Insurance Ombudsman: ${date}.` : ""} This is a self-help tool, not legal advice.`
    : `No deduction looks wrong (${amount} recoverable). This is a self-help tool, not legal advice.`
}

/* ---------- service: load, draft, persist ---------- */

export interface DraftRequest {
  store: AnalysisStore
  analysisId: string
  tier: Tier
  language: Language
}

export interface DraftService {
  draft(request: DraftRequest): Promise<Draft>
}

export interface DraftServiceDeps {
  client: BackendClient
  narrator: Narrator
  newId?: () => string
}

const asDraftError = (error: unknown, fallbackStatus = 502): DraftError => {
  if (error instanceof DraftError) return error
  if (error instanceof BackendError && error.status !== null && error.status >= 400 && error.status < 500) {
    return new DraftError(error.status, error.message)
  }
  return new DraftError(fallbackStatus, error instanceof Error ? error.message : String(error))
}

const withoutNulls = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null))

/**
 * FastAPI serialises unset optional fields as `null` (e.g. a verdict's
 * `calculation`), while the agent schema uses absent keys; started_at and
 * finished_at are optional on the backend but required (string | null) here.
 */
function fromBackendAnalysis(raw: unknown): Record<string, unknown> {
  const stored = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const verdicts = Array.isArray(stored.verdicts)
    ? stored.verdicts.map((v) => (v !== null && typeof v === "object" ? withoutNulls(v as Record<string, unknown>) : v))
    : stored.verdicts
  return { ...stored, verdicts, started_at: stored.started_at ?? "", finished_at: stored.finished_at ?? null }
}


/**
 * In-memory analysis first, then the backend's stored copy, so drafting still
 * works after an agent restart. `fromBackend` tells the caller it is persisted.
 */
async function loadAnalysis(
  store: AnalysisStore,
  client: BackendClient,
  analysisId: string,
): Promise<{ analysis: Analysis; fromBackend: boolean }> {
  const local = store.getAnalysis(analysisId)
  if (local) return { analysis: local, fromBackend: false }
  let raw: unknown
  try {
    raw = await client.getAnalysis(analysisId)
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) {
      throw new DraftError(404, `Unknown analysis_id: ${analysisId}`)
    }
    throw asDraftError(error)
  }
  const parsed = analysisSchema.safeParse(fromBackendAnalysis(raw))
  if (!parsed.success) throw new DraftError(502, `Invalid analysis ${analysisId} from the backend: ${parsed.error.message}`)
  return { analysis: parsed.data, fromBackend: true }
}

async function loadCaseForDraft(client: BackendClient, caseId: string): Promise<Case> {
  let raw: unknown
  try {
    raw = await client.getCase(caseId)
  } catch (error) {
    throw asDraftError(error)
  }
  const parsed = caseSchema.safeParse(raw)
  if (!parsed.success) throw new DraftError(502, `Invalid case ${caseId} from the backend: ${parsed.error.message}`)
  return parsed.data
}

function parseDeadlines(raw: unknown): DeadlineStep[] {
  const steps = (raw as { steps?: unknown } | null)?.steps
  if (!Array.isArray(steps)) throw new DraftError(502, "Invalid /calc/deadlines response: no steps")
  return steps.map((step) => {
    const s = step as Record<string, unknown>
    return {
      stage: String(s.stage),
      earliest: String(s.earliest),
      latest: String(s.latest),
      rule_id: String(s.rule_id),
      note: typeof s.note === "string" ? s.note : "",
    }
  })
}

export function createDraftService(deps: DraftServiceDeps): DraftService {
  const { client, narrator } = deps
  const newId = deps.newId ?? (() => `dr_${crypto.randomUUID()}`)

  return {
    async draft({ store, analysisId, tier, language }) {
      const { analysis, fromBackend } = await loadAnalysis(store, client, analysisId)
      if (analysis.status !== "done") {
        throw new DraftError(409, `Analysis ${analysisId} is ${analysis.status}; drafts need a finished analysis`)
      }
      const sampleCase = await loadCaseForDraft(client, analysis.case_id)

      // Assumed decision date: the settlement letter's date is not in the case data.
      const decisionDate = sampleCase.admission.discharged.slice(0, 10)
      let deadlines: DeadlineStep[]
      try {
        deadlines = parseDeadlines(await client.calcDeadlines({ decision_date: decisionDate }))
      } catch (error) {
        throw asDraftError(error)
      }

      const contested = contestedVerdicts(analysis.verdicts)
      // The letter goes to the insurer, so it stays in English; `language` only sets the local summary.
      const fallback = templateNarrative(contested, "en")
      const narrative = (await narrator({ contested, sampleCase, language: "en", fallback })) ?? fallback

      const draft = buildDraft({ analysis, sampleCase, tier, language, deadlines, narrative, draftId: newId() })
      try {
        // POST /drafts needs the analysis in the backend; the store is idempotent.
        if (!fromBackend) await client.saveAnalysis(analysis)
        const saved = (await client.saveDraft({ ...draft })) as Partial<Draft> | null
        return { ...draft, human_approved: saved?.human_approved === true }
      } catch (error) {
        throw asDraftError(error)
      }
    },
  }
}
