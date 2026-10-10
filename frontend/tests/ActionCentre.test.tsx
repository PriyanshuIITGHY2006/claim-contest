import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ActionCentre } from "@/components/ActionCentre"
import { ApiError, type DeadlineStep, type Draft } from "@/lib/api"

const api = vi.hoisted(() => ({
  requestDraft: vi.fn(),
  approveDraft: vi.fn(),
  calcDeadlines: vi.fn(),
}))

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return { ...actual, ...api }
})

const FROM_DECISION: DeadlineStep[] = [
  { stage: "insurer_grievance", earliest: "2026-08-07", latest: "2026-08-21", rule_id: "PPI24-B-VI-2-i", note: "" },
  { stage: "ombudsman", earliest: "2026-09-07", latest: "2027-08-07", rule_id: "OMB17-14-3b", note: "" },
]
const FROM_GRIEVANCE: DeadlineStep[] = [
  { stage: "insurer_grievance", earliest: "2026-08-10", latest: "2026-08-24", rule_id: "PPI24-B-VI-2-i", note: "" },
  { stage: "ombudsman", earliest: "2026-09-10", latest: "2027-08-07", rule_id: "OMB17-14-3b", note: "" },
]

function draft(tier: 1 | 2 | 3, language: Draft["language"] = "en", approved = false): Draft {
  return {
    draft_id: `dr_${tier}_${language}`,
    analysis_id: "an_1",
    tier,
    language,
    letter_markdown: `Tier ${tier} letter (${language})\n| D3 | Rs 40,719.76 |`,
    local_summary: `Summary ${tier} ${language}: Rs 40,719.76 looks wrongly deducted.`,
    human_approved: approved,
  }
}

function renderCentre() {
  return render(
    <ActionCentre
      analysisId="an_1"
      caseTitle="Room-rent cut spread to pharmacy"
      decisionDate="2026-08-07"
      deadlines={FROM_DECISION}
    />,
  )
}

const tierButton = (tier: number) =>
  screen.getByRole("button", { name: new RegExp(`^Tier ${tier}\\b`) }) as HTMLButtonElement

async function prepareTier1() {
  fireEvent.click(screen.getByRole("button", { name: /Prepare letter/ }))
  await screen.findByDisplayValue(/Tier 1 letter/)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.requestDraft.mockImplementation(async (_id: string, tier: 1 | 2 | 3, language: Draft["language"]) =>
    draft(tier, language),
  )
  api.approveDraft.mockImplementation(async (draftId: string, approved: boolean) => ({
    ...draft(1),
    draft_id: draftId,
    human_approved: approved,
  }))
  api.calcDeadlines.mockResolvedValue(FROM_GRIEVANCE)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ActionCentre: drafting and approval", () => {
  it("does not request a draft until the user clicks Prepare letter", () => {
    renderCentre()
    expect(api.requestDraft).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /Prepare letter/ })).toBeTruthy()
  })

  it("acceptance 2: shows the letter returned by the draft endpoint and the local summary", async () => {
    renderCentre()
    await prepareTier1()
    expect(api.requestDraft).toHaveBeenCalledWith("an_1", 1, "en")
    expect((screen.getByLabelText("Letter") as HTMLTextAreaElement).value).toContain("Tier 1 letter (en)")
    expect(screen.getByTestId("local-summary").textContent).toContain("Summary 1 en: Rs 40,719.76")
  })

  it("acceptance 3: tier 2 and 3 are disabled until the tier 1 draft is approved", async () => {
    renderCentre()
    expect(tierButton(2).disabled).toBe(true)
    expect(tierButton(3).disabled).toBe(true)
    await prepareTier1()
    expect(tierButton(2).disabled).toBe(true)
    expect(tierButton(3).disabled).toBe(true)

    fireEvent.click(screen.getByRole("checkbox", { name: /I have reviewed and approve the tier 1 letter/ }))
    await waitFor(() => expect(tierButton(2).disabled).toBe(false))
    expect(api.approveDraft).toHaveBeenCalledWith("dr_1_en", true)
    expect(tierButton(3).disabled).toBe(false)

    fireEvent.click(tierButton(3))
    await screen.findByDisplayValue(/Tier 3 letter/)
    expect(api.requestDraft).toHaveBeenLastCalledWith("an_1", 3, "en")
  })

  it("keeps tiers 2 and 3 locked and shows the server's message when approval fails", async () => {
    api.approveDraft.mockRejectedValue(
      new ApiError("backend", 404, "The backend service answered 404 for /drafts/dr_1_en: Draft not found"),
    )
    renderCentre()
    await prepareTier1()
    fireEvent.click(screen.getByRole("checkbox", { name: /approve the tier 1 letter/ }))
    expect((await screen.findByRole("alert")).textContent).toContain("Draft not found")
    expect(tierButton(2).disabled).toBe(true)
  })

  it("changing the language re-requests only after a draft exists", async () => {
    renderCentre()
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "hi" } })
    expect(api.requestDraft).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /Prepare letter/ }))
    await screen.findByDisplayValue(/Tier 1 letter \(hi\)/)
    expect(api.requestDraft).toHaveBeenLastCalledWith("an_1", 1, "hi")

    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "as" } })
    await screen.findByDisplayValue(/Tier 1 letter \(as\)/)
    expect(api.requestDraft).toHaveBeenCalledTimes(2)
  })

  it("shows the agent's message when drafting fails", async () => {
    api.requestDraft.mockRejectedValue(
      new ApiError("agent", 409, "The agent service answered 409 for /analyses/an_1/draft: Analysis an_1 is running"),
    )
    renderCentre()
    fireEvent.click(screen.getByRole("button", { name: /Prepare letter/ }))
    expect((await screen.findByRole("alert")).textContent).toContain("Analysis an_1 is running")
  })
})

describe("ActionCentre: letter, timeline and exports", () => {
  it("the letter is editable and the preview shows the edited text", async () => {
    renderCentre()
    await prepareTier1()
    fireEvent.change(screen.getByLabelText("Letter"), { target: { value: "My edited letter" } })
    fireEvent.click(screen.getByRole("button", { name: "Preview" }))
    expect(screen.getByTestId("letter-preview").textContent).toContain("My edited letter")
  })

  it("timeline: relative wording and the dated one-year limit, then real dates once the grievance date is set", async () => {
    renderCentre()
    const timeline = screen.getByTestId("escalation-timeline")
    expect(timeline.textContent).toContain("within 14 days of receiving it")
    expect(timeline.textContent).toContain("one month after you sent it")
    expect(timeline.textContent).toContain("7 August 2027")
    expect(timeline.textContent).toContain("Assumed decision date: date of discharge")
    expect(timeline.textContent).not.toContain("21 August 2026")

    fireEvent.change(screen.getByLabelText("I sent my grievance on"), { target: { value: "2026-08-10" } })
    await waitFor(() => expect(timeline.textContent).toContain("24 August 2026"))
    expect(api.calcDeadlines).toHaveBeenCalledWith("2026-08-07", "2026-08-10")
    expect(timeline.textContent).toContain("10 September 2026")
    expect(timeline.textContent).toContain("7 August 2027")
  })

  it("downloads the letter as .md and the deadlines as .ics (one event without a grievance date)", async () => {
    const created: Blob[] = []
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => {
        created.push(blob)
        return "blob:x"
      }),
      revokeObjectURL: vi.fn(),
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    renderCentre()
    await prepareTier1()

    fireEvent.click(screen.getByRole("button", { name: /Download \.md/ }))
    fireEvent.click(screen.getByRole("button", { name: /Add deadlines to calendar/ }))
    expect(click).toHaveBeenCalledTimes(2)
    const [md, ics] = await Promise.all(created.map((blob) => blob.text()))
    expect(md).toContain("Tier 1 letter (en)")
    expect(ics).toContain("DTSTART;VALUE=DATE:20270807")
    expect((ics ?? "").split("BEGIN:VEVENT").length - 1).toBe(1)
    click.mockRestore()
  })

  it("copies the letter to the clipboard", async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    renderCentre()
    await prepareTier1()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy/ }))
    })
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Tier 1 letter (en)"))
    expect(within(screen.getByTestId("action-status")).getByText(/Copied/)).toBeTruthy()
  })
})
