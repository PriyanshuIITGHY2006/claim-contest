import { describe, expect, it } from "vitest"
import { friendlyStep, quotesVerified, stageReached } from "@/lib/agentSteps"
import type { AgentEvent } from "@/lib/api"

const event = (seq: number, data?: unknown): AgentEvent =>
  ({ seq, type: "tool_result", message: "", at: "2026-10-10T00:00:00Z", data }) as AgentEvent

describe("agent step explanations", () => {
  it("describes tools in plain language and ignores unknown ones", () => {
    expect(friendlyStep("verify_quote")).toMatch(/word-for-word/)
    expect(friendlyStep("something_new")).toBeNull()
    expect(friendlyStep(null)).toBeNull()
  })

  it("tracks the furthest stage reached and the verified quotes", () => {
    const events = [event(1, { tool: "get_case" }), event(2, { tool: "verify_quote", verified: true }), event(3, { tool: "search_policy" })]
    expect(stageReached(events)).toBe(3)
    expect(stageReached([])).toBe(0)
    expect(quotesVerified(events)).toBe(1)
  })
})

import { render, screen } from "@testing-library/react"
import { AgentProgress } from "@/components/AgentProgress"

describe("AgentProgress", () => {
  it("shows the current stage and a tip while running, and a summary when done", () => {
    const events = [event(1, { tool: "get_case" }), event(2, { tool: "verify_quote", verified: true })]
    const { rerender } = render(<AgentProgress events={events} running />)
    expect(screen.getByTestId("agent-progress").textContent).toContain("Step 4 of 5: verifying every quote.")
    expect(screen.getByTestId("agent-progress").textContent).toContain("1 quote verified so far")
    expect(screen.getByTestId("agent-tip").textContent).toContain("Did you know?")

    rerender(<AgentProgress events={events} running={false} />)
    expect(screen.getByTestId("agent-progress").textContent).toContain("All checks finished. 1 quote verified")
    expect(screen.queryByTestId("agent-tip")).toBeNull()
  })
})
