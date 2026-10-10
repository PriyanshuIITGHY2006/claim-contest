/**
 * Typed fetch client for the FastAPI backend (memory-bank/systemPatterns.md ->
 * Interfaces -> Backend). It never imports @cline/sdk: the agent tools in
 * src/llm/ wrap these calls. Responses are returned as parsed JSON; the backend
 * owns their shape and validation.
 */

export const BACKEND_TIMEOUT_MS = 30_000

type Method = "GET" | "POST"
type Json = Record<string, unknown>

/** A non-2xx response, a timeout or a network failure, always naming the call. */
export class BackendError extends Error {
  readonly method: Method
  readonly path: string
  readonly status: number | null

  constructor(method: Method, path: string, status: number | null, message: string) {
    super(message)
    this.name = "BackendError"
    this.method = method
    this.path = path
    this.status = status
  }
}

/**
 * FastAPI puts errors in `detail`: a string (HTTPException) or a list of
 * validation issues (422). Fall back to the raw body text otherwise.
 */
export function describeDetail(bodyText: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return bodyText.trim()
  }
  const detail = (parsed as { detail?: unknown } | null)?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) {
    return detail
      .map((issue) => {
        const { msg, loc } = (issue ?? {}) as { msg?: unknown; loc?: unknown }
        const where = Array.isArray(loc) ? loc.join(".") : ""
        const text = typeof msg === "string" ? msg : JSON.stringify(issue)
        return where.length > 0 ? `${where}: ${text}` : text
      })
      .join("; ")
  }
  return bodyText.trim()
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
}

export interface BackendClient {
  getCase(caseId: string): Promise<unknown>
  searchPolicy(body: Json): Promise<unknown>
  searchRules(body: Json): Promise<unknown>
  getRule(ruleId: string): Promise<unknown>
  verifyQuote(body: Json): Promise<unknown>
  calcProportionate(body: Json): Promise<unknown>
  calcWaitingPeriod(body: Json): Promise<unknown>
  calcTat(body: Json): Promise<unknown>
  calcDeadlines(body: Json): Promise<unknown>
  findPrecedents(body: Json): Promise<unknown>
  classifyNpi(body: Json): Promise<unknown>
  checkBill(body: Json): Promise<unknown>
  /** Persists a finished analysis (TASK-14); 422 when totals or deduction ids are inconsistent. */
  saveAnalysis(analysis: Json): Promise<unknown>
  /** Stores a draft (TASK-14); 409 for tier 2/3 until the tier-1 draft is approved, 404 for an unknown analysis. */
  saveDraft(draft: Json): Promise<unknown>
  /** Reads a persisted analysis (TASK-14); 404 when unknown. */
  getAnalysis(analysisId: string): Promise<unknown>
  /** One award with its full text (TASK-15); the id contains `#`, so it is URL-encoded. 404 when unknown. */
  getPrecedent(precedentId: string): Promise<unknown>
  /** The human-labelled awards of `data/eval/awards.csv` (TASK-15); `[]` until a person has labelled some. */
  getEvalAwards(): Promise<unknown>
}

/** `baseUrl` comes from settings (BACKEND_URL); it is never hard-coded. */
export function createBackendClient(baseUrl: string): BackendClient {
  const root = baseUrl.replace(/\/+$/, "")

  async function request(method: Method, path: string, body?: Json): Promise<unknown> {
    const call = `${method} ${path}`
    let response: Response
    try {
      response = await fetch(`${root}${path}`, {
        method,
        headers: body === undefined ? { accept: "application/json" } : {
          accept: "application/json",
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
      })
    } catch (error) {
      if (isTimeout(error)) {
        throw new BackendError(method, path, null, `Backend timed out after ${BACKEND_TIMEOUT_MS} ms: ${call}`)
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new BackendError(method, path, null, `Backend unreachable: ${call} (${reason})`)
    }

    const text = await response.text()
    if (!response.ok) {
      const detail = describeDetail(text)
      const suffix = detail.length > 0 ? `: ${detail}` : ""
      throw new BackendError(method, path, response.status, `Backend ${call} failed with ${response.status}${suffix}`)
    }
    try {
      return text.length > 0 ? JSON.parse(text) : null
    } catch {
      throw new BackendError(method, path, response.status, `Backend ${call} returned invalid JSON`)
    }
  }

  const segment = encodeURIComponent

  return {
    getCase: (caseId) => request("GET", `/cases/${segment(caseId)}`),
    searchPolicy: (body) => request("POST", "/policy/search", body),
    searchRules: (body) => request("POST", "/rules/search", body),
    getRule: (ruleId) => request("GET", `/rules/${segment(ruleId)}`),
    verifyQuote: (body) => request("POST", "/verify-quote", body),
    calcProportionate: (body) => request("POST", "/calc/proportionate", body),
    calcWaitingPeriod: (body) => request("POST", "/calc/waiting-period", body),
    calcTat: (body) => request("POST", "/calc/tat", body),
    calcDeadlines: (body) => request("POST", "/calc/deadlines", body),
    findPrecedents: (body) => request("POST", "/precedents/search", body),
    classifyNpi: (body) => request("POST", "/classify/npi", body),
    checkBill: (body) => request("POST", "/calc/bill-check", body),
    saveAnalysis: (analysis) => request("POST", "/analyses", analysis),
    saveDraft: (draft) => request("POST", "/drafts", draft),
    getAnalysis: (analysisId) => request("GET", `/analyses/${segment(analysisId)}`),
    getPrecedent: (precedentId) => request("GET", `/precedents/${segment(precedentId)}`),
    getEvalAwards: () => request("GET", "/eval/awards"),
  }
}
