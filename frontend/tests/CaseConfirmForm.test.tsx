import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CaseConfirmForm } from "@/components/CaseConfirmForm"
import type { CaseDraft, NewCase } from "@/lib/api"

const emptyDraft: CaseDraft = {
  doc_id: "star_fho_v19",
  claimed: 77000,
  approved: 65000,
  deductions: [
    {
      deduction_id: "D1",
      label: "Room rent beyond eligibility",
      amount: 12000,
      line_ids: [],
      insurer_reason: "Room rent deducted Rs 12,000",
    },
  ],
  bill_lines: [],
  letter_text: "Claim approved with deductions.",
  warnings: ["Check the bill line dates"],
}

const filledDraft: CaseDraft = {
  ...emptyDraft,
  bill_lines: [
    {
      line_id: "L01",
      date: "2026-08-03",
      particulars: "Deluxe room rent",
      category: "room",
      rate: 32000,
      units: 1,
      amount: 32000,
    },
  ],
}

function renderForm(draft: CaseDraft, onSubmit = vi.fn()) {
  render(<CaseConfirmForm draft={draft} submitting={false} error={null} onSubmit={onSubmit} />)
  return onSubmit
}

const analyse = () => screen.getByRole("button", { name: "Analyse my claim" }) as HTMLButtonElement
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe("CaseConfirmForm", () => {
  it("disables Analyse while there are no bill lines and enables it once one has an amount", () => {
    renderForm(emptyDraft)
    expect(analyse().disabled).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Add bill line" }))
    expect(analyse().disabled).toBe(true)

    change("Line 1 amount", "32000")
    expect(analyse().disabled).toBe(false)
  })

  it("recomputes the totals when an amount is edited", () => {
    renderForm(filledDraft)
    expect(screen.getByTestId("bill-total").textContent).toBe("₹32,000")
    expect(screen.getByTestId("deducted-total").textContent).toBe("₹12,000")

    change("Line 1 amount", "45000.5")
    expect(screen.getByTestId("bill-total").textContent).toBe("₹45,000.50")

    change("Deduction 1 amount", "20000")
    expect(screen.getByTestId("deducted-total").textContent).toBe("₹20,000")
  })

  it("keeps Analyse disabled for a deduction of zero, a deduction above the bill, or no deduction", () => {
    renderForm(filledDraft)
    expect(analyse().disabled).toBe(false)

    change("Deduction 1 amount", "0")
    expect(analyse().disabled).toBe(true)

    change("Deduction 1 amount", "32000.01")
    expect(analyse().disabled).toBe(true)
    expect(screen.getByText(/larger than the bill total/i)).toBeTruthy()

    change("Deduction 1 amount", "12000")
    expect(analyse().disabled).toBe(false)

    fireEvent.click(screen.getByRole("button", { name: "Remove deduction 1" }))
    expect(analyse().disabled).toBe(true)
  })

  it("keeps Analyse disabled when the approved amount is above the claimed amount", () => {
    renderForm(filledDraft)
    change("Approved amount", "80000")
    expect(analyse().disabled).toBe(true)
    expect(screen.getByText(/approved amount cannot be more than the claimed amount/i)).toBeTruthy()
  })

  it("shows the warnings at the top", () => {
    renderForm(filledDraft)
    expect(screen.getByText("Check the bill line dates")).toBeTruthy()
  })

  it("lets the user edit every bill line date and submits the confirmed case", () => {
    const onSubmit = renderForm(filledDraft)
    change("Line 1 date", "2026-08-05")
    change("Patient name", "Asha Rao")
    change("Patient age", "44")
    change("Hospital", "City Hospital")
    change("Admitted on", "2026-08-03")
    change("Discharged on", "2026-08-07")
    change("Diagnosis", "Appendicitis")
    change("Sum insured", "500000")
    change("Policy start date", "2021-06-01")
    change("Eligible room rent per day", "5000")
    change("Room rent charged per day", "8000")
    fireEvent.click(screen.getByRole("checkbox", { name: "Link deduction 1 to line 1" }))

    fireEvent.click(analyse())

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const body = onSubmit.mock.calls[0][0] as NewCase
    expect(body.doc_id).toBe("star_fho_v19")
    expect(body.bill_lines[0]).toMatchObject({ line_id: "L01", date: "2026-08-05", amount: 32000 })
    expect(body.deductions[0]).toMatchObject({ amount: 12000, line_ids: ["L01"] })
    expect(body.patient).toEqual({ name: "Asha Rao", age: 44 })
    expect(body.schedule).toEqual({
      sum_insured: 500000,
      inception_date: "2021-06-01",
      eligible_room_rent_per_day: 5000,
    })
    expect(body.admission.room_category).toBe("Room (Rs 8,000/day)")
    expect(body.admission.admitted).toBe("2026-08-03T00:00:00")
    expect(body.claimed).toBe(77000)
    expect(body.approved).toBe(65000)
  })

  it("does not submit while required details are missing", () => {
    const onSubmit = renderForm(filledDraft)
    fireEvent.click(analyse())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("shows the privacy note and any error from the server", () => {
    render(
      <CaseConfirmForm draft={filledDraft} submitting={false} error="Choose one of the listed policies" onSubmit={vi.fn()} />,
    )
    expect(screen.getByText("Your documents are processed on this server and not shared.")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("Choose one of the listed policies")
  })
})
