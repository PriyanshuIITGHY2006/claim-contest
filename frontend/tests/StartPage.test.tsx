import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import StartPage from "@/app/page"
import type { Case } from "@/lib/api"

const api = vi.hoisted(() => ({
  listCases: vi.fn(),
  getCase: vi.fn(),
}))

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return { ...actual, ...api }
})

function sampleCase(caseId: string, title: string): Case {
  return {
    case_id: caseId,
    title,
    synthetic_notice: "Synthetic",
    policy: {
      doc_id: "star_fho_v19",
      file: "data/policy.pdf",
      product: "Family Health Optima",
      schedule: { sum_insured: 500000, inception_date: "2021-06-01", eligible_room_rent_per_day: 5000 },
    },
    patient: { name: "Asha", age: 44 },
    admission: {
      hospital: "City Hospital (SYN-0001)",
      admitted: "2026-08-03T09:30:00",
      discharged: "2026-08-07T12:00:00",
      diagnosis: "Appendicitis",
      room_category: "Deluxe",
      cashless: false,
    },
    bill: { lines: [], total: 0 },
    settlement: { claimed: 0, approved: 0, total_deducted: 12000, deductions: [], letter_text: "" },
    timeline: [],
    expected: [],
  } as unknown as Case
}

describe("StartPage", () => {
  it("lists only the sample cases, not uploaded user_ cases", async () => {
    api.listCases.mockResolvedValue([
      { id: "case_a", title: "Room-rent cut", summary: "" },
      { id: "user_deadbeef", title: "My own claim", summary: "" },
    ])
    api.getCase.mockImplementation(async (id: string) => sampleCase(id, id === "case_a" ? "Room-rent cut" : "My own claim"))

    render(await StartPage())

    expect(screen.getByText("Room-rent cut")).toBeTruthy()
    expect(screen.queryByText("My own claim")).toBeNull()
    expect(api.getCase).not.toHaveBeenCalledWith("user_deadbeef")
  })
})
