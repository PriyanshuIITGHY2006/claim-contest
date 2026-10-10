import { cleanup, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import CasePage from "@/app/case/[id]/page"
import { ApiError, type Analysis, type Case } from "@/lib/api"

const api = vi.hoisted(() => ({
  getCase: vi.fn(),
  getAnalysis: vi.fn(),
  getStoredAnalysis: vi.fn(),
  startAnalysis: vi.fn(),
  calcTat: vi.fn(),
  getRule: vi.fn(),
}))

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return { ...actual, ...api }
})

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))

vi.mock("@/components/LiveTimeline", () => ({
  LiveTimeline: ({ analysisId, refreshOnDone }: { analysisId: string; refreshOnDone: boolean }) => (
    <div data-testid="live-timeline" data-analysis={analysisId} data-refresh={String(refreshOnDone)} />
  ),
}))

vi.mock("@/components/VerdictBoard", () => ({
  VerdictBoard: () => <div data-testid="verdict-board" />,
}))

const caseD: Case = {
  case_id: "case_d",
  title: "Slow cashless and discharge approvals",
  synthetic_notice: "SYNTHETIC - FOR TESTING.",
  policy: {
    doc_id: "hdfc_optima_secure",
    file: "data/myoptima-secure---cis-pww.pdf",
    product: "my:Optima Secure",
    schedule: { sum_insured: 500000, inception_date: "2024-01-01" },
  },
  patient: { name: "Test Patient (fictional)", age: 40 },
  admission: {
    hospital: "Synthetic Ortho Centre",
    admitted: "2026-07-20T07:30:00",
    discharged: "2026-07-23T17:00:00",
    diagnosis: "Fracture shaft of femur",
    room_category: "Single private room",
    cashless: true,
  },
  bill: { lines: [], total: 0 },
  settlement: { claimed: 0, approved: 0, total_deducted: 0, deductions: [], letter_text: "" },
  timeline: [
    { event: "cashless_request", at: "2026-07-20T08:00:00" },
    { event: "cashless_decision", at: "2026-07-20T10:15:00" },
    { event: "discharge_request", at: "2026-07-23T11:00:00" },
    { event: "final_authorisation", at: "2026-07-23T16:30:00" },
  ],
  expected: [],
}

const doneAnalysis: Analysis = {
  analysis_id: "an_1",
  case_id: "case_d",
  status: "done",
  verdicts: [
    {
      deduction_id: "D1",
      status: "contestable",
      recoverable_amount: 3750,
      reasoning: "Final authorisation came 5h30m after the request.",
      citations: [{ source_type: "rule", source_id: "MC24-16a", quote: "", verified: false }],
      confidence: 0.9,
    },
  ],
  total_recoverable: 3750,
  flags: [],
  started_at: "2026-10-10T10:00:00Z",
  finished_at: "2026-10-10T10:00:05Z",
}

function call(searchParams: { analysis?: string; tab?: string }) {
  return CasePage({ params: { id: "case_d" }, searchParams })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getCase.mockResolvedValue(caseD)
  api.getAnalysis.mockResolvedValue(doneAnalysis)
  api.getStoredAnalysis.mockRejectedValue(new ApiError("backend", 404, "The backend service answered 404"))
  api.startAnalysis.mockResolvedValue({ analysis_id: "an_new" })
  api.getRule.mockImplementation(async (id: string) => ({
    id,
    doc: "MC24",
    para: id === "MC24-15b" ? "15(b)" : "16(a)",
    page: 23,
    verified: true,
    ground: "tat",
    text: "",
    test: "",
    limit_minutes: id === "MC24-15b" ? 60 : 180,
  }))
  api.calcTat.mockImplementation(
    async (body: { requested_at: string; decided_at: string; limit_minutes: number }) => {
      const elapsed = body.limit_minutes === 60 ? 135 : 330
      return {
        elapsed_minutes: elapsed,
        limit_minutes: body.limit_minutes,
        breached: true,
        over_by_minutes: elapsed - body.limit_minutes,
      }
    },
  )
})

describe("case page analysis reuse", () => {
  it("does not start an analysis when the URL carries ?analysis=", async () => {
    await call({ analysis: "an_1" })

    expect(api.startAnalysis).not.toHaveBeenCalled()
    expect(api.getAnalysis).toHaveBeenCalledWith("an_1")
  })

  it("does not start an analysis when switching tabs with ?analysis= in the URL", async () => {
    await call({ analysis: "an_1", tab: "clocks" })
    await call({ analysis: "an_1", tab: "xray" })

    expect(api.startAnalysis).not.toHaveBeenCalled()
  })

  it("starts one analysis and redirects so the id lands in the URL when none is given", async () => {
    await expect(call({})).rejects.toThrow("NEXT_REDIRECT:/case/case_d?analysis=an_new")

    expect(api.startAnalysis).toHaveBeenCalledTimes(1)
    expect(api.startAnalysis).toHaveBeenCalledWith("case_d")
  })

  it("keeps the requested tab through the redirect that starts the analysis", async () => {
    await expect(call({ tab: "clocks" })).rejects.toThrow(
      "NEXT_REDIRECT:/case/case_d?analysis=an_new&tab=clocks",
    )

    expect(api.startAnalysis).toHaveBeenCalledTimes(1)
  })

  it("drops an unknown tab from the redirect instead of passing it on", async () => {
    const failure = await call({ tab: "bogus" }).then(
      () => new Error("expected a redirect"),
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe("NEXT_REDIRECT:/case/case_d?analysis=an_new")
  })

  it("offers a manual re-run, and starts nothing, when the analysis id is unknown", async () => {
    api.getAnalysis.mockRejectedValue(new ApiError("agent", 404, "The agent service answered 404"))

    render(await call({ analysis: "gone" }))

    expect(api.startAnalysis).not.toHaveBeenCalled()
    expect(screen.getByRole("link", { name: /run a new analysis/i }).getAttribute("href")).toBe(
      "/case/case_d",
    )
  })

  it("offers a manual re-run when the analysis belongs to a different case", async () => {
    api.getAnalysis.mockResolvedValue({ ...doneAnalysis, case_id: "case_a" })

    render(await call({ analysis: "an_1" }))

    expect(api.startAnalysis).not.toHaveBeenCalled()
    expect(screen.getByRole("link", { name: /run a new analysis/i })).toBeTruthy()
  })
})

describe("case page saved result", () => {
  const agentGone = () => new ApiError("agent", 404, "The agent service answered 404")

  beforeEach(() => {
    api.getAnalysis.mockRejectedValue(agentGone())
    api.getStoredAnalysis.mockResolvedValue(doneAnalysis)
  })

  it("renders the stored analysis, without a live timeline, when the agent forgot it", async () => {
    render(await call({ analysis: "an_1" }))

    expect(api.getStoredAnalysis).toHaveBeenCalledWith("an_1")
    expect(screen.getByTestId("verdict-board")).toBeTruthy()
    expect(screen.queryByTestId("live-timeline")).toBeNull()
    expect(screen.queryByRole("link", { name: /run a new analysis/i })).toBeNull()
    expect(api.startAnalysis).not.toHaveBeenCalled()
  })

  it("shows a Saved result note, with the finished date, where the timeline was", async () => {
    render(await call({ analysis: "an_1" }))

    const note = screen.getByTestId("saved-result")
    expect(note.textContent).toContain("Saved result")
    expect(note.textContent).toMatch(/10 Oct 2026/)
  })

  it("shows the note without a date when the stored analysis has no finish time", async () => {
    api.getStoredAnalysis.mockResolvedValue({ ...doneAnalysis, finished_at: null })

    render(await call({ analysis: "an_1" }))

    expect(screen.getByTestId("saved-result").textContent).toContain("Saved result")
    expect(screen.getByTestId("saved-result").textContent).not.toMatch(/Invalid|NaN/)
  })

  it("keeps the analysis id in the tab links and does not ask the agent again", async () => {
    render(await call({ analysis: "an_1" }))

    expect(screen.getByRole("link", { name: "Clocks" }).getAttribute("href")).toBe(
      "/case/case_d?analysis=an_1&tab=clocks",
    )
    expect(api.startAnalysis).not.toHaveBeenCalled()
  })

  it("still renders the Clocks and X-ray tabs from the saved result", async () => {
    // The note replaces the timeline on the Analysis tab only; the other tabs never had a timeline.
    render(await call({ analysis: "an_1", tab: "clocks" }))
    expect(screen.getByTestId("clock-discharge").textContent).toContain("5h 30m (limit 3h)")
    expect(screen.getByRole("link", { name: "Clocks" }).getAttribute("aria-current")).toBe("page")
    expect(screen.queryByTestId("live-timeline")).toBeNull()

    cleanup()
    render(await call({ analysis: "an_1", tab: "xray" }))
    expect(screen.getByRole("link", { name: "X-ray" }).getAttribute("aria-current")).toBe("page")
    expect(screen.queryByTestId("clock-discharge")).toBeNull()
    expect(screen.queryByTestId("live-timeline")).toBeNull()

    cleanup()
    render(await call({ analysis: "an_1", tab: "analysis" }))
    expect(screen.getByTestId("saved-result")).toBeTruthy()
    expect(api.getAnalysis).toHaveBeenCalledTimes(3)
    expect(api.getStoredAnalysis).toHaveBeenCalledTimes(3)
    expect(api.startAnalysis).not.toHaveBeenCalled()
  })

  it("offers the manual re-run when the backend does not have it either", async () => {
    api.getStoredAnalysis.mockRejectedValue(new ApiError("backend", 404, "The backend service answered 404"))

    render(await call({ analysis: "gone" }))

    expect(screen.getByRole("link", { name: /run a new analysis/i }).getAttribute("href")).toBe("/case/case_d")
    expect(screen.queryByTestId("verdict-board")).toBeNull()
    expect(api.startAnalysis).not.toHaveBeenCalled()
  })

  it("offers the manual re-run when the stored analysis belongs to another case", async () => {
    api.getStoredAnalysis.mockResolvedValue({ ...doneAnalysis, case_id: "case_a" })

    render(await call({ analysis: "an_1" }))

    expect(screen.getByRole("link", { name: /run a new analysis/i })).toBeTruthy()
    expect(screen.queryByTestId("verdict-board")).toBeNull()
    expect(api.startAnalysis).not.toHaveBeenCalled()
  })

  it("does not fall back when the agent fails for a reason other than not found", async () => {
    api.getAnalysis.mockRejectedValue(new ApiError("agent", null, "Could not reach the agent service"))

    render(await call({ analysis: "an_1" }))

    expect(api.getStoredAnalysis).not.toHaveBeenCalled()
    expect(screen.getByRole("link", { name: /run a new analysis/i })).toBeTruthy()
  })

  it("does not fall back when the agent still has the analysis", async () => {
    api.getAnalysis.mockResolvedValue(doneAnalysis)

    render(await call({ analysis: "an_1" }))

    expect(api.getStoredAnalysis).not.toHaveBeenCalled()
    expect(screen.getByTestId("live-timeline")).toBeTruthy()
    expect(screen.queryByTestId("saved-result")).toBeNull()
  })
})

describe("case page tabs", () => {
  it("keeps the analysis id in every tab link", async () => {
    render(await call({ analysis: "an_1" }))

    for (const [name, tab] of [
      ["Analysis", "analysis"],
      ["X-ray", "xray"],
      ["Clocks", "clocks"],
    ]) {
      const href = screen.getByRole("link", { name }).getAttribute("href")
      expect(href).toBe(`/case/case_d?analysis=an_1&tab=${tab}`)
    }
  })

  it("streams the timeline and, once the run is done, shows the verdict board", async () => {
    render(await call({ analysis: "an_1" }))

    expect(screen.getByTestId("live-timeline").getAttribute("data-analysis")).toBe("an_1")
    expect(screen.getByTestId("verdict-board")).toBeTruthy()
  })

  it("asks the timeline to refresh the page when the run is still going", async () => {
    api.getAnalysis.mockResolvedValue({ ...doneAnalysis, status: "running", verdicts: [] })

    render(await call({ analysis: "an_1" }))

    expect(screen.getByTestId("live-timeline").getAttribute("data-refresh")).toBe("true")
    expect(screen.queryByTestId("verdict-board")).toBeNull()
  })
})

describe("case page clocks", () => {
  it("sends the case timeline and the rule limits to /calc/tat and shows its answers", async () => {
    render(await call({ analysis: "an_1", tab: "clocks" }))

    expect(api.calcTat).toHaveBeenCalledWith({
      requested_at: "2026-07-23T11:00:00",
      decided_at: "2026-07-23T16:30:00",
      limit_minutes: 180,
    })
    expect(api.calcTat).toHaveBeenCalledWith({
      requested_at: "2026-07-20T08:00:00",
      decided_at: "2026-07-20T10:15:00",
      limit_minutes: 60,
    })
    expect(screen.getByTestId("clock-discharge").textContent).toContain("5h 30m (limit 3h)")
    expect(screen.getByTestId("clock-cashless").textContent).toContain("2h 15m (limit 1h)")
    expect(screen.getByTestId("clock-discharge").textContent).toContain("₹3,750")
  })

  it("shows what the insurer bears when the verdict cites only MC24-16b", async () => {
    const citesOnly16b: Analysis = {
      ...doneAnalysis,
      verdicts: [
        {
          ...doneAnalysis.verdicts[0],
          citations: [{ source_type: "rule", source_id: "MC24-16b", quote: "", verified: false }],
        },
      ],
    }
    api.getAnalysis.mockResolvedValue(citesOnly16b)

    render(await call({ analysis: "an_1", tab: "clocks" }))

    expect(screen.getByTestId("clock-discharge").textContent).toContain("₹3,750")
  })

  it("shows the friendly note when the backend call fails", async () => {
    api.calcTat.mockRejectedValue(new ApiError("backend", null, "Could not reach the backend service"))

    render(await call({ analysis: "an_1", tab: "clocks" }))

    expect(screen.getByTestId("clocks-unavailable").textContent).toContain(
      "Could not reach the backend service",
    )
  })
})

