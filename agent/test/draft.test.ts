import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { BackendError, type BackendClient } from "../src/backend.js"
import {
  ASSUMED_DECISION_NOTE,
  DraftError,
  buildDraft,
  contestedVerdicts,
  createDraftService,
  formatInr,
  templateNarrative,
  type DeadlineStep,
  type Narrator,
} from "../src/draft.js"
import { safeNarrative } from "../src/llm/narrator.js"
import { createCaseLoader } from "../src/scripted.js"
import { buildServer } from "../src/server.js"
import { DEFAULT_DATA_DIR, loadSettings } from "../src/settings.js"
import { createAnalysisStore } from "../src/store.js"
import type { Analysis, Case, Citation, Verdict } from "../src/types.js"

const loadCase = createCaseLoader(DEFAULT_DATA_DIR)

const ROOM_QUOTE =
  "Expenses relating to Associated medical expenses will be considered in proportion to the eligible room rent"
const ASSOCIATED_QUOTE =
  "Associated medical expenses means medical expenses such as Professional fees, OT charges, Procedure charges"
const SUBSUMED_QUOTE = "Admission/Discharge Kit"
const LOW_CONFIDENCE_QUOTE = "Documentation charges"

const policyCite = (quote: string): Citation => ({
  source_type: "policy",
  source_id: "star_fho_v19",
  quote,
  verified: true,
})

function verdict(id: string, status: Verdict["status"], amount: number, quote: string, confidence = 0.9): Verdict {
  return {
    deduction_id: id,
    status,
    recoverable_amount: amount,
    reasoning: `${id}: pharmacy, consumables, implants and diagnostics are not associated medical expenses.`,
    citations: [policyCite(quote)],
    confidence,
  }
}

/** Case A as the gate accepts it: only D3 is contested. */
function caseAAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    analysis_id: "an_case_a",
    case_id: "case_a",
    status: "done",
    verdicts: [
      verdict("D1", "valid", 0, ROOM_QUOTE),
      verdict("D2", "valid", 0, ASSOCIATED_QUOTE),
      verdict("D3", "contestable", 40719.76, ASSOCIATED_QUOTE, 0.92),
      verdict("D4", "valid", 0, SUBSUMED_QUOTE),
    ],
    total_recoverable: 40719.76,
    flags: [{ kind: "letter_not_specific", rule_id: "MC24-17b", detail: "No specific clause cited" }],
    started_at: "2026-09-01T10:00:00.000Z",
    finished_at: "2026-09-01T10:01:00.000Z",
    ...overrides,
  }
}

/** /calc/deadlines for decision 2026-08-07 (case A discharge date). */
const CASE_A_DEADLINES: DeadlineStep[] = [
  { stage: "insurer_grievance", earliest: "2026-08-07", latest: "2026-08-21", rule_id: "PPI24-B-VI-2-i", note: "" },
  { stage: "ombudsman", earliest: "2026-09-07", latest: "2027-08-07", rule_id: "OMB17-14-3b", note: "" },
]

const noNarrator: Narrator = async () => undefined

async function draftFor(tier: 1 | 2 | 3, language: "en" | "hi" | "as" = "en", analysis = caseAAnalysis()) {
  const sampleCase = await loadCase("case_a")
  return buildDraft({
    analysis,
    sampleCase,
    tier,
    language,
    deadlines: CASE_A_DEADLINES,
    narrative: templateNarrative(contestedVerdicts(analysis.verdicts), language),
    draftId: "dr_1",
  })
}

describe("letter content", () => {
  it("acceptance 1: case A letter lists every contestable deduction, 40,719.76 Indian style and each quote", async () => {
    const draft = await draftFor(1)
    expect(draft.letter_markdown).toContain("D3")
    expect(draft.letter_markdown).toContain("40,719.76")
    expect(draft.letter_markdown).toContain(ASSOCIATED_QUOTE)
    expect(draft.letter_markdown).toContain("policy star_fho_v19")
    expect(draft.letter_markdown).toContain("Prepared by the policyholder using a self-help tool. Not legal advice.")
    expect(draft.letter_markdown).toContain("[Policy number]")
    expect(draft.letter_markdown).toContain("[Claim number]")
    expect(draft.letter_markdown).toContain("Family Health Optima Insurance Plan")
    expect(draft.letter_markdown).toContain(ASSUMED_DECISION_NOTE)
    // The 14-day reply window and the one-month Ombudsman wait run from the
    // grievance, not the decision date, so they are stated relative to it.
    expect(draft.letter_markdown).toContain("within 14 days of receiving it (PPI24-B-VI-2-i)")
    expect(draft.letter_markdown).toContain("one month after I sent it")
    expect(draft.letter_markdown).toContain("no later than 7 August 2027")
    expect(draft.letter_markdown).not.toContain("21 August 2026")
    expect(draft.letter_markdown).not.toContain("7 September 2026")
    expect(draft).toMatchObject({ draft_id: "dr_1", analysis_id: "an_case_a", tier: 1, language: "en", human_approved: false })
  })

  it("acceptance 2: valid deductions and low-confidence contestable ones are not listed as contested", async () => {
    const analysis = caseAAnalysis()
    analysis.verdicts.push(verdict("D5", "contestable", 800, LOW_CONFIDENCE_QUOTE, 0.6))
    const contested = contestedVerdicts(analysis.verdicts)
    expect(contested.map((v) => v.deduction_id)).toEqual(["D3"])

    const draft = await draftFor(1, "en", analysis)
    const table = draft.letter_markdown.split("## Contested deductions")[1]?.split("##")[0] ?? ""
    expect(table).toContain("| D3 |")
    for (const id of ["D1", "D2", "D4", "D5"]) expect(table).not.toContain(`| ${id} |`)
    expect(draft.letter_markdown).not.toContain(LOW_CONFIDENCE_QUOTE)
    expect(draft.letter_markdown).toContain("Total recoverable: Rs 40,719.76")
  })

  it("decides 'contested' itself and ignores include_in_grievance", async () => {
    const analysis = caseAAnalysis()
    analysis.verdicts = analysis.verdicts.map((v) =>
      v.deduction_id === "D3" ? { ...v, include_in_grievance: false } : { ...v, include_in_grievance: true },
    )
    expect(contestedVerdicts(analysis.verdicts).map((v) => v.deduction_id)).toEqual(["D3"])
  })

  it("acceptance 3: tier 3 has the one-year deadline and the Rs 50 lakh / free-of-charge notes", async () => {
    const draft = await draftFor(3)
    expect(draft.letter_markdown).toContain("7 August 2027")
    expect(draft.letter_markdown).toMatch(/Rs 50 lakh/)
    expect(draft.letter_markdown).toMatch(/free of charge/i)
    for (const rule of ["OMB17-14-3b", "PPI24-B-VI-3-i", "PPI24-B-VI-3-ii", "OMB17-14-3a"]) {
      expect(draft.letter_markdown).toContain(rule)
    }
    expect(draft.letter_markdown).toContain("Insurance Ombudsman")
    expect(draft.letter_markdown).toContain("40,719.76")
  })

  it("tier 2 is a Bima Bharosa complaint with the contested table", async () => {
    const draft = await draftFor(2)
    expect(draft.letter_markdown).toMatch(/Bima Bharosa/)
    expect(draft.letter_markdown).toContain("| D3 |")
  })

  it("the local summary is in the requested language with code-formatted numbers", async () => {
    const en = await draftFor(1, "en")
    const hi = await draftFor(1, "hi")
    const as = await draftFor(1, "as")
    for (const draft of [en, hi, as]) expect(draft.local_summary).toContain("40,719.76")
    expect(hi.local_summary).toMatch(/[\u0900-\u097F]/)
    expect(as.local_summary).toMatch(/[\u0980-\u09FF]/)
    expect(en.local_summary).not.toMatch(/[\u0900-\u09FF]/)
  })

  it("never prints an empty quote (scripted-mode citations) as if it were quoted", async () => {
    const analysis = caseAAnalysis()
    analysis.verdicts = analysis.verdicts.map((v) =>
      v.deduction_id === "D3" ? { ...v, citations: [{ ...policyCite(""), verified: false }] } : v,
    )
    const draft = await draftFor(1, "en", analysis)
    expect(draft.letter_markdown).toContain("(quote not verified)")
    expect(draft.letter_markdown).not.toContain('""')
  })

  it("formats rupees Indian style", () => {
    expect(formatInr(40719.76)).toBe("40,719.76")
    expect(formatInr(110000)).toBe("1,10,000.00")
  })
})

describe("narrative", () => {
  it("the template narrative has no digits, so amounts only ever come from code", () => {
    const text = templateNarrative(contestedVerdicts(caseAAnalysis().verdicts), "en")
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toMatch(/\d/)
  })

  it("a model paragraph containing any digit is discarded in favour of the template", () => {
    const fallback = "Template paragraph."
    expect(safeNarrative("The insurer wrongly cut Rs 40,000 from my claim.", fallback)).toBe(fallback)
    expect(safeNarrative("I paid for room 2.", fallback)).toBe(fallback)
    expect(safeNarrative("   ", fallback)).toBe(fallback)
    expect(safeNarrative(undefined, fallback)).toBe(fallback)
    expect(safeNarrative("The insurer applied the room-rent cut to items it does not cover.", fallback)).toBe(
      "The insurer applied the room-rent cut to items it does not cover.",
    )
  })

  it("the service uses the narrator's paragraph when it is digit-free", async () => {
    const sampleCase = await loadCase("case_a")
    const { service } = fakeService({ sampleCase, narrator: async () => "A clean narrator paragraph." })
    const store = createAnalysisStore()
    const id = storeDone(store, caseAAnalysis())
    const draft = await service.draft({ store, analysisId: id, tier: 1, language: "en" })
    expect(draft.letter_markdown).toContain("A clean narrator paragraph.")
  })
})

/* ---------- service + HTTP ---------- */

interface FakeOptions {
  sampleCase: Case
  narrator?: Narrator
  backendAnalysis?: Analysis
  saveDraft?: (draft: Record<string, unknown>) => Promise<unknown>
}

/** A backend client double: only the calls drafting makes are implemented. */
function fakeService(options: FakeOptions) {
  const calls: string[] = []
  const client = {
    getCase: vi.fn(async () => {
      calls.push("getCase")
      return options.sampleCase
    }),
    calcDeadlines: vi.fn(async (body: Record<string, unknown>) => {
      calls.push(`calcDeadlines:${String(body.decision_date)}`)
      return { steps: CASE_A_DEADLINES }
    }),
    saveAnalysis: vi.fn(async () => {
      calls.push("saveAnalysis")
      return { analysis_id: "x" }
    }),
    getAnalysis: vi.fn(async (id: string) => {
      calls.push(`getAnalysis:${id}`)
      if (options.backendAnalysis) return options.backendAnalysis
      throw new BackendError("GET", `/analyses/${id}`, 404, "Backend GET failed with 404: Analysis not found")
    }),
    saveDraft: vi.fn(async (draft: Record<string, unknown>) => {
      calls.push(`saveDraft:${String(draft.tier)}`)
      return options.saveDraft ? options.saveDraft(draft) : { ...draft, human_approved: false }
    }),
  } as unknown as BackendClient
  const service = createDraftService({ client, narrator: options.narrator ?? noNarrator })
  return { service, client, calls }
}

function storeDone(store: ReturnType<typeof createAnalysisStore>, analysis: Analysis): string {
  const created = store.createAnalysis(analysis.case_id)
  store.finish(created.analysis_id, {
    status: analysis.status,
    verdicts: analysis.verdicts,
    total_recoverable: analysis.total_recoverable,
    flags: analysis.flags,
    finished_at: analysis.finished_at,
  })
  return created.analysis_id
}

describe("draft service", () => {
  it("keeps the letter in English for a Hindi or Assamese summary; the narrator is asked for English", async () => {
    const sampleCase = await loadCase("case_a")
    const asked: string[] = []
    const { service } = fakeService({
      sampleCase,
      narrator: async ({ language }) => {
        asked.push(language)
        return undefined
      },
    })
    const store = createAnalysisStore()
    for (const language of ["hi", "as"] as const) {
      const id = storeDone(store, caseAAnalysis())
      const draft = await service.draft({ store, analysisId: id, tier: 1, language })
      expect(draft.letter_markdown).not.toMatch(/[\u0900-\u09FF]/)
      expect(draft.local_summary).toMatch(/[\u0900-\u09FF]/)
    }
    expect(asked).toEqual(["en", "en"])
  })

  it("uses the discharge date as decision date, saves the analysis, then the draft", async () => {
    const sampleCase = await loadCase("case_a")
    const { service, calls } = fakeService({ sampleCase })
    const store = createAnalysisStore()
    const id = storeDone(store, caseAAnalysis())
    const draft = await service.draft({ store, analysisId: id, tier: 1, language: "en" })
    expect(calls).toEqual(["getCase", "calcDeadlines:2026-08-07", "saveAnalysis", "saveDraft:1"])
    expect(draft.analysis_id).toBe(id)
    expect(draft.letter_markdown).toContain("40,719.76")
  })

  it("falls back to GET /analyses/{id} on the backend when the analysis is not in memory", async () => {
    const sampleCase = await loadCase("case_a")
    // FastAPI serialises unset optional fields as null (seen in an end-to-end run).
    const stored = caseAAnalysis({ analysis_id: "an_saved" })
    const backendAnalysis = {
      ...stored,
      verdicts: stored.verdicts.map((v) => ({ ...v, calculation: null, regulation_override: null, include_in_grievance: null })),
    } as unknown as Analysis
    const { service, calls } = fakeService({ sampleCase, backendAnalysis })
    const draft = await service.draft({ store: createAnalysisStore(), analysisId: "an_saved", tier: 1, language: "en" })
    expect(calls[0]).toBe("getAnalysis:an_saved")
    expect(calls).not.toContain("saveAnalysis")
    expect(draft.letter_markdown).toContain(ASSOCIATED_QUOTE)
    expect(draft.analysis_id).toBe("an_saved")
  })

  it("unknown everywhere -> 404; still running -> 409", async () => {
    const sampleCase = await loadCase("case_a")
    const { service } = fakeService({ sampleCase })
    const store = createAnalysisStore()
    await expect(service.draft({ store, analysisId: "nope", tier: 1, language: "en" })).rejects.toMatchObject({
      status: 404,
    })
    const running = store.createAnalysis("case_a")
    await expect(
      service.draft({ store, analysisId: running.analysis_id, tier: 1, language: "en" }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("acceptance 5: tier 2 before tier 1 approval -> the backend's 409 surfaces as 409", async () => {
    const sampleCase = await loadCase("case_a")
    const { service } = fakeService({
      sampleCase,
      saveDraft: async () => {
        throw new BackendError("POST", "/drafts", 409, "Backend POST /drafts failed with 409: Tier-1 draft must be approved first")
      },
    })
    const store = createAnalysisStore()
    const id = storeDone(store, caseAAnalysis())
    const attempt = service.draft({ store, analysisId: id, tier: 2, language: "en" })
    await expect(attempt).rejects.toBeInstanceOf(DraftError)
    await expect(attempt).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/approved/) })
  })
})

describe("HTTP: POST /analyses/:id/draft and GET /baseline/:case_id", () => {
  let dataDir: string
  const BASELINE = { answer_markdown: "## Chatbot answer\nThe deductions look fine.", errors: [{ claim: "All fine", why_wrong: "D3" }] }

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "baseline-"))
    await mkdir(path.join(dataDir, "baseline"), { recursive: true })
    await writeFile(path.join(dataDir, "baseline", "case_a.json"), JSON.stringify(BASELINE))
  })

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  async function server(service = fakeService({ sampleCase: undefined as unknown as Case }).service) {
    const settings = loadSettings({ AGENT_MODE: "scripted", BACKEND_URL: "http://localhost:8000", DATA_DIR: dataDir })
    const store = createAnalysisStore()
    const app = await buildServer({ settings, store, loadCase, delayMs: 0, draftService: service })
    return { app, store }
  }

  it("returns the draft for a finished analysis", async () => {
    const { service } = fakeService({ sampleCase: await loadCase("case_a") })
    const { app, store } = await server(service)
    const id = storeDone(store, caseAAnalysis())
    const response = await app.inject({ method: "POST", url: `/analyses/${id}/draft`, payload: { tier: 1, language: "en" } })
    expect(response.statusCode).toBe(200)
    const draft = response.json() as { letter_markdown: string; tier: number }
    expect(draft.tier).toBe(1)
    expect(draft.letter_markdown).toContain("40,719.76")
    await app.close()
  })

  it("acceptance 5 (HTTP): tier 2 before approval -> 409", async () => {
    const { service } = fakeService({
      sampleCase: await loadCase("case_a"),
      saveDraft: async () => {
        throw new BackendError("POST", "/drafts", 409, "Backend POST /drafts failed with 409: Tier-1 draft must be approved first")
      },
    })
    const { app, store } = await server(service)
    const id = storeDone(store, caseAAnalysis())
    const response = await app.inject({ method: "POST", url: `/analyses/${id}/draft`, payload: { tier: 2, language: "en" } })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ message: expect.stringMatching(/approved/) })
    await app.close()
  })

  it("rejects a bad tier or language with 400", async () => {
    const { app } = await server()
    for (const payload of [{ tier: 4, language: "en" }, { tier: 1, language: "fr" }, {}]) {
      const response = await app.inject({ method: "POST", url: "/analyses/x/draft", payload })
      expect(response.statusCode).toBe(400)
    }
    await app.close()
  })

  it("acceptance 4: a missing baseline file -> 404; an existing one -> 200", async () => {
    const { app } = await server()
    const missing = await app.inject({ method: "GET", url: "/baseline/case_z" })
    expect(missing.statusCode).toBe(404)
    const found = await app.inject({ method: "GET", url: "/baseline/case_a" })
    expect(found.statusCode).toBe(200)
    expect(found.json()).toEqual(BASELINE)
    await app.close()
  })

  it("rejects case ids that could escape data/baseline with 400", async () => {
    const { app } = await server()
    for (const id of ["..%2Fcases%2Fcase_a", "case.a", "a%5Cb"]) {
      const response = await app.inject({ method: "GET", url: `/baseline/${id}` })
      expect(response.statusCode).toBe(400)
    }
    await app.close()
  })
})
