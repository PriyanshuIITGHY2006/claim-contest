import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PolicyXray } from "@/components/PolicyXray"
import type { PolicyRef, Verdict } from "@/lib/api"

const policyB: PolicyRef = {
  doc_id: "star_fho_v19",
  file: "data/01-FHO-Insurance-policy-wordings.pdf",
  product: "Family Health Optima Insurance Plan",
  schedule: {
    sum_insured: 500000,
    inception_date: "2019-04-01",
    continuous_coverage: true,
    eligible_room_rent_per_day: 5000,
  },
}

const moratoriumOverride: Verdict = {
  deduction_id: "D1",
  status: "contestable",
  recoverable_amount: 110000,
  reasoning: "Coverage exceeds 60 months, so the regulation overrides the policy.",
  citations: [],
  confidence: 0.9,
  regulation_override: {
    policy_says: "8 years",
    law_says: "60 months",
    rule_id: "MC24-13",
  },
}

const mc24Rule = { id: "MC24-13", doc: "MC24", para: "13" }

describe("PolicyXray", () => {
  it("shows the moratorium override as Policy: 8 years → Law: 60 months (MC24 para 13)", () => {
    render(<PolicyXray policy={policyB} verdicts={[moratoriumOverride]} rules={[mc24Rule]} />)

    expect(screen.getByTestId("xray-override-MC24-13").textContent).toContain(
      "Policy: 8 years → Law: 60 months (MC24 para 13)",
    )
  })

  it("marks an overridden term with a 'Regulation overrides this' badge", () => {
    render(<PolicyXray policy={policyB} verdicts={[moratoriumOverride]} rules={[mc24Rule]} />)

    const card = screen.getByTestId("xray-override-MC24-13")
    expect(within(card).getByText("Regulation overrides this")).toBeTruthy()
  })

  it("shows no override badge when no verdict carries one", () => {
    const plain: Verdict = { ...moratoriumOverride, regulation_override: undefined }

    render(<PolicyXray policy={policyB} verdicts={[plain]} rules={[]} />)

    expect(screen.queryByText("Regulation overrides this")).toBeNull()
  })

  it("shows the room-rent cap and the policy start date from the schedule", () => {
    render(<PolicyXray policy={policyB} verdicts={[]} rules={[]} />)

    const room = screen.getByTestId("xray-room-rent")
    expect(room.textContent).toContain("₹5,000")
    expect(screen.getByTestId("xray-coverage").textContent).toContain("1 April 2019")
  })

  it("says so when the schedule has no room-rent cap", () => {
    const noCap: PolicyRef = {
      ...policyB,
      schedule: { ...policyB.schedule, eligible_room_rent_per_day: null },
    }

    render(<PolicyXray policy={noCap} verdicts={[]} rules={[]} />)

    expect(screen.getByTestId("xray-room-rent").textContent).toContain("No daily cap")
  })
})
