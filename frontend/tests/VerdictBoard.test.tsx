import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { VerdictBoard } from "@/components/VerdictBoard"
import type { Analysis, Case, Verdict } from "@/lib/api"

const sampleCase: Case = {
  case_id: "case_t",
  title: "Room-rent cut spread to pharmacy and tests",
  synthetic_notice: "SYNTHETIC - FOR TESTING. Fictional people, hospital and amounts.",
  policy: {
    doc_id: "star_fho_v19",
    file: "data/01-FHO-Insurance-policy-wordings.pdf",
    product: "Family Health Optima Insurance Plan",
    schedule: { sum_insured: 500000, inception_date: "2021-06-01" },
  },
  patient: { name: "Ramesh Kalita (fictional)", age: 58 },
  admission: {
    hospital: "Synthetic Heart Institute, Guwahati",
    admitted: "2026-08-03T09:30:00",
    discharged: "2026-08-07T12:00:00",
    diagnosis: "Coronary artery disease",
    room_category: "Deluxe single room",
    cashless: true,
  },
  bill: {
    lines: [
      {
        line_id: "L01",
        date: "2026-08-03",
        particulars: "Deluxe room rent",
        category: "room",
        rate: 8000,
        units: 4,
        amount: 32000,
      },
      {
        line_id: "L02",
        date: "2026-08-04",
        particulars: "Pharmacy - cardiac drugs",
        category: "pharmacy",
        rate: 18000,
        units: 1,
        amount: 18000,
      },
    ],
    total: 50000,
  },
  settlement: {
    claimed: 50000,
    approved: 21000,
    total_deducted: 79000,
    letter_text: "Proportionate deduction applied.",
    deductions: [
      {
        deduction_id: "D1",
        label: "Proportionate deduction",
        amount: 52000,
        line_ids: ["L01", "L02"],
        insurer_reason: "Room rent exceeded the eligible limit.",
      },
      {
        deduction_id: "D2",
        label: "Non-payable items",
        amount: 18000,
        line_ids: [],
        insurer_reason: "Items listed as non-payable.",
      },
      {
        deduction_id: "D3",
        label: "Unlisted co-payment",
        amount: 9000,
        line_ids: [],
        insurer_reason: "Co-payment applied.",
      },
    ],
  },
  timeline: [],
  expected: [],
}

const verifiedQuote =
  "the Insurer shall not apply proportionate deduction to pharmacy, consumables, implants and diagnostics"


const verdicts: Verdict[] = [
  {
    deduction_id: "D1",
    status: "contestable",
    recoverable_amount: 30000.5,
    reasoning: "Only room and associated charges may be reduced.",
    citations: [
      { source_type: "policy", source_id: "FHO-AME-3", quote: verifiedQuote, verified: true },
    ],
    calculation: {
      calculator: "calc_proportionate",
      inputs: { eligible_room_rent: 5000, actual_room_rent: 8000 },
      result: { ratio: 0.625, correct_deduction: 21999.5 },
    },
    confidence: 0.9,
  },
  {
    deduction_id: "D2",
    status: "valid",
    recoverable_amount: 0,
    reasoning: "The policy annexure lists these items as non-payable.",
    citations: [{ source_type: "policy", source_id: "FHO-ANNEX-2", quote: "", verified: false }],
    confidence: 0.9,
  },
  {
    deduction_id: "D3",
    status: "needs_info",
    recoverable_amount: 10719.26,
    reasoning: "The policy schedule is missing.",
    citations: [],
    confidence: 0.6,
    regulation_override: {
      policy_says: "8 years",
      law_says: "60 months",
      rule_id: "MC24-13",
    },
  },
]

const analysis: Analysis = {
  analysis_id: "an_1",
  case_id: "case_t",
  status: "done",
  verdicts,
  total_recoverable: 40719.76,
  flags: [],
  started_at: "2026-10-10T10:00:00Z",
  finished_at: "2026-10-10T10:00:05Z",
}

function renderBoard(): void {
  render(<VerdictBoard caseData={sampleCase} analysis={analysis} />)
}

describe("VerdictBoard", () => {
  it("renders one row per verdict with the correct chip text", () => {
    renderBoard()

    expect(screen.getAllByTestId(/^deduction-row-/)).toHaveLength(3)
    expect(within(screen.getByTestId("deduction-row-D1")).getByText("Contestable")).toBeTruthy()
    expect(within(screen.getByTestId("deduction-row-D2")).getByText("Valid")).toBeTruthy()
    expect(within(screen.getByTestId("deduction-row-D3")).getByText("Needs info")).toBeTruthy()
  })

  it("shows each row's label, amount deducted and recoverable amount", () => {
    renderBoard()

    const row = screen.getByTestId("deduction-row-D1")
    expect(row.textContent).toContain("Proportionate deduction")
    expect(row.textContent).toContain("₹52,000")
    expect(row.textContent).toContain("₹30,000.50")
  })

  it("summarises the sum of recoverable_amount against the amount deducted", () => {
    renderBoard()

    const summary = screen.getByTestId("summary-card")
    expect(summary.textContent).toContain("₹40,719.76 of ₹79,000 deducted looks recoverable")
    expect(summary.textContent).toContain("SYNTHETIC")
  })

  it("computes the summary from the verdict rows, not the agent's total", () => {
    render(<VerdictBoard caseData={sampleCase} analysis={{ ...analysis, total_recoverable: 999999 }} />)

    const summary = screen.getByTestId("summary-card")
    expect(summary.textContent).toContain("₹40,719.76 of ₹79,000 deducted looks recoverable")
  })

  it("keeps the evidence panel closed until a row is clicked", () => {
    renderBoard()

    expect(screen.queryByTestId("evidence-panel")).toBeNull()
  })

  it("shows a verified citation with its quote and a tick when a row is clicked", () => {
    renderBoard()

    fireEvent.click(screen.getByTestId("deduction-row-D1"))

    const panel = screen.getByTestId("evidence-panel")
    const citation = within(panel).getByTestId("citation-FHO-AME-3")
    expect(citation.textContent).toContain("FHO-AME-3")
    expect(within(citation).getByTestId("citation-quote").textContent).toContain(verifiedQuote)
    expect(within(citation).getByTestId("verified-tick")).toBeTruthy()
    expect(citation.textContent).toContain("Verified against source")
    expect(panel.textContent).toContain("Deluxe room rent")
    expect(panel.textContent).toContain("calc_proportionate")
  })

  it("shows an unverified citation by source id with no tick and no empty quote", () => {
    renderBoard()

    fireEvent.click(screen.getByTestId("deduction-row-D2"))

    const citation = within(screen.getByTestId("evidence-panel")).getByTestId(
      "citation-FHO-ANNEX-2",
    )
    expect(citation.textContent).toContain("FHO-ANNEX-2")
    expect(citation.textContent).toContain("Not yet verified")
    expect(within(citation).queryByTestId("verified-tick")).toBeNull()
    expect(within(citation).queryByTestId("citation-quote")).toBeNull()
  })

  it("shows the regulation override badge for an overriding verdict", () => {
    renderBoard()

    fireEvent.click(screen.getByTestId("deduction-row-D3"))

    const panel = screen.getByTestId("evidence-panel")
    expect(panel.textContent).toContain("Regulation overrides this")
    expect(panel.textContent).toContain("8 years")
    expect(panel.textContent).toContain("60 months")
    expect(panel.textContent).toContain("MC24-13")
  })
})
