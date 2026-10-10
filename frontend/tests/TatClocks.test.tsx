import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TatClocks, type ClockResult } from "@/components/TatClocks"

// Recorded POST /calc/tat answers for case D (TASK-04 acceptance test 4).
const discharge: ClockResult = {
  kind: "discharge",
  rule_id: "MC24-16a",
  result: { elapsed_minutes: 330, limit_minutes: 180, breached: true, over_by_minutes: 150 },
}
const cashless: ClockResult = {
  kind: "cashless",
  rule_id: "MC24-15b",
  result: { elapsed_minutes: 135, limit_minutes: 60, breached: true, over_by_minutes: 75 },
}
const withinLimit: ClockResult = {
  kind: "cashless",
  rule_id: "MC24-15b",
  result: { elapsed_minutes: 45, limit_minutes: 60, breached: false, over_by_minutes: 0 },
}

describe("TatClocks", () => {
  it("shows the discharge clock as 5h 30m (limit 3h) with a breach label citing MC24-16a", () => {
    render(<TatClocks clocks={[cashless, discharge]} />)

    const clock = screen.getByTestId("clock-discharge")
    expect(clock.textContent).toContain("5h 30m (limit 3h)")
    expect(within(clock).getByTestId("breach-label").textContent).toContain("MC24-16a")
  })

  it("shows the cashless clock as 2h 15m (limit 1h) with a breach label citing MC24-15b", () => {
    render(<TatClocks clocks={[cashless, discharge]} />)

    const clock = screen.getByTestId("clock-cashless")
    expect(clock.textContent).toContain("2h 15m (limit 1h)")
    expect(within(clock).getByTestId("breach-label").textContent).toContain("MC24-15b")
  })

  it("says how far over the limit each breach ran", () => {
    render(<TatClocks clocks={[cashless, discharge]} />)

    expect(screen.getByTestId("clock-discharge").textContent).toContain("2h 30m over")
    expect(screen.getByTestId("clock-cashless").textContent).toContain("1h 15m over")
  })

  it("shows no breach label for a clock inside its limit", () => {
    render(<TatClocks clocks={[withinLimit]} />)

    const clock = screen.getByTestId("clock-cashless")
    expect(clock.textContent).toContain("45m (limit 1h)")
    expect(within(clock).queryByTestId("breach-label")).toBeNull()
    expect(clock.textContent).toContain("Within the limit")
  })

  it("shows the amount the insurer must bear when one is given", () => {
    render(<TatClocks clocks={[discharge]} insurerBears={3750} />)

    expect(screen.getByTestId("clock-discharge").textContent).toContain("₹3,750")
  })

  it("shows a friendly note instead of numbers when the timing check failed", () => {
    render(<TatClocks clocks={[]} unavailableReason="Could not reach the backend service" />)

    const note = screen.getByTestId("clocks-unavailable")
    expect(note.textContent).toContain("couldn't check the timings")
    expect(note.textContent).toContain("Could not reach the backend service")
    expect(screen.queryByTestId("clock-discharge")).toBeNull()
  })

  it("says so when the case has no timeline to check", () => {
    render(<TatClocks clocks={[]} />)

    expect(screen.getByTestId("clocks-empty").textContent).toContain("No cashless or discharge")
  })
})
