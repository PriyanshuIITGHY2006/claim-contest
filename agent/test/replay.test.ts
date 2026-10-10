import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackendError, createBackendClient } from "../src/backend.js"
import { acceptVerdicts } from "../src/gate.js"
import { createTools } from "../src/llm/tools.js"
import {
  MIN_REPLAY_CHARS,
  agreement,
  buildReplayCase,
  citationVerificationRate,
  createReplayRegistry,
  hasEnoughReplayText,
  removeDecision,
  toCsv,
  toVerdictStatus,
  type PrecedentDetail,
  type ReplayCase,
} from "../src/replay.js"
import { buildServer } from "../src/server.js"
import { createCaseLoader } from "../src/scripted.js"
import { loadSettings } from "../src/settings.js"
import { createAnalysisStore } from "../src/store.js"
import { caseSchema, type Verdict } from "../src/types.js"

/*
 * The three awards below are real text from data/*.pdf (as the backend's
 * GET /precedents/{id} returns it, including the PDF's odd characters), kept
 * inline so the tests never need the backend or a model.
 */

const AWARD_288_LINES = [
  "Case No.11.12.1782/2011-12",
  "Mrs.Paramdeep Kaur Ahuja",
  "Vs",
  "ICICI Lombard General Insurance Co Ltd",
  "Synopsis to Award No. IO(CHN)/G/025/2012-13",
  "The complainantÆs claim for the hospitalization expenses in respect of her father was",
  "partly settled by cashless approval by the insurer and the balance claim was settled talking",
  "into account the eligible room rent category thus disallowing major part of the claim. She",
  "contended that though the ceiling on the room rent is acceptable, reducing the other",
  "charges in proportion to the eligible room rent is not correct.",
  "The Insurer submitted that the insured took treatment in the Hospital with a room rent of",
  "Rs.8900/- per day exceeding his entitled limit of Rs.1500/- per day. Therefore all Hospital",
  "charges are paid in proportion to his eligibility for room rent as per policy conditions.",
  "When the insured sought to explain the basis of settlement, the insurer stated that as per",
  "Special Condition No.XXV the expenses under different heads were restricted in",
  "proportion to the eligible room rent of Rs.1500/- per day (as applicable to Grade B û",
  "Punjab) vis-α-vis the actual room rent of Rs.8900/- per day which works out to 16.8% and",
  "applied deduction of 10% co-pay as per policy condition No.iii. The complainant during",
  "the hearing seemed to have been convinced of the settlement of the claim explained as",
  "above by the insurerÆs representative, which may be in accordance with the policy",
  "conditions, but sought to know as to why the discount allowed by the Hospital to the",
  "extent of Rs.5340/-towards Room Rent was not deducted from the actual room rent as",
  "per the bill and the other expenses were accordingly re-worked. There is some merit in the",
  "argument of the insured. The insurer has not clarified on this aspect. But on perusal of the",
  "Bill, it is not specifically mentioned that the discount is towards Room Rent as stated by",
  "the insured and it appears to be on the overall bill. However, obviously the said discount",
  "would involve a component of ôRoom Rentö, though the actual quantum cannot be",
  "ascertained. Therefore, the ôother Expensesö reduced on proportionate basis as stated",
  "above would also get reduced to that extent. In order to extend the said  benefit, since",
  "actual amount could not be worked out in the absence of the exact quantum of discount",
  "towards Room Rent, the Insurance Ombudsman was inclined to grant an ex-gratia of",
  "Rs.2,000/- (Rupees two thousand only) to the insured.",
  "*********************************************************************************************",
  "Office of Insurance Ombudsman, Chennai",
]

const AWARD_20_13_LINES = [
  "Case No.11-004-0390-13",
  "Mr. Viral D. Nayak  Vs. United India Insurance Co. Ltd.",
  "Award dated 11th October 2013",
  "Partial repudiation of Mediclaim",
  "A hospitalization expense of the complainant for Rs.17,272/- lodged by the",
  "complainant was partially settled by the Respondent for Rs.9,182/-thereafter in addition",
  "paid Rs.6,330/- subsequent to his grievance with R.O., by deducting an amount of",
  "Rs.1,760/-  on the basis of eligible room rent under Sum Insured of the policy.",
  "Therefore complaint dismissed.",
  "*********************************************************",
]

const AWARD_9_132_LINES = [
  "Case  No.IO(CHN) 11.02.1015/2008-09",
  "Smt. Y. Jayalakshmi",
  "vs",
  "The New India Assurance Co. Ltd",
  "Award No.037 dated 13.08.08",
  "The complainant Smt Jayalakshmi was covered under individual Mediclaim Policy of",
  "the insurer for a sum insured of Rs.1 lac and cumulative bonus of Rs.15,000/.  She",
  "had the policy continuously for 3 years. During the policy year 2007-08, the insured",
  "had fallen down from the cot at her home and  was hospitalized for headache and",
  "uneasiness.  The TPA repudiated the claim on the ground of non-disclosure of Pre-",
  "Existing diseases at the time of taking the policy.",
  "To have more clarity about the illness, the Forum has obtained the views of an expert",
  "who has opined that, ôthe hospitalisation was due to the progression of symptoms",
  "resulting from a fall a few weeks earlier.  Her hypertension and diabetes have not",
  "caused the subdural haematoma. Absence of any indication that she was on",
  "anticoagulants or asprin, along with a report that clotting parameters are normal,",
  "would negate even this cause.  By elimination of all causes, we are left with trauma as",
  "the cause.  The absence of reference to this fall could be due to absence of any",
  "immediate consequences of injury.ö",
  "Taking into account all of the above, it is reasonably felt that the hospitalization was",
  "due to Trauma which is the proximate cause,   and not contributed by pre existing",
  "ailments or the medication which was being taken for the same.  Hence the decision",
  "of the TPA/insurer to reject the claim under the condition of pre-existing illness and",
  "non-disclosure of material facts is not tenable and the insurer was directed  to process",
  "and settle the claim as per the other terms and conditions of the policy. The",
  "Complaint was allowed.",
  "Chennai  Ombudsman Centre",
]

const AWARD_9_105_LINES = [
  "Order No.: BPL/GI/08-09/15                       Case No.: GI/NIA/0208/175",
  "Order dated 17/07/2008",
  "Brief Background",
  "Mr. Manoj Jain had obtained Mediclaim policy No. 450800/48/06/20/70000847 for the",
  "period from 21.07.06 to 20.07.07 covering his sister Mrs. Monika Jain for Rs.",
  "50,000/- from The New India Assurance Co. Ltd., Indore.",
  "As per the Complainant his sister Smt. Monica Jain was admitted in Recovery",
  "Hospital, Indore for the period 28.06.07 to 01.07.07 due to complaints of ôExcess",
  "Bleedingö.  On Discharge from the hospital, he preferred a claim for Rs. 10219/- with",
  "TPA of Respondent M/s Family Health Plan Ltd which repudiated the claim on the",
  "ground that the treatment arising from or traceable to pregnancy and childbirth is not",
  "covered as per the given standard mediclaim policy.",
  "For the sake of natural justice, hearing was held on 15.07.2008 at Bhopal. The",
  "Complainant was absent and the Respondent was represented by Mr. P.M. Rekhade,",
  "Asstt. Manager of The New India Assurance Co. Ltd., DO-2, Indore.",
  "Observations:",
  "There is no dispute that the Complainant was covered under the above-mentioned",
  "policy.",
  "Decision: -",
  "Held that the decision of the Respondent to repudiate the claim on the ground",
  "mentioned above is fair & justified. Therefore, I found no reason to interfere",
  "with the decision taken by the Respondent.  The complaint is dismissed",
  "without any relief.",
  "BHOPAL OMBUDSMAN CENTRE",
]

const award = (lines: readonly string[]): string => lines.join("\n")

describe("acceptance 1: removeDecision", () => {
  it("strips lines containing award / dismissed / allowed / directed to pay (any case) and keeps the rest in order", () => {
    const text = award([
      "The complainant was admitted on 3 August for a fall.",
      "The insurer deducted Rs 1,000 as room rent.",
      "The Ombudsman passed the AWARD on 5 September.",
      "Both parties were heard in person.",
      "Complaint DISMISSED.",
      "The insurer is Directed To Pay Rs 5.",
      "The claim was Allowed in part.",
      "The hospital bill was produced.",
    ])

    expect(removeDecision(text)).toBe(
      award([
        "The complainant was admitted on 3 August for a fall.",
        "The insurer deducted Rs 1,000 as room rent.",
        "Both parties were heard in person.",
        "The hospital bill was produced.",
      ]),
    )
  })

  it("real award Book17#288: the ex-gratia sentence that wraps over two lines is removed whole", () => {
    const kept = removeDecision(award(AWARD_288_LINES))

    expect(kept).not.toMatch(/ex-gratia|2,000|inclined|two thousand/i)
    expect(kept).toContain("Mrs.Paramdeep Kaur Ahuja")
    expect(kept.split("\n").slice(-3)).toEqual([
      "actual amount could not be worked out in the absence of the exact quantum of discount",
      "*********************************************************************************************",
      "Office of Insurance Ombudsman, Chennai",
    ])
  })

  it("real award Book20#13 (dismissed): the verdict line and the award header are gone, the facts stay", () => {
    const kept = removeDecision(award(AWARD_20_13_LINES))

    expect(kept).not.toMatch(/dismissed|award/i)
    expect(kept).toContain("partially settled by the Respondent")
    expect(hasEnoughReplayText(kept)).toBe(true)
  })

  it("real award Book9#132 (allowed): the direction to the insurer and the closing line are removed", () => {
    const kept = removeDecision(award(AWARD_9_132_LINES))

    expect(kept).not.toMatch(/allowed|directed|not tenable|award|settle the claim/i)
    expect(kept).toContain("Hence the decision")
    expect(kept.split("\n").at(-1)).toBe("Chennai  Ombudsman Centre")
  })

  it("cuts from a decision heading to the end and keeps the facts before it", () => {
    const kept = removeDecision(award(AWARD_9_105_LINES))

    expect(kept).toContain("Brief Background")
    expect(kept).toContain("Order No.: BPL/GI/08-09/15")
    expect(kept).not.toMatch(/Observations|Decision|justified|dismissed|interfere|no dispute/i)
    expect(kept.split("\n").at(-1)).toBe("Asstt. Manager of The New India Assurance Co. Ltd., DO-2, Indore.")
  })

  it("does not take an 'Order dated ...' or 'Award dated ...' header for a decision heading", () => {
    const body = "The complainant described the deduction in detail and asked for a review of it."
    const kept = removeDecision(`Order No.: X Case No.: Y\nOrder dated 17/07/2008\n${body}`)

    expect(kept).toBe(`Order No.: X Case No.: Y\nOrder dated 17/07/2008\n${body}`)
  })

  it.each(["DECISION:", "Findings", "Conclusion -", "ORDER", "Observations of the Forum :", "Decision:-"])(
    "cuts at the heading %j, case-insensitively",
    (heading) => {
      expect(removeDecision(`Facts first.\n${heading}\nThe insurer must act.`)).toBe("Facts first.")
    },
  )
})

describe("acceptance 2: agreement metric", () => {
  it("maps award outcomes to verdict statuses", () => {
    expect(toVerdictStatus("allowed")).toBe("contestable")
    expect(toVerdictStatus("partly")).toBe("contestable")
    expect(toVerdictStatus("dismissed")).toBe("valid")
  })

  it("returns accuracy, the majority-class baseline and the counts per label", () => {
    const result = agreement([
      { label: "allowed", predicted: "contestable" },
      { label: "partly", predicted: "valid" },
      { label: "dismissed", predicted: "valid" },
      { label: "dismissed", predicted: "contestable" },
      { label: "allowed", predicted: "contestable" },
    ])

    expect(result.total).toBe(5)
    expect(result.correct).toBe(3)
    expect(result.accuracy).toBeCloseTo(0.6)
    // contestable-class awards (allowed + partly) are 3 of 5 -> 0.6
    expect(result.majorityBaseline).toBeCloseTo(0.6)
    expect(result.perLabel).toEqual({
      allowed: { total: 2, correct: 2 },
      partly: { total: 1, correct: 0 },
      dismissed: { total: 2, correct: 1 },
    })
  })

  it("counts needs_info as a miss", () => {
    const result = agreement([
      { label: "dismissed", predicted: "needs_info" },
      { label: "allowed", predicted: "contestable" },
    ])

    expect(result.correct).toBe(1)
    expect(result.perLabel.dismissed).toEqual({ total: 1, correct: 0 })
  })

  it("does not divide by zero on empty input", () => {
    const result = agreement([])

    expect(result).toEqual({
      total: 0,
      correct: 0,
      accuracy: 0,
      majorityBaseline: 0,
      perLabel: {
        allowed: { total: 0, correct: 0 },
        partly: { total: 0, correct: 0 },
        dismissed: { total: 0, correct: 0 },
      },
    })
  })

  it("citationVerificationRate is verified citations over all citations, 0 when there are none", () => {
    const cite = (verified: boolean) => ({ source_type: "rule" as const, source_id: "MC24-13", quote: "q", verified })
    const verdict = (citations: Verdict["citations"]): Verdict => ({
      deduction_id: "D1",
      status: "valid",
      recoverable_amount: 0,
      reasoning: "",
      citations,
      confidence: 1,
    })

    expect(citationVerificationRate([verdict([cite(true), cite(true), cite(false)]), verdict([cite(true)])])).toEqual({
      verified: 3,
      total: 4,
      rate: 0.75,
    })
    expect(citationVerificationRate([])).toEqual({ verified: 0, total: 0, rate: 0 })
  })

  it("toCsv quotes commas, quotes and newlines", () => {
    expect(toCsv(["a", "b"], [{ a: "x,y", b: 'say "hi"\nnow' }, { a: "plain", b: "" }])).toBe(
      'a,b\n"x,y","say ""hi""\nnow"\nplain,\n',
    )
  })
})

const PRECEDENT_288: PrecedentDetail = {
  precedent_id: "Mediclaim-Book17.pdf#288",
  book: "Mediclaim-Book17.pdf",
  case_no: "11.12.1782/2011-12",
  year: 2012,
  excerpt: AWARD_288_LINES.slice(0, 5).join(" "),
  outcome: "partly",
  text: award(AWARD_288_LINES),
}

describe("acceptance 5: buildReplayCase", () => {
  const built = buildReplayCase(PRECEDENT_288)

  it("validates against the agent's case schema", () => {
    expect(caseSchema.safeParse(built).success).toBe(true)
  })

  it("has the replay id, one placeholder deduction, no bill, no timeline and no answer key", () => {
    expect(built.case_id).toBe("replay:Mediclaim-Book17.pdf#288")
    expect(built.settlement.deductions).toEqual([
      { deduction_id: "D1", label: "Claim repudiated or reduced", amount: 0, line_ids: [], insurer_reason: "" },
    ])
    expect(built.bill).toEqual({ lines: [], total: 0 })
    expect(built.timeline).toEqual([])
    expect(built.expected).toEqual([])
  })

  it("names no real insurer product", () => {
    expect(built.policy.product).toBe("Unknown (historical award)")
  })

  it("puts the award without its decision in letter_text and carries no outcome field", () => {
    expect(built.settlement.letter_text).toBe(removeDecision(PRECEDENT_288.text))
    expect(built.settlement.letter_text).not.toMatch(/ex-gratia|inclined|2,000/i)
    expect(built.settlement.letter_text).toContain("eligible room rent")
    expect(JSON.stringify(built)).not.toContain('"outcome"')
  })
})

describe("replay verdicts under the citation gate", () => {
  const replayCase: Pick<ReplayCase, "case_id" | "settlement"> = buildReplayCase(PRECEDENT_288)
  const verifications = [
    { source_type: "rule" as const, source_id: "MC24-13", quote: "60 months", verified: true },
  ]
  const verdict = (overrides: Partial<Verdict>): Verdict => ({
    deduction_id: "D1",
    status: "contestable",
    recoverable_amount: 0,
    reasoning: "The proportionate cut looks wrong.",
    citations: [{ source_type: "rule", source_id: "MC24-13", quote: "60 months", verified: true }],
    confidence: 0.9,
    ...overrides,
  })

  it("accepts a contestable verdict that recovers 0, because an award has no rupee amount to recover", () => {
    const result = acceptVerdicts(replayCase, [verdict({})], verifications, [])

    expect(result.ok).toBe(true)
    expect(result.accepted[0]?.status).toBe("contestable")
  })

  it("still demands a verified citation", () => {
    const result = acceptVerdicts(replayCase, [verdict({ citations: [] })], verifications, [])

    expect(result.ok).toBe(false)
    expect(result.rejected[0]?.reasons.join(" ")).toMatch(/citation/)
  })

  it("rejects any invented rupee amount", () => {
    const result = acceptVerdicts(replayCase, [verdict({ recoverable_amount: 500 })], verifications, [])

    expect(result.ok).toBe(false)
    expect(result.rejected[0]?.reasons.join(" ")).toMatch(/replay/)
  })

  it("leaves real cases alone: a contestable verdict that recovers 0 is still rejected", () => {
    const real = { ...replayCase, case_id: "case_a" }

    const result = acceptVerdicts(real, [verdict({})], verifications, [])

    expect(result.rejected[0]?.reasons.join(" ")).toMatch(/positive amount/)
  })
})

describe("get_case override for in-memory replay cases", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ case_id: "case_a", expected: [] }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function getCase(registry = createReplayRegistry()) {
    const tool = createTools(createBackendClient("http://backend.test"), (id) => registry.get(id)).ALL_TOOLS.find(
      (candidate) => candidate.name === "get_case",
    )
    if (tool === undefined) throw new Error("get_case not exported")
    return (caseId: string) => tool.execute({ case_id: caseId }, {} as never)
  }

  it("returns the in-memory case for a replay id without calling the backend", async () => {
    const registry = createReplayRegistry()
    registry.register(buildReplayCase(PRECEDENT_288))

    const result = (await getCase(registry)("replay:Mediclaim-Book17.pdf#288")) as Record<string, unknown>

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.case_id).toBe("replay:Mediclaim-Book17.pdf#288")
    expect(result).not.toHaveProperty("expected")
  })

  it("sends every other id to the backend, as before", async () => {
    const registry = createReplayRegistry()
    registry.register(buildReplayCase(PRECEDENT_288))

    await getCase(registry)("case_a")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://backend.test/cases/case_a")
  })

  it("sends an unregistered replay id to the backend, which answers 404", async () => {
    await getCase()("replay:unknown")

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://backend.test/cases/replay%3Aunknown")
  })
})

describe("find_precedents hides the award being replayed", () => {
  const RESULTS = [
    { precedent_id: "Mediclaim-Book17.pdf#288", book: "Mediclaim-Book17.pdf", case_no: "1", excerpt: "x", score: 9, outcome: "partly_allowed" },
    { precedent_id: "Mediclaim-Book9.pdf#132", book: "Mediclaim-Book9.pdf", case_no: "2", excerpt: "y", score: 5, outcome: "allowed" },
  ]

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("drops a registered replay's own award, so its outcome cannot be looked up", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(RESULTS), { status: 200 })))
    const registry = createReplayRegistry()
    registry.register(buildReplayCase(PRECEDENT_288))
    const tool = createTools(
      createBackendClient("http://backend.test"),
      (id) => registry.get(id),
      (precedentId) => registry.get(`replay:${precedentId}`) !== undefined,
    ).ALL_TOOLS.find((candidate) => candidate.name === "find_precedents")
    if (tool === undefined) throw new Error("find_precedents not exported")

    const result = (await tool.execute({ query: "pre-existing disease" }, {} as never)) as { precedent_id: string }[]

    expect(result.map((r) => r.precedent_id)).toEqual(["Mediclaim-Book9.pdf#132"])
  })

  it("returns every award when nothing is being replayed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(RESULTS), { status: 200 })))
    const tool = createTools(createBackendClient("http://backend.test")).ALL_TOOLS.find(
      (candidate) => candidate.name === "find_precedents",
    )
    if (tool === undefined) throw new Error("find_precedents not exported")

    const result = (await tool.execute({ query: "pre-existing disease" }, {} as never)) as unknown[]

    expect(result).toHaveLength(2)
  })
})

describe("POST /replay/:precedent_id", () => {
  const SHORT_TEXT = "Case No.1\nA very short award.\nComplaint dismissed."

  async function makeServer(getPrecedent: (id: string) => Promise<PrecedentDetail>) {
    const settings = loadSettings({ AGENT_MODE: "scripted", BACKEND_URL: "http://localhost:8000" })
    const replays = createReplayRegistry()
    const server = await buildServer({
      settings,
      store: createAnalysisStore(),
      loadCase: createCaseLoader(settings.dataDir),
      delayMs: 0,
      getPrecedent,
      replays,
    })
    return { server, replays }
  }

  const encoded = encodeURIComponent(PRECEDENT_288.precedent_id)

  it("returns an analysis_id, registers the case without its decision and ends with done and no verdicts", async () => {
    const asked: string[] = []
    const { server, replays } = await makeServer(async (id) => {
      asked.push(id)
      return PRECEDENT_288
    })

    const response = await server.inject({ method: "POST", url: `/replay/${encoded}` })

    expect(response.statusCode).toBe(200)
    const { analysis_id: analysisId } = response.json() as { analysis_id: string }
    expect(analysisId.length).toBeGreaterThan(0)
    expect(asked).toEqual(["Mediclaim-Book17.pdf#288"])
    const registered = replays.get("replay:Mediclaim-Book17.pdf#288")
    expect(registered?.settlement.letter_text).not.toMatch(/ex-gratia|inclined|2,000/i)

    const analysis = await server.waitFor(analysisId)
    expect(analysis.status).toBe("done")
    expect(analysis.case_id).toBe("replay:Mediclaim-Book17.pdf#288")
    expect(analysis.verdicts).toEqual([])
    await server.close()
  })

  it("answers 404 for an unknown precedent id", async () => {
    const { server } = await makeServer(async (id) => {
      throw new BackendError("GET", `/precedents/${encodeURIComponent(id)}`, 404, `Unknown precedent_id: ${id}`)
    })

    const response = await server.inject({ method: "POST", url: `/replay/${encodeURIComponent("Mediclaim-Book3.pdf#999999")}` })

    expect(response.statusCode).toBe(404)
    expect((response.json() as { message: string }).message).toMatch(/999999/)
    await server.close()
  })

  it("answers 502 when the backend itself fails", async () => {
    const { server } = await makeServer(async () => {
      throw new BackendError("GET", "/precedents/x", null, "Backend unreachable")
    })

    const response = await server.inject({ method: "POST", url: `/replay/${encoded}` })

    expect(response.statusCode).toBe(502)
    await server.close()
  })

  it("answers 422 when too little text is left after redaction, and starts no analysis", async () => {
    const { server, replays } = await makeServer(async () => ({ ...PRECEDENT_288, text: SHORT_TEXT }))

    const response = await server.inject({ method: "POST", url: `/replay/${encoded}` })

    expect(response.statusCode).toBe(422)
    expect((response.json() as { message: string }).message).toMatch(/too little text after redaction/)
    expect(replays.get("replay:Mediclaim-Book17.pdf#288")).toBeUndefined()
    await server.close()
  })
})

describe("replay input size", () => {
  it("needs at least MIN_REPLAY_CHARS characters after trimming", () => {
    expect(MIN_REPLAY_CHARS).toBe(300)
    expect(hasEnoughReplayText("x".repeat(MIN_REPLAY_CHARS))).toBe(true)
    expect(hasEnoughReplayText(`  ${"x".repeat(MIN_REPLAY_CHARS - 1)}  `)).toBe(false)
    expect(hasEnoughReplayText("")).toBe(false)
  })
})
