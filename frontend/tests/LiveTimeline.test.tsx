import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LiveTimeline } from "@/components/LiveTimeline"
import type { AgentEvent } from "@/lib/api"

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  readyState = 1
  onmessage: ((message: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  close = vi.fn(() => {
    this.readyState = 2
  })

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  emit(event: AgentEvent): void {
    this.emitRaw(JSON.stringify(event))
  }

  emitRaw(data: string): void {
    act(() => this.onmessage?.({ data } as MessageEvent<string>))
  }

  fail(): void {
    this.readyState = 2
    act(() => this.onerror?.(new Event("error")))
  }
}

function event(
  seq: number,
  type: AgentEvent["type"],
  message: string,
  data?: unknown,
): AgentEvent {
  return { seq, type, message, data, at: "2026-10-10T10:00:00Z" }
}

function openStream(refreshOnDone = false): FakeEventSource {
  render(<LiveTimeline analysisId="an_1" refreshOnDone={refreshOnDone} />)
  const source = FakeEventSource.instances[0]
  if (!source) throw new Error("LiveTimeline did not open an EventSource")
  return source
}

function renderedMessages(): string[] {
  return screen.queryAllByTestId(/^timeline-event-/).map((item) => item.textContent ?? "")
}

beforeEach(() => {
  FakeEventSource.instances = []
  refresh.mockClear()
  vi.stubEnv("NEXT_PUBLIC_AGENT_URL", "http://agent.test")
  vi.stubGlobal("EventSource", FakeEventSource)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("LiveTimeline", () => {
  it("subscribes to the agent's event stream for the analysis", () => {
    const source = openStream()

    expect(source.url).toBe("http://agent.test/analyses/an_1/events")
  })

  it("renders events in seq order", () => {
    const source = openStream()

    source.emit(event(1, "step", "Reading the settlement letter"))
    source.emit(event(2, "step", "Auditing 4 deductions"))
    source.emit(event(3, "step", "Recomputing every amount"))

    const messages = renderedMessages()
    expect(messages).toHaveLength(3)
    expect(messages[0]).toContain("Reading the settlement letter")
    expect(messages[1]).toContain("Auditing 4 deductions")
    expect(messages[2]).toContain("Recomputing every amount")
  })

  it("shows a done state only after the done event", () => {
    const source = openStream()
    source.emit(event(1, "step", "Reading the settlement letter"))
    expect(screen.queryByTestId("timeline-done")).toBeNull()

    source.emit(event(2, "done", "Analysis complete"))

    expect(screen.getByTestId("timeline-done").textContent).toContain("Analysis complete")
  })

  it("keeps the stream open until a done or error event arrives", () => {
    const source = openStream()

    source.emit(event(1, "step", "Reading the settlement letter"))

    expect(source.close).not.toHaveBeenCalled()
  })

  it("closes the EventSource on done", () => {
    const source = openStream()

    source.emit(event(1, "step", "Reading the settlement letter"))
    source.emit(event(2, "done", "Analysis complete"))

    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("closes the EventSource on error and shows the message", () => {
    const source = openStream()

    source.emit(event(1, "error", "The agent could not read the case"))

    expect(source.close).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("timeline-error").textContent).toContain(
      "The agent could not read the case",
    )
    expect(screen.queryByTestId("timeline-done")).toBeNull()
  })

  it("ignores events it has already seen when the stream replays after a reconnect", () => {
    const source = openStream()

    source.emit(event(1, "step", "Reading the settlement letter"))
    source.emit(event(2, "step", "Auditing 4 deductions"))
    source.emit(event(1, "step", "Reading the settlement letter"))
    source.emit(event(2, "step", "Auditing 4 deductions"))
    source.emit(event(3, "step", "Recomputing every amount"))

    expect(renderedMessages()).toHaveLength(3)
  })

  it("closes the EventSource when it unmounts", () => {
    const { unmount } = render(<LiveTimeline analysisId="an_1" refreshOnDone={false} />)
    const source = FakeEventSource.instances[0]
    if (!source) throw new Error("LiveTimeline did not open an EventSource")

    unmount()

    expect(source.close).toHaveBeenCalledTimes(1)
  })
})

describe("LiveTimeline details", () => {
  it("shows the tool name on a tool_call event", () => {
    const source = openStream()

    source.emit(event(1, "tool_call", "Searching the policy", { tool: "search_policy" }))

    expect(screen.getByTestId("timeline-event-1").textContent).toContain("search_policy")
  })

  it("shows 'quote verified' for a verified tool result and not for an unverified one", () => {
    const source = openStream()

    source.emit(event(1, "tool_result", "Checked the room-rent clause", { verified: true }))
    source.emit(event(2, "tool_result", "Checked the PED clause", { verified: false }))

    expect(screen.getByTestId("timeline-event-1").textContent).toContain("quote verified")
    expect(screen.getByTestId("timeline-event-2").textContent).not.toContain("quote verified")
  })

  it("shows each verdict with its status", () => {
    const source = openStream()

    source.emit(event(1, "verdict", "D1: contestable (Rs 3750 recoverable)"))

    expect(screen.getByTestId("timeline-event-1").textContent).toContain("D1: contestable")
  })

  it("refreshes the page once when a live run finishes so the verdicts appear", () => {
    const source = openStream(true)

    source.emit(event(1, "step", "Reading the settlement letter"))
    expect(refresh).not.toHaveBeenCalled()
    source.emit(event(2, "done", "Analysis complete"))

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("does not refresh when it only replays a run that had already finished", () => {
    const source = openStream(false)

    source.emit(event(1, "step", "Reading the settlement letter"))
    source.emit(event(2, "done", "Analysis complete"))

    expect(refresh).not.toHaveBeenCalled()
  })

  it("shows an error and closes the stream when an event cannot be read", () => {
    const source = openStream()

    source.emitRaw("not json")

    expect(source.close).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("timeline-error").textContent).toContain("could not be read")
  })

  it("shows an error and closes the stream when the connection fails before the run ends", () => {
    const source = openStream()
    source.emit(event(1, "step", "Reading the settlement letter"))

    source.fail()

    expect(source.close).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("timeline-error").textContent).toContain("connection")
  })

  it("does not report a failed connection after the run has already finished", () => {
    const source = openStream()
    source.emit(event(1, "done", "Analysis complete"))

    source.fail()

    expect(screen.queryByTestId("timeline-error")).toBeNull()
  })
})
