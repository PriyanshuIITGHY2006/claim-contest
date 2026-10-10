import { describe, expect, it } from "vitest"
import { buildServer } from "../src/server.js"
import { createCaseLoader } from "../src/scripted.js"
import { loadSettings } from "../src/settings.js"
import { createAnalysisStore } from "../src/store.js"
import { agentEventSchema, type AgentEvent } from "../src/types.js"

const SCRIPTED_ENV = {
  AGENT_MODE: "scripted",
  BACKEND_URL: "http://localhost:8000",
} as const

async function makeServer() {
  const settings = loadSettings({ ...SCRIPTED_ENV })
  return buildServer({
    settings,
    store: createAnalysisStore(),
    loadCase: createCaseLoader(settings.dataDir),
    delayMs: 0,
  })
}

/** Parses an SSE body into validated AgentEvents. */
function parseEvents(body: string): AgentEvent[] {
  const events: AgentEvent[] = []
  for (const chunk of body.split("\n\n")) {
    const payload = chunk
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length))
      .join("\n")
    if (payload.length === 0) continue
    events.push(agentEventSchema.parse(JSON.parse(payload)))
  }
  return events
}

describe("GET /health", () => {
  it("reports ok", async () => {
    const server = await makeServer()
    const response = await server.inject({ method: "GET", url: "/health" })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: "ok" })
    await server.close()
  })
})

describe("POST /analyses", () => {
  it("acceptance 1: returns an analysis_id for case_a", async () => {
    const server = await makeServer()
    const response = await server.inject({
      method: "POST",
      url: "/analyses",
      payload: { case_id: "case_a" },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { analysis_id: string }
    expect(typeof body.analysis_id).toBe("string")
    expect(body.analysis_id.length).toBeGreaterThan(0)
    await server.close()
  })

  it("rejects an unknown case with 404", async () => {
    const server = await makeServer()
    const response = await server.inject({
      method: "POST",
      url: "/analyses",
      payload: { case_id: "case_nope" },
    })
    expect(response.statusCode).toBe(404)
    await server.close()
  })

  it("rejects a malformed body with 400", async () => {
    const server = await makeServer()
    const response = await server.inject({
      method: "POST",
      url: "/analyses",
      payload: { wrong: "field" },
    })
    expect(response.statusCode).toBe(400)
    await server.close()
  })
})

describe("GET /analyses/:id/events", () => {
  it("acceptance 2: streams steps, one verdict per deduction, then done with increasing seq", async () => {
    const server = await makeServer()
    const created = await server.inject({
      method: "POST",
      url: "/analyses",
      payload: { case_id: "case_a" },
    })
    const { analysis_id } = created.json() as { analysis_id: string }

    const stream = await server.inject({
      method: "GET",
      url: `/analyses/${analysis_id}/events`,
    })
    expect(stream.statusCode).toBe(200)
    expect(String(stream.headers["content-type"])).toContain("text/event-stream")

    const events = parseEvents(stream.body)
    const steps = events.filter((event) => event.type === "step")
    const verdicts = events.filter((event) => event.type === "verdict")

    expect(steps.length).toBeGreaterThanOrEqual(3)
    // case_a has four settlement deductions (D1-D4); the LETTER entry becomes a flag.
    expect(verdicts.length).toBe(4)
    expect(
      verdicts.map((event) => (event.data as { deduction_id: string }).deduction_id),
    ).toEqual(["D1", "D2", "D3", "D4"])

    expect(events[events.length - 1]?.type).toBe("done")

    const seqs = events.map((event) => event.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number)
    }

    await server.close()
  })

  it("allows the frontend origin to open the stream, because the hijacked response bypasses the cors plugin", async () => {
    const server = await makeServer()
    const created = await server.inject({
      method: "POST",
      url: "/analyses",
      payload: { case_id: "case_a" },
    })
    const { analysis_id } = created.json() as { analysis_id: string }

    const stream = await server.inject({
      method: "GET",
      url: `/analyses/${analysis_id}/events`,
      headers: { origin: "http://localhost:3000" },
    })

    expect(stream.headers["access-control-allow-origin"]).toBe("http://localhost:3000")
    await server.close()
  })

  it("does not allow another origin to open the stream", async () => {
    const server = await makeServer()
    const created = await server.inject({
      method: "POST",
      url: "/analyses",
      payload: { case_id: "case_a" },
    })
    const { analysis_id } = created.json() as { analysis_id: string }

    const stream = await server.inject({
      method: "GET",
      url: `/analyses/${analysis_id}/events`,
      headers: { origin: "http://evil.example" },
    })

    expect(stream.headers["access-control-allow-origin"]).toBeUndefined()
    await server.close()
  })

  it("acceptance 4: returns 404 for an unknown analysis id", async () => {
    const server = await makeServer()
    const response = await server.inject({
      method: "GET",
      url: "/analyses/does-not-exist/events",
    })
    expect(response.statusCode).toBe(404)
    await server.close()
  })
})

describe("GET /analyses/:id", () => {
  it("acceptance 3: reports done and 40719.76 recoverable for case_a", async () => {
    const server = await makeServer()
    const created = await server.inject({
      method: "POST",
      url: "/analyses",
      payload: { case_id: "case_a" },
    })
    const { analysis_id } = created.json() as { analysis_id: string }
    const analysis = await server.waitFor(analysis_id)

    expect(analysis.status).toBe("done")
    expect(analysis.total_recoverable).toBeCloseTo(40719.76, 2)

    const response = await server.inject({ method: "GET", url: `/analyses/${analysis_id}` })
    expect(response.statusCode).toBe(200)

    const stored = response.json() as {
      analysis_id: string
      case_id: string
      status: string
      total_recoverable: number
      verdicts: { deduction_id: string }[]
      flags: { kind: string; rule_id: string; detail: string }[]
      finished_at: string | null
    }

    expect(stored.status).toBe("done")
    expect(stored.analysis_id).toBe(analysis_id)
    expect(stored.case_id).toBe("case_a")
    expect(stored.total_recoverable).toBeCloseTo(40719.76, 2)
    expect(stored.finished_at).not.toBeNull()
    expect(stored.verdicts.map((verdict) => verdict.deduction_id)).toEqual([
      "D1",
      "D2",
      "D3",
      "D4",
    ])
    expect(stored.flags).toEqual([
      {
        kind: "letter_not_specific",
        rule_id: "MC24-17b",
        detail: "Letter does not reference specific policy terms",
      },
    ])

    await server.close()
  })

  it("acceptance 4: returns 404 for an unknown analysis id", async () => {
    const server = await makeServer()
    const response = await server.inject({ method: "GET", url: "/analyses/does-not-exist" })
    expect(response.statusCode).toBe(404)
    await server.close()
  })
})


describe("failure path", () => {
  it("records status error and closes the SSE stream after an error event", async () => {
    const settings = loadSettings({ ...SCRIPTED_ENV })
    const loadCase = createCaseLoader(settings.dataDir)
    const store = createAnalysisStore()
    const server = await buildServer({ settings, store, loadCase, delayMs: 0 })

    const created = await server.inject({
      method: "POST",
      url: "/analyses",
      payload: { case_id: "case_a" },
    })
    const { analysis_id } = created.json() as { analysis_id: string }
    const realAppend = store.append.bind(store)

    // Fail the run part-way through, as an unreachable backend would in TASK-08.
    let calls = 0
    store.append = (id, event) => {
      calls += 1
      if (calls === 3) throw new Error("backend unreachable")
      return realAppend(id, event)
    }

    const analysis = await server.waitFor(analysis_id)
    expect(analysis.status).toBe("error")
    expect(analysis.finished_at).not.toBeNull()
    expect(store.events(analysis_id).filter((event) => event.type === "error")).toHaveLength(1)

    const stream = await server.inject({
      method: "GET",
      url: `/analyses/${analysis_id}/events`,
    })
    const events = parseEvents(stream.body)
    expect(events.some((event) => event.type === "error")).toBe(true)
    expect(events[events.length - 1]?.type).toBe("error")

    await server.close()
  })
})

