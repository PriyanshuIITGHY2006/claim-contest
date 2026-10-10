import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CompareView, matchErrors } from "@/components/CompareView"
import type { Analysis, Baseline } from "@/lib/api"

const analysis: Analysis = {
  analysis_id: "an_1",
  case_id: "case_a",
  status: "done",
  verdicts: [
    { deduction_id: "D1", status: "valid", recoverable_amount: 0, reasoning: "Room above eligibility.", citations: [], confidence: 0.9 },
    {
      deduction_id: "D3",
      status: "contestable",
      recoverable_amount: 40719.76,
      reasoning: "Pharmacy and implants are not associated medical expenses.",
      citations: [],
      confidence: 0.92,
    },
  ],
  total_recoverable: 40719.76,
  flags: [],
  started_at: null,
  finished_at: null,
}

const baseline: Baseline = {
  answer_markdown: "## Chatbot\nAll deductions follow the policy.\nYou cannot recover anything.",
  errors: [
    { claim: "The proportionate cut on pharmacy is allowed", why_wrong: "D3: pharmacy is not an associated medical expense" },
    { claim: "D1 room rent is wrongly deducted", why_wrong: "The room was above eligibility" },
    { claim: "You must wait two years before complaining", why_wrong: "The Ombudsman limit is one year (OMB17-14-3b)" },
  ],
}

describe("matchErrors", () => {
  it("matches each error to the first deduction id it mentions; the rest are unmatched", () => {
    const { byDeduction, unmatched } = matchErrors(baseline.errors, ["D1", "D3"])
    expect(byDeduction.get("D3")?.map((e) => e.claim)).toEqual(["The proportionate cut on pharmacy is allowed"])
    expect(byDeduction.get("D1")?.map((e) => e.claim)).toEqual(["D1 room rent is wrongly deducted"])
    expect(unmatched.map((e) => e.claim)).toEqual(["You must wait two years before complaining"])
  })

  it("does not match D1 inside D10", () => {
    const { byDeduction, unmatched } = matchErrors([{ claim: "About D10", why_wrong: "x" }], ["D1"])
    expect(byDeduction.size).toBe(0)
    expect(unmatched).toHaveLength(1)
  })
})

describe("CompareView", () => {
  it("acceptance 4: lists each baseline error next to the corresponding verdict", () => {
    render(<CompareView analysis={analysis} baseline={baseline} />)
    const d3 = screen.getByTestId("compare-verdict-D3")
    expect(within(d3).getByText(/Contestable/)).toBeTruthy()
    expect(within(d3).getByText("The proportionate cut on pharmacy is allowed")).toBeTruthy()
    expect(within(d3).getByText(/pharmacy is not an associated medical expense/)).toBeTruthy()
    expect(d3.textContent).toContain("₹40,719.76")

    const d1 = screen.getByTestId("compare-verdict-D1")
    expect(within(d1).getByText("D1 room rent is wrongly deducted")).toBeTruthy()
    expect(within(d1).queryByText("The proportionate cut on pharmacy is allowed")).toBeNull()
  })

  it("shows errors that name no deduction under 'Other errors'", () => {
    render(<CompareView analysis={analysis} baseline={baseline} />)
    const other = screen.getByTestId("compare-other-errors")
    expect(within(other).getByText("You must wait two years before complaining")).toBeTruthy()
  })

  it("shows the chatbot answer as plain text", () => {
    render(<CompareView analysis={analysis} baseline={baseline} />)
    const answer = screen.getByTestId("baseline-answer")
    expect(answer.textContent).toContain("All deductions follow the policy.")
    expect(answer.querySelector("h2")).toBeNull()
  })

  it("explains when no chatbot answer has been recorded", () => {
    render(<CompareView analysis={analysis} baseline={null} />)
    expect(screen.getByText(/No recorded chatbot answer for this case yet/)).toBeTruthy()
    expect(screen.queryByTestId("baseline-answer")).toBeNull()
  })

  it("reports a baseline that could not be loaded", () => {
    render(<CompareView analysis={analysis} baseline={null} unavailableReason="The agent service answered 500" />)
    expect(screen.getByRole("alert").textContent).toContain("The agent service answered 500")
  })
})
