/**
 * Typed client for the backend (FastAPI, NEXT_PUBLIC_API_URL) and the agent
 * service (Node, NEXT_PUBLIC_AGENT_URL). Types mirror the "Data model" block in
 * memory-bank/systemPatterns.md; field names are snake_case on the wire.
 */

export type BillCategory =
  | "room"
  | "nursing"
  | "professional_fee"
  | "ot"
  | "procedure"
  | "pharmacy"
  | "consumables"
  | "implant"
  | "diagnostics"
  | "non_medical"

export type VerdictStatus = "valid" | "contestable" | "needs_info"
export type FlagKind = "tat_breach" | "letter_not_specific" | "regulation_override"
export type AnalysisStatus = "running" | "done" | "error"

export interface BillLine {
  line_id: string
  date: string
  particulars: string
  category: BillCategory
  rate: number
  units: number
  amount: number
}

export interface Deduction {
  deduction_id: string
  label: string
  amount: number
  line_ids: string[]
  insurer_reason: string
}

export interface PolicyRef {
  doc_id: string
  file: string
  product: string
  uin?: string | null
  version?: string | null
  schedule: {
    sum_insured: number
    inception_date: string
    eligible_room_rent_per_day?: number | null
    continuous_coverage?: boolean | null
    declared_conditions?: string[] | null
  }
}

export interface Admission {
  hospital: string
  admitted: string
  discharged: string
  diagnosis: string
  room_category: string
  cashless: boolean
}

export interface Case {
  case_id: string
  title: string
  synthetic_notice: string
  policy: PolicyRef
  patient: { name: string; age: number }
  admission: Admission
  bill: { lines: BillLine[]; total: number }
  settlement: {
    claimed: number
    approved: number
    total_deducted: number
    deductions: Deduction[]
    letter_text: string
  }
  timeline: { event: string; at: string }[]
  expected: { deduction_id: string; status: VerdictStatus; recoverable: number; basis: string[] }[]
}

export interface CaseSummary {
  id: string
  title: string
  summary: string
}

export interface Citation {
  source_type: "policy" | "rule"
  source_id: string
  quote: string
  verified: boolean
}

export interface CalcResult {
  calculator: string
  inputs: Record<string, unknown>
  result: Record<string, unknown>
  [key: string]: unknown
}

export interface RegulationOverride {
  policy_says: string
  law_says: string
  rule_id: string
}

export interface Verdict {
  deduction_id: string
  status: VerdictStatus
  recoverable_amount: number
  reasoning: string
  citations: Citation[]
  calculation?: CalcResult
  confidence: number
  regulation_override?: RegulationOverride
}

export interface Flag {
  kind: FlagKind
  rule_id: string
  detail: string
}

export interface Analysis {
  analysis_id: string
  case_id: string
  status: AnalysisStatus
  verdicts: Verdict[]
  total_recoverable: number
  flags: Flag[]
  started_at: string | null
  finished_at: string | null
}

export type AgentEventType = "step" | "tool_call" | "tool_result" | "verdict" | "done" | "error"

export interface AgentEvent {
  seq: number
  type: AgentEventType
  message: string
  data?: unknown
  at: string
}

export interface Rule {
  id: string
  doc: string
  para: string
  page: number
  verified: boolean
  ground: string
  text: string
  test: string
  overrides_policy?: boolean | null
  limit_minutes?: number | null
}

export interface TatRequest {
  requested_at: string
  decided_at: string
  limit_minutes: number
}

export interface TatResult {
  elapsed_minutes: number
  limit_minutes: number
  breached: boolean
  over_by_minutes: number
}

export type DraftTier = 1 | 2 | 3
export type DraftLanguage = "en" | "hi" | "as"

export interface Draft {
  draft_id: string
  analysis_id: string
  tier: DraftTier
  language: DraftLanguage
  letter_markdown: string
  local_summary: string
  human_approved: boolean
}

/** One step of POST /calc/deadlines (`stage`: insurer_grievance | ombudsman). */
export interface DeadlineStep {
  stage: string
  earliest: string
  latest: string
  rule_id: string
  note: string
}

export interface BaselineError {
  claim: string
  why_wrong: string
}

/** A recorded plain-chatbot answer (data/baseline/<case_id>.json, served by the agent). */
export interface Baseline {
  answer_markdown: string
  errors: BaselineError[]
}

export type Service = "backend" | "agent"

export class ApiError extends Error {
  readonly service: Service
  readonly status: number | null
  /** The server's own explanation (FastAPI `detail`) when it sent one. */
  readonly detail: string | null

  constructor(
    service: Service,
    status: number | null,
    message: string,
    cause?: unknown,
    detail: string | null = null,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = "ApiError"
    this.service = service
    this.status = status
    this.detail = detail
  }
}

// Literal `process.env.NEXT_PUBLIC_*` reads are required for Next to inline them in the browser bundle.
function baseUrl(service: Service): string {
  const name = service === "backend" ? "NEXT_PUBLIC_API_URL" : "NEXT_PUBLIC_AGENT_URL"
  const url = service === "backend" ? process.env.NEXT_PUBLIC_API_URL : process.env.NEXT_PUBLIC_AGENT_URL
  if (!url) {
    throw new ApiError(service, null, `${name} is not set; copy .env.example to .env at the repo root`)
  }
  return url.replace(/\/+$/, "")
}

const REQUEST_TIMEOUT_MS = 10_000
// Reading two PDFs (and the first call also warms the policy registry) takes longer than a lookup.
const UPLOAD_TIMEOUT_MS = 60_000

/**
 * The server's reason: FastAPI's `detail` (a string, or the messages of a validation
 * error list) or the agent service's `message`.
 */
async function readDetail(response: Response): Promise<string | null> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // An error page that is not JSON simply has no detail to show.
    return null
  }
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item: { msg?: unknown }) =>
        typeof item?.msg === "string" ? item.msg.replace(/^Value error, /, "") : null,
      )
      .filter((message): message is string => message !== null)
    return messages.length > 0 ? messages.join("; ") : null
  }
  // The agent (fastify) answers errors as { message }.
  const message = (body as { message?: unknown } | null)?.message
  return typeof message === "string" ? message : null
}

async function request<T>(
  service: Service,
  path: string,
  init?: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const url = `${baseUrl(service)}${path}`
  let response: Response
  try {
    // A signal also opts the call out of Next's per-render GET memoization, which
    // would otherwise hand the status poll the same "running" answer every time.
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new ApiError(service, null, `Could not reach the ${service} service at ${url}`, error)
  }
  if (!response.ok) {
    const detail = await readDetail(response)
    // The reason is both kept on `detail` (for callers that show it alone) and
    // appended to the message, so every error banner says why the call failed.
    throw new ApiError(
      service,
      response.status,
      `The ${service} service answered ${response.status} for ${path}${detail ? `: ${detail}` : ""}`,
      undefined,
      detail,
    )
  }
  return (await response.json()) as T
}

export function listCases(): Promise<CaseSummary[]> {
  return request<CaseSummary[]>("backend", "/cases")
}

export function getCase(caseId: string): Promise<Case> {
  return request<Case>("backend", `/cases/${encodeURIComponent(caseId)}`)
}

export function startAnalysis(caseId: string): Promise<{ analysis_id: string }> {
  return request<{ analysis_id: string }>("agent", "/analyses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ case_id: caseId }),
  })
}

/** One row of the backend's `GET /analyses`: an analysis without its verdicts. */
export interface AnalysisSummary {
  analysis_id: string
  case_id: string
  status: AnalysisStatus
  total_recoverable: number
  finished_at: string | null
}

export interface DocumentSummary {
  doc_id: string
  title: string
  kind: "policy" | "regulation"
  pages: number
}

/** Pre-filled guess from `POST /cases/upload`; every value is editable before it becomes a case. */
export interface CaseDraft {
  doc_id: string
  claimed?: number | null
  approved?: number | null
  deductions: Deduction[]
  bill_lines: BillLine[]
  letter_text: string
  warnings: string[]
}

/** The confirmed case sent to `POST /cases`. */
export interface NewCase {
  doc_id: string
  schedule: PolicyRef["schedule"]
  patient: { name: string; age: number }
  admission: Admission
  bill_lines: BillLine[]
  deductions: Deduction[]
  claimed: number
  approved: number
  letter_text: string
  timeline?: { event: string; at: string }[]
}

export function listDocuments(): Promise<DocumentSummary[]> {
  return request<DocumentSummary[]>("backend", "/documents")
}

export function uploadDocuments(settlementPdf: File, billPdf: File, docId: string): Promise<CaseDraft> {
  const form = new FormData()
  form.append("settlement_pdf", settlementPdf)
  form.append("bill_pdf", billPdf)
  form.append("doc_id", docId)
  // No content-type header: the browser adds the multipart boundary itself.
  return request<CaseDraft>("backend", "/cases/upload", { method: "POST", body: form }, UPLOAD_TIMEOUT_MS)
}

export function createCase(body: NewCase): Promise<{ case_id: string }> {
  return request<{ case_id: string }>("backend", "/cases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Stored analyses from the backend, newest first; pass a case id to see only that case's runs. */
export function listAnalyses(caseId?: string): Promise<AnalysisSummary[]> {
  const query = caseId === undefined ? "" : `?case_id=${encodeURIComponent(caseId)}`
  return request<AnalysisSummary[]>("backend", `/analyses${query}`)
}

/** An analysis the live agent saved to the backend; it outlives an agent restart, unlike `getAnalysis`. */
export function getStoredAnalysis(analysisId: string): Promise<Analysis> {
  return request<Analysis>("backend", `/analyses/${encodeURIComponent(analysisId)}`)
}

export function getAnalysis(analysisId: string): Promise<Analysis> {
  return request<Analysis>("agent", `/analyses/${encodeURIComponent(analysisId)}`)
}

export function getRule(ruleId: string): Promise<Rule> {
  return request<Rule>("backend", `/rules/${encodeURIComponent(ruleId)}`)
}

export function calcTat(body: TatRequest): Promise<TatResult> {
  return request<TatResult>("backend", "/calc/tat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const JSON_HEADERS = { "content-type": "application/json" }

/** Agent POST /analyses/:id/draft: builds a draft and stores it; 409 for tier 2/3 before tier-1 approval. */
export function requestDraft(analysisId: string, tier: DraftTier, language: DraftLanguage): Promise<Draft> {
  return request<Draft>("agent", `/analyses/${encodeURIComponent(analysisId)}/draft`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ tier, language }),
  })
}

/** Backend PATCH /drafts/{id}: the human approval gate that unlocks tiers 2 and 3. */
export function approveDraft(draftId: string, humanApproved: boolean): Promise<Draft> {
  return request<Draft>("backend", `/drafts/${encodeURIComponent(draftId)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ human_approved: humanApproved }),
  })
}

/** Backend POST /calc/deadlines. */
export async function calcDeadlines(decisionDate: string, grievanceSentOn?: string): Promise<DeadlineStep[]> {
  const body = grievanceSentOn
    ? { decision_date: decisionDate, grievance_sent_on: grievanceSentOn }
    : { decision_date: decisionDate }
  const result = await request<{ steps: DeadlineStep[] }>("backend", "/calc/deadlines", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
  return result.steps
}

/** Agent GET /baseline/:case_id; `null` when no chatbot answer has been recorded (404). */
export async function getBaseline(caseId: string): Promise<Baseline | null> {
  try {
    return await request<Baseline>("agent", `/baseline/${encodeURIComponent(caseId)}`)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** SSE endpoint of an analysis. `EventSource` opens it from the browser, so this is a URL, not a fetch. */
export function agentEventsUrl(analysisId: string): string {
  return `${baseUrl("agent")}/analyses/${encodeURIComponent(analysisId)}/events`
}

