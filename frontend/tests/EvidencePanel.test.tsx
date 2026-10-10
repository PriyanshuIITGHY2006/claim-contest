import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { EvidencePanel } from "@/components/EvidencePanel"
import type { Citation, Deduction, Rule, Verdict } from "@/lib/api"

const api = vi.hoisted(() => ({ getRule: vi.fn() }))

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return { ...actual, ...api }
})

const RULE_TEXT =
  "Insurer shall grant final authorization within three hours of the receipt of discharge authorization request from the hospital."
const QUOTE = "within three hours of the receipt of discharge authorization request"

const deduction: Deduction = {
  deduction_id: "D1",
  label: "Charges beyond discharge advice",
  amount: 3750,
  line_ids: [],
  insurer_reason: "Charges after the discharge advice.",
}

function verdictWith(citation: Citation): Verdict {
  return {
    deduction_id: "D1",
    status: "contestable",
    recoverable_amount: 3750,
    reasoning: "Final authorisation came 5h 30m after the request.",
    citations: [citation],
    confidence: 0.9,
  }
}

function open(citation: Citation): void {
  render(
    <EvidencePanel deduction={deduction} verdict={verdictWith(citation)} billLines={[]} onClose={() => {}} />,
  )
}

const rule: Rule = {
  id: "MC24-16a",
  doc: "MC24",
  para: "16(a)",
  page: 23,
  verified: true,
  ground: "discharge_tat",
  text: RULE_TEXT,
  test: "",
  limit_minutes: 180,
}

beforeEach(() => {
  api.getRule.mockReset()
  api.getRule.mockResolvedValue(rule)
})

describe("EvidencePanel full rule text", () => {
  it("shows the full rule text under a verified rule citation", async () => {
    open({ source_type: "rule", source_id: "MC24-16a", quote: QUOTE, verified: true })

    const citation = screen.getByTestId("citation-MC24-16a")
    await waitFor(() => expect(within(citation).getByTestId("full-rule")).toBeTruthy())
    const fullRule = within(citation).getByTestId("full-rule")
    expect(fullRule.textContent).toContain("Full rule")
    expect(fullRule.textContent).toContain(RULE_TEXT)
    expect(api.getRule).toHaveBeenCalledWith("MC24-16a")
  })

  it("still shows the highlighted verified quote above the full rule", async () => {
    open({ source_type: "rule", source_id: "MC24-16a", quote: QUOTE, verified: true })

    expect(within(screen.getByTestId("citation-MC24-16a")).getByTestId("citation-quote").textContent).toContain(
      QUOTE,
    )
    await waitFor(() => expect(screen.getByTestId("full-rule")).toBeTruthy())
  })

  it("does not fetch or show a full rule for an unverified rule citation", () => {
    open({ source_type: "rule", source_id: "MC24-16a", quote: "", verified: false })

    expect(api.getRule).not.toHaveBeenCalled()
    expect(screen.queryByTestId("full-rule")).toBeNull()
    expect(screen.getByTestId("citation-MC24-16a").textContent).toContain("Not yet verified")
  })

  it("does not fetch a rule for a policy citation", () => {
    open({ source_type: "policy", source_id: "star_fho_v19", quote: QUOTE, verified: true })

    expect(api.getRule).not.toHaveBeenCalled()
    expect(screen.queryByTestId("full-rule")).toBeNull()
  })

  it("keeps the verified quote and shows no full-rule box when the rule cannot be fetched", async () => {
    api.getRule.mockRejectedValue(new Error("backend down"))

    open({ source_type: "rule", source_id: "MC24-16a", quote: QUOTE, verified: true })

    await waitFor(() => expect(api.getRule).toHaveBeenCalled())
    expect(screen.queryByTestId("full-rule")).toBeNull()
    expect(screen.getByTestId("citation-quote").textContent).toContain(QUOTE)
    expect(screen.getByTestId("verified-tick")).toBeTruthy()
  })

  it("shows the rule text of the row you opened, not the previous one", async () => {
    api.getRule.mockImplementation(async (id: string) => ({ ...rule, id, text: `Text of ${id}` }))
    const first: Citation = { source_type: "rule", source_id: "MC24-15b", quote: QUOTE, verified: true }
    const second: Citation = { source_type: "rule", source_id: "MC24-16a", quote: QUOTE, verified: true }
    const view = render(
      <EvidencePanel deduction={deduction} verdict={verdictWith(first)} billLines={[]} onClose={() => {}} />,
    )
    await waitFor(() => expect(screen.getByTestId("full-rule").textContent).toContain("Text of MC24-15b"))

    view.rerender(
      <EvidencePanel deduction={deduction} verdict={verdictWith(second)} billLines={[]} onClose={() => {}} />,
    )

    await waitFor(() => expect(screen.getByTestId("full-rule").textContent).toContain("Text of MC24-16a"))
    expect(screen.queryByText(/Text of MC24-15b/)).toBeNull()
    fireEvent.keyDown(document, { key: "Escape" })
  })
})
