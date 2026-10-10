import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import DashboardPage from "@/app/dashboard/page"
import { ApiError, type AnalysisSummary, type Case } from "@/lib/api"

const api = vi.hoisted(() => ({
  listCases: vi.fn(),
  getCase: vi.fn(),
  listAnalyses: vi.fn(),
}))

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return { ...actual, ...api }
})

function sampleCase(caseId: string, title: string, deducted: number, product = "Family Health Optima"): Case {
  return {
    case_id: caseId,
    title,
    synthetic_notice: "Synthetic",
    policy: {
      doc_id: "star_fho_v19",
      file: "data/policy.pdf",
      product,
      schedule: { sum_insured: 500000, inception_date: "2021-06-01" },
    },
    patient: { name: "Asha", age: 44 },
    admission: {
      hospital: "City Hospital",
      admitted: "2026-08-03T09:30:00",
      discharged: "2026-08-07T12:00:00",
      diagnosis: "Appendicitis",
      room_category: "Deluxe",
      cashless: false,
    },
    bill: { lines: [], total: 0 },
    settlement: { claimed: 0, approved: 0, total_deducted: deducted, deductions: [], letter_text: "" },
    timeline: [],
    expected: [],
  }
}

function summary(analysisId: string, caseId: string, status: AnalysisSummary["status"], total: number): AnalysisSummary {
  return {
    analysis_id: analysisId,
    case_id: caseId,
    status,
    total_recoverable: total,
    finished_at: status === "done" ? "2026-10-10T10:00:00Z" : null,
  }
}

const CASES: Record<string, Case> = {
  case_a: sampleCase("case_a", "Room-rent cut", 98969.76),
  case_b: sampleCase("case_b", "PED non-disclosure", 110000, "my:Optima Secure"),
  user_deadbeef: sampleCase("user_deadbeef", "My own claim", 12000),
}

function card(title: string): HTMLElement {
  const found = screen.getByRole("heading", { name: title }).closest("a")
  if (!found) throw new Error(`no card link for ${title}`)
  return found
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listCases.mockResolvedValue([
    { id: "case_a", title: "Room-rent cut", summary: "" },
    { id: "case_b", title: "PED non-disclosure", summary: "" },
  ])
  api.getCase.mockImplementation(async (id: string) => CASES[id])
  api.listAnalyses.mockImplementation(async (caseId?: string) =>
    caseId === "case_a" ? [summary("an_new", "case_a", "done", 40719.76), summary("an_old", "case_a", "done", 100)] : [],
  )
})

describe("Dashboard cards", () => {
  it("shows one card per case with the analysed state, amount and a stored-result link", async () => {
    render(await DashboardPage())

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2)

    const analysed = card("Room-rent cut")
    expect(within(analysed).getByText("Analysed")).toBeTruthy()
    expect(within(analysed).getByText("₹40,719.76")).toBeTruthy()
    expect(within(analysed).getByText("Family Health Optima")).toBeTruthy()
    expect(within(analysed).getByText("₹98,969.76")).toBeTruthy()
    expect(analysed.getAttribute("href")).toBe("/case/case_a?analysis=an_new")

    const fresh = card("PED non-disclosure")
    expect(within(fresh).getByText("Not analysed yet")).toBeTruthy()
    expect(within(fresh).queryByText("Analysed")).toBeNull()
    expect(fresh.getAttribute("href")).toBe("/case/case_b")
  })

  it("asks the backend for the analyses of each case", async () => {
    render(await DashboardPage())

    expect(api.listAnalyses).toHaveBeenCalledWith("case_a")
    expect(api.listAnalyses).toHaveBeenCalledWith("case_b")
  })

  it("counts only a done analysis and links to the newest done one", async () => {
    api.listAnalyses.mockImplementation(async (caseId?: string) =>
      caseId === "case_a"
        ? [
            summary("an_run", "case_a", "running", 0),
            summary("an_err", "case_a", "error", 0),
            summary("an_done", "case_a", "done", 500),
          ]
        : [summary("an_run2", "case_b", "running", 0)],
    )
    render(await DashboardPage())

    const analysed = card("Room-rent cut")
    expect(within(analysed).getByText("Analysed")).toBeTruthy()
    expect(within(analysed).getByText("₹500")).toBeTruthy()
    expect(analysed.getAttribute("href")).toBe("/case/case_a?analysis=an_done")

    const running = card("PED non-disclosure")
    expect(within(running).getByText("Not analysed yet")).toBeTruthy()
    expect(running.getAttribute("href")).toBe("/case/case_b")
  })

  it("marks uploaded cases with an Uploaded badge and no other card", async () => {
    api.listCases.mockResolvedValue([
      { id: "case_a", title: "Room-rent cut", summary: "" },
      { id: "user_deadbeef", title: "My own claim", summary: "" },
    ])
    render(await DashboardPage())

    expect(within(card("My own claim")).getByText("Uploaded")).toBeTruthy()
    expect(within(card("Room-rent cut")).queryByText("Uploaded")).toBeNull()
  })
})

describe("Dashboard page", () => {
  it("links to the upload page with a Check a new claim button", async () => {
    render(await DashboardPage())

    expect(screen.getByRole("link", { name: /check a new claim/i }).getAttribute("href")).toBe("/upload")
  })

  it("keeps a card, as Not analysed yet, when its analyses call fails, and keeps the others", async () => {
    api.listAnalyses.mockImplementation(async (caseId?: string) => {
      if (caseId === "case_a") throw new ApiError("backend", 500, "The backend service answered 500")
      return [summary("an_b", "case_b", "done", 1500)]
    })
    render(await DashboardPage())

    const broken = card("Room-rent cut")
    expect(within(broken).getByText("Not analysed yet")).toBeTruthy()
    expect(broken.getAttribute("href")).toBe("/case/case_a")
    expect(within(card("PED non-disclosure")).getByText("Analysed")).toBeTruthy()
  })

  it("keeps a card when its case details cannot be loaded, and keeps the others", async () => {
    api.getCase.mockImplementation(async (id: string) => {
      if (id === "case_a") throw new ApiError("backend", 500, "The backend service answered 500")
      return CASES[id]
    })
    render(await DashboardPage())

    expect(card("PED non-disclosure")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Room-rent cut" })).toBeNull()
  })

  it("shows the rose error card when the case list cannot be loaded", async () => {
    api.listCases.mockRejectedValue(new ApiError("backend", null, "Could not reach the backend service"))
    render(await DashboardPage())

    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("Could not reach the backend service")
    expect(alert.className).toContain("border-rose-200")
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0)
  })

  it("says so when there are no cases at all", async () => {
    api.listCases.mockResolvedValue([])
    render(await DashboardPage())

    expect(screen.getByText(/no claims yet/i)).toBeTruthy()
  })
})
