import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WhyVerdict } from "@/components/WhyVerdict"
import type { Deduction, Verdict } from "@/lib/api"

const deduction: Deduction = {
  deduction_id: "D3",
  label: "Proportionate deduction - other expenses",
  amount: 40719.76,
  line_ids: ["L07"],
  insurer_reason: "Proportionate deduction as per policy terms",
}

const verdict: Verdict = {
  deduction_id: "D3",
  status: "contestable",
  recoverable_amount: 40719.76,
  reasoning: "Pharmacy, implants and diagnostics are not associated medical expenses.",
  citations: [
    { source_type: "policy", source_id: "star_fho_v19", quote: "do not include Cost of pharmacy and consumables", verified: true },
    { source_type: "rule", source_id: "MC24-13", quote: "", verified: false },
  ],
  calculation: { calculator: "calc_proportionate", inputs: {}, result: { recoverable_amount: 40719.76 } },
  confidence: 0.9,
}

describe("WhyVerdict", () => {
  it("walks from the insurer's claim to the conclusion, with the evidence counts", () => {
    render(<WhyVerdict deduction={deduction} verdict={verdict} />)

    expect(screen.getByText("Proportionate deduction as per policy terms")).toBeTruthy()
    expect(screen.getByText(/do not include Cost of pharmacy and consumables/)).toBeTruthy()
    expect(screen.getByText(/calc_proportionate/)).toBeTruthy()
    expect(screen.getByTestId("why-conclusion").textContent).toContain("₹40,719.76")
    expect(screen.getByTestId("why-evidence").textContent).toContain("1 of 2 quotes verified")
    expect(screen.getByTestId("why-confidence").textContent).toContain("High")
    expect(screen.getByTestId("why-confidence").textContent).toContain("90%")
  })

  it("says plainly when the insurer is right and no amount is recoverable", () => {
    render(
      <WhyVerdict
        deduction={deduction}
        verdict={{ ...verdict, status: "valid", recoverable_amount: 0, calculation: undefined, confidence: 0.6 }}
      />,
    )

    expect(screen.getByTestId("why-conclusion").textContent).toMatch(/insurer's deduction looks correct/i)
    expect(screen.getByText(/No calculation was needed/)).toBeTruthy()
    expect(screen.getByTestId("why-confidence").textContent).toContain("Medium")
  })

  it("shows the regulation override as its own step", () => {
    render(
      <WhyVerdict
        deduction={deduction}
        verdict={{
          ...verdict,
          regulation_override: { policy_says: "8 years", law_says: "60 months", rule_id: "MC24-13" },
        }}
      />,
    )

    expect(screen.getByText(/The law overrides the policy/)).toBeTruthy()
    expect(screen.getByText(/8 years/)).toBeTruthy()
    expect(screen.getByText(/60 months/)).toBeTruthy()
  })
})
