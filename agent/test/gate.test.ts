import { describe, expect, it } from "vitest"
import {
  CONFIDENCE_THRESHOLD,
  acceptVerdicts,
  type CalcRecord,
  type VerificationRecord,
} from "../src/gate.js"
import { mapSdkEvent } from "../src/runner.js"
import { createCaseLoader } from "../src/scripted.js"
import { DEFAULT_DATA_DIR } from "../src/settings.js"
import type { Case, Citation, Verdict } from "../src/types.js"

const loadCase = createCaseLoader(DEFAULT_DATA_DIR)

const FHO = "star_fho_v19"
const ROOM_QUOTE =
  "Expenses relating to Associated medical expenses will be considered in proportion to the eligible room rent"
const ASSOCIATED_QUOTE =
  "Associated medical expenses means medical expenses such as Professional fees, OT charges, Procedure charges"
const SUBSUMED_QUOTE = "Admission/Discharge Kit"
const MORATORIUM_QUOTE = "60 months of continuous coverage"

const policy = (quote: string): Citation => ({ source_type: "policy", source_id: FHO, quote, verified: true })
const rule = (id: string, quote: string): Citation => ({ source_type: "rule", source_id: id, quote, verified: true })

/** Every quote used below, as verify_quote returned it (with page) in this analysis. */
const VERIFICATIONS: VerificationRecord[] = [
  { source_type: "policy", source_id: FHO, quote: ROOM_QUOTE, verified: true, match: "exact", page: 5 },
  { source_type: "policy", source_id: FHO, quote: ASSOCIATED_QUOTE, verified: true, match: "exact", page: 4 },
  { source_type: "policy", source_id: FHO, quote: SUBSUMED_QUOTE, verified: true, match: "exact", page: 31 },
  { source_type: "rule", source_id: "MC24-13", quote: MORATORIUM_QUOTE, verified: true, match: "exact", page: 23 },
]

const D2_LINES = ["L02", "L03", "L04", "L05", "L06"]
const D3_LINES = ["L07", "L08", "L09", "L10", "L11", "L12", "L13"]

/** Real /calc/proportionate outputs for case A (eligible 5000, actual 8000, 4 days). */
function proportionate(amount: number, lineIds: string[], recoverable: number): CalcRecord {
  return {
    tool: "calc_proportionate",
    input: {
      eligible_room_rent: 5000,
      actual_room_rent: 8000,
      days: 4,
      deduction: { amount, line_ids: lineIds },
    },
    output: { ratio: 0.625, correct_deduction: 56250, recoverable_amount: recoverable },
  }
}

const CASE_A_CALCS: CalcRecord[] = [
  proportionate(12000, ["L01"], 0),
  proportionate(44250, D2_LINES, 0),
  proportionate(40719.76, D3_LINES, 40719.76),
]

/** Case A's expected verdicts, built from the calc results and verified quotes above. */
function caseAVerdicts(): Verdict[] {
  return [
    {
      deduction_id: "D1",
      status: "valid",
      recoverable_amount: 0,
      reasoning: "Room above the Rs 5,000/day eligibility; the excess room rent is not payable.",
      citations: [policy(ROOM_QUOTE)],
      confidence: 0.9,
    },
    {
      deduction_id: "D2",
      status: "valid",
      recoverable_amount: 0,
      reasoning: "Proportionate cut on associated medical expenses matches the calculator.",
      citations: [policy(ASSOCIATED_QUOTE)],
      confidence: 0.85,
    },
    {
      deduction_id: "D3",
      status: "contestable",
      recoverable_amount: 40719.76,
      reasoning: "Pharmacy, consumables, implants and diagnostics are not associated medical expenses.",
      citations: [policy(ASSOCIATED_QUOTE)],
      calculation: { calculator: "calc_proportionate", inputs: {}, result: { recoverable_amount: 40719.76 } },
      confidence: 0.92,
    },
    {
      deduction_id: "D4",
      status: "valid",
      recoverable_amount: 0,
      reasoning: "Admission kit and documentation charges are subsumed into room charges.",
      citations: [policy(SUBSUMED_QUOTE)],
      confidence: 0.8,
    },
  ]
}

function replace(verdicts: Verdict[], id: string, patch: Partial<Verdict>): Verdict[] {
  return verdicts.map((verdict) => (verdict.deduction_id === id ? { ...verdict, ...patch } : verdict))
}

async function caseA(): Promise<Case> {
  return loadCase("case_a")
}

describe("acceptVerdicts (citation gate)", () => {
  it("acceptance 1: rejects a verdict whose citation has verified: false", async () => {
    const verdicts = replace(caseAVerdicts(), "D1", {
      citations: [{ ...policy(ROOM_QUOTE), verified: false }],
    })
    const result = acceptVerdicts(await caseA(), verdicts, VERIFICATIONS, CASE_A_CALCS)
    expect(result.rejected.map((r) => r.deduction_id)).toEqual(["D1"])
    expect(result.rejected[0]?.reasons.join(" ")).toMatch(/not verified/)
  })

  it("rejects a citation the model marks verified but verify_quote never confirmed", async () => {
    const verdicts = replace(caseAVerdicts(), "D1", {
      citations: [policy("an invented clause the agent never checked")],
    })
    const result = acceptVerdicts(await caseA(), verdicts, VERIFICATIONS, CASE_A_CALCS)
    expect(result.rejected.map((r) => r.deduction_id)).toEqual(["D1"])
    expect(result.rejected[0]?.reasons.join(" ")).toMatch(/verify_quote/)
  })

  it("acceptance 2: rejects a contestable amount that no calc tool returned", async () => {
    const verdicts = replace(caseAVerdicts(), "D3", { recoverable_amount: 44250 })
    const result = acceptVerdicts(await caseA(), verdicts, VERIFICATIONS, CASE_A_CALCS)
    expect(result.rejected.map((r) => r.deduction_id)).toEqual(["D3"])
    expect(result.rejected[0]?.reasons.join(" ")).toMatch(/40719\.76/)
  })

  it("rejects D2 contestable at the full 44250 when a proportionate result exists for it", async () => {
    const verdicts = replace(caseAVerdicts(), "D2", { status: "contestable", recoverable_amount: 44250 })
    const result = acceptVerdicts(await caseA(), verdicts, VERIFICATIONS, CASE_A_CALCS)
    expect(result.rejected.map((r) => r.deduction_id)).toEqual(["D2"])
    expect(result.rejected[0]?.reasons.join(" ")).toMatch(/calc_proportionate/)
  })

  it("acceptance 3: accepts case A expected verdicts built from real calc results", async () => {
    const result = acceptVerdicts(await caseA(), caseAVerdicts(), VERIFICATIONS, CASE_A_CALCS)
    expect(result.rejected).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.accepted.map((v) => v.deduction_id)).toEqual(["D1", "D2", "D3", "D4"])
    expect(result.accepted.find((v) => v.deduction_id === "D3")?.recoverable_amount).toBe(40719.76)
    expect(result.accepted.every((v) => v.include_in_grievance === (v.status === "contestable"))).toBe(true)
  })

  it("acceptance 4: rejects verdicts missing a deduction of the case", async () => {
    const verdicts = caseAVerdicts().filter((v) => v.deduction_id !== "D4")
    const result = acceptVerdicts(await caseA(), verdicts, VERIFICATIONS, CASE_A_CALCS)
    expect(result.missing).toEqual(["D4"])
    expect(result.ok).toBe(false)
  })

  it("acceptance 5: low-confidence contestable verdicts are kept but not included in the grievance", async () => {
    const verdicts = replace(caseAVerdicts(), "D3", { confidence: 0.6 })
    const result = acceptVerdicts(await caseA(), verdicts, VERIFICATIONS, CASE_A_CALCS)
    expect(CONFIDENCE_THRESHOLD).toBe(0.75)
    expect(result.rejected).toEqual([])
    const d3 = result.accepted.find((v) => v.deduction_id === "D3")
    expect(d3?.include_in_grievance).toBe(false)
    expect(d3?.recoverable_amount).toBe(40719.76)
  })

  it("acceptance 6: rejects a verified quote attached to a different rule id", async () => {
    const verdicts = replace(caseAVerdicts(), "D1", { citations: [rule("MC24-16b", MORATORIUM_QUOTE)] })
    const result = acceptVerdicts(await caseA(), verdicts, VERIFICATIONS, CASE_A_CALCS)
    expect(result.rejected.map((r) => r.deduction_id)).toEqual(["D1"])
    expect(result.rejected[0]?.reasons.join(" ")).toMatch(/MC24-16b/)
  })

  it("acceptance 6: rejects a regulation override whose rule is not among the citations", async () => {
    const verdicts = replace(caseAVerdicts(), "D1", {
      regulation_override: { policy_says: "8 years", law_says: "60 months", rule_id: "MC24-13" },
    })
    const result = acceptVerdicts(await caseA(), verdicts, VERIFICATIONS, CASE_A_CALCS)
    expect(result.rejected.map((r) => r.deduction_id)).toEqual(["D1"])
    expect(result.rejected[0]?.reasons.join(" ")).toMatch(/regulation_override/)
  })

  it("rejects valid verdicts with money, missing citations, duplicates and unknown ids", async () => {
    const [d1, d2, d3, d4] = caseAVerdicts() as [Verdict, Verdict, Verdict, Verdict]
    const verdicts: Verdict[] = [
      { ...d1, recoverable_amount: 100 },
      { ...d2, citations: [] },
      d3,
      d4,
      d4,
      { ...d4, deduction_id: "D9" },
    ]
    const result = acceptVerdicts(await caseA(), verdicts, VERIFICATIONS, CASE_A_CALCS)
    const reasons = Object.fromEntries(result.rejected.map((r) => [r.deduction_id, r.reasons.join(" ")]))
    expect(reasons.D1).toMatch(/must recover 0/)
    expect(reasons.D2).toMatch(/at least one citation/)
    expect(reasons.D4).toMatch(/more than once/)
    expect(reasons.D9).toMatch(/not a deduction/)
  })

  it("accepts the full deduction amount when no proportionate result exists (case B)", async () => {
    const caseB = await loadCase("case_b")
    const verdict: Verdict = {
      deduction_id: "D1",
      status: "contestable",
      recoverable_amount: 110000,
      reasoning: "89 months of cover; the 60-month moratorium overrides the 8-year policy wording.",
      citations: [rule("MC24-13", MORATORIUM_QUOTE)],
      confidence: 0.9,
      regulation_override: { policy_says: "8 years", law_says: "60 months", rule_id: "MC24-13" },
    }
    const result = acceptVerdicts(caseB, [verdict], VERIFICATIONS, [])
    expect(result.ok).toBe(true)
    expect(result.accepted[0]?.include_in_grievance).toBe(true)
  })

  it("matches quotes after collapsing whitespace", async () => {
    const verdicts = replace(caseAVerdicts(), "D1", {
      citations: [policy(`  ${ROOM_QUOTE.replace(/ /g, "  \n")} `)],
    })
    const result = acceptVerdicts(await caseA(), verdicts, VERIFICATIONS, CASE_A_CALCS)
    expect(result.ok).toBe(true)
  })
})

describe("mapSdkEvent", () => {
  const snapshot = {} as never

  it("acceptance 7: tool-started becomes a tool_call AgentEvent with the tool name", () => {
    const event = mapSdkEvent({
      type: "tool-started",
      snapshot,
      iteration: 1,
      toolCall: { type: "tool-call", toolCallId: "t1", toolName: "calc_proportionate", input: { days: 4 } },
    })
    expect(event?.type).toBe("tool_call")
    expect(event?.message).toContain("calc_proportionate")
    expect(event?.data).toMatchObject({ tool: "calc_proportionate", input: { days: 4 } })
  })

  it("maps tool-finished to tool_result and ignores text deltas", () => {
    const finished = mapSdkEvent({
      type: "tool-finished",
      snapshot,
      iteration: 1,
      toolCall: { type: "tool-call", toolCallId: "t1", toolName: "verify_quote", input: {} },
      message: {} as never,
    })
    expect(finished?.type).toBe("tool_result")
    expect(finished?.message).toContain("verify_quote")
    expect(mapSdkEvent({ type: "assistant-text-delta", text: "hi" } as never)).toBeUndefined()
  })
})
