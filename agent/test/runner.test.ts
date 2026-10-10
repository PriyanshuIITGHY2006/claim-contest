import { afterEach, describe, expect, it, vi } from "vitest"
import { createBackendClient } from "../src/backend.js"
import {
  recordToolResult,
  type CalcRecord,
  type Evidence,
  type Submission,
  type VerificationRecord,
} from "../src/gate.js"
import { SYSTEM_PROMPT, buildUserPrompt } from "../src/llm/prompt.js"
import {
  MAX_RETRIES,
  runAnalysis,
  totalRecoverable,
  type AnalysisSession,
  type SdkEvent,
  type SessionFactory,
} from "../src/runner.js"
import { createCaseLoader } from "../src/scripted.js"
import { buildServer } from "../src/server.js"
import { DEFAULT_DATA_DIR, loadSettings } from "../src/settings.js"
import { createAnalysisStore } from "../src/store.js"
import type { Analysis, Citation, Verdict } from "../src/types.js"

const loadCase = createCaseLoader(DEFAULT_DATA_DIR)

const FHO = "star_fho_v19"
const QUOTE = "Associated medical expenses means medical expenses such as Professional fees"
const cite: Citation = { source_type: "policy", source_id: FHO, quote: QUOTE, verified: true }

const VERIFICATIONS: VerificationRecord[] = [
  { source_type: "policy", source_id: FHO, quote: QUOTE, verified: true, match: "exact", page: 4 },
]
const D3_LINES = ["L07", "L08", "L09", "L10", "L11", "L12", "L13"]
const CALCS: CalcRecord[] = [
  {
    tool: "calc_proportionate",
    input: { deduction: { amount: 40719.76, line_ids: D3_LINES } },
    output: { recoverable_amount: 40719.76 },
  },
]

function verdict(id: string, status: Verdict["status"], amount: number): Verdict {
  return {
    deduction_id: id,
    status,
    recoverable_amount: amount,
    reasoning: `${id} reasoning`,
    citations: [cite],
    confidence: 0.9,
  }
}

const GOOD: Submission = {
  verdicts: [
    verdict("D1", "valid", 0),
    verdict("D2", "valid", 0),
    verdict("D3", "contestable", 40719.76),
    verdict("D4", "valid", 0),
  ],
  flags: [{ kind: "letter_not_specific", rule_id: "MC24-17b", detail: "No specific clause cited" }],
}

const WRONG_D3: Submission = {
  ...GOOD,
  verdicts: GOOD.verdicts.map((v) => (v.deduction_id === "D3" ? { ...v, recoverable_amount: 44250 } : v)),
}

type Step = Submission | undefined | Error

/** A fake agent session: replays submissions in order and emits one SDK event per call. */
function fakeSessions(steps: Step[]) {
  const prompts: string[] = []
  const factory: SessionFactory = (onEvent) => {
    const next = async (prompt: string) => {
      prompts.push(prompt)
      const event: SdkEvent = {
        type: "tool-started",
        iteration: prompts.length,
        toolCall: { type: "tool-call", toolCallId: `t${prompts.length}`, toolName: "calc_proportionate", input: {} },
      }
      onEvent(event)
      const step = steps[Math.min(prompts.length - 1, steps.length - 1)]
      if (step instanceof Error) throw step
      return step
    }
    const session: AnalysisSession = {
      start: next,
      retry: next,
      evidence: (): Evidence => ({ verifications: VERIFICATIONS, calcs: CALCS }),
    }
    return session
  }
  return { factory, prompts }
}

async function run(steps: Step[], saveAnalysis?: (analysis: Analysis) => Promise<unknown>) {
  const store = createAnalysisStore()
  const analysis = store.createAnalysis("case_a")
  const { factory, prompts } = fakeSessions(steps)
  await runAnalysis({
    store,
    analysisId: analysis.analysis_id,
    sampleCase: await loadCase("case_a"),
    createSession: factory,
    ...(saveAnalysis ? { saveAnalysis } : {}),
  })
  const finished = store.getAnalysis(analysis.analysis_id)
  if (!finished) throw new Error("analysis vanished")
  return { finished, events: store.events(analysis.analysis_id), prompts }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("runAnalysis", () => {
  it("accepts gated verdicts, streams events, saves to the backend and totals in paise", async () => {
    const save = vi.fn(async (_analysis: Analysis) => ({ analysis_id: "x" }))
    const { finished, events, prompts } = await run([GOOD], save)

    expect(finished.status).toBe("done")
    expect(finished.total_recoverable).toBe(40719.76)
    expect(finished.verdicts.map((v) => v.deduction_id)).toEqual(["D1", "D2", "D3", "D4"])
    expect(finished.verdicts.find((v) => v.deduction_id === "D3")?.include_in_grievance).toBe(true)
    expect(finished.flags).toEqual(GOOD.flags)
    expect(prompts).toHaveLength(1)

    expect(events.some((e) => e.type === "tool_call" && e.message.includes("calc_proportionate"))).toBe(true)
    expect(events.filter((e) => e.type === "verdict")).toHaveLength(4)
    expect(events.at(-1)?.type).toBe("done")

    expect(save).toHaveBeenCalledTimes(1)
    const saved = save.mock.calls[0]?.[0]
    expect(saved?.status).toBe("done")
    expect(saved?.total_recoverable).toBe(40719.76)
    expect(saved?.verdicts).toHaveLength(4)
  })

  it("feeds gate rejections back and accepts the corrected submission", async () => {
    const { finished, prompts, events } = await run([WRONG_D3, GOOD])
    expect(finished.status).toBe("done")
    expect(finished.total_recoverable).toBe(40719.76)
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toMatch(/D3/)
    expect(prompts[1]).toMatch(/40719\.76/)
    expect(events.some((e) => e.type === "step" && /rejected/i.test(e.message))).toBe(true)
  })

  it(`after ${MAX_RETRIES} retries, still-rejected deductions become needs_info with 0 recoverable`, async () => {
    const { finished, prompts } = await run([WRONG_D3])
    expect(MAX_RETRIES).toBe(2)
    expect(prompts).toHaveLength(1 + MAX_RETRIES)
    const d3 = finished.verdicts.find((v) => v.deduction_id === "D3")
    expect(d3).toMatchObject({ status: "needs_info", recoverable_amount: 0, include_in_grievance: false })
    expect(d3?.reasoning).toMatch(/40719\.76/)
    expect(finished.verdicts.filter((v) => v.status === "valid")).toHaveLength(3)
    expect(finished.total_recoverable).toBe(0)
    expect(finished.status).toBe("done")
  })

  it("treats a run without submit_verdicts as all deductions missing", async () => {
    const { finished, prompts } = await run([undefined])
    expect(prompts).toHaveLength(1 + MAX_RETRIES)
    expect(prompts[1]).toMatch(/submit_verdicts/)
    expect(finished.verdicts.map((v) => v.status)).toEqual([
      "needs_info",
      "needs_info",
      "needs_info",
      "needs_info",
    ])
  })

  it("records an error when the agent run fails", async () => {
    const { finished, events } = await run([new Error("provider unavailable")])
    expect(finished.status).toBe("error")
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("provider unavailable") })
  })

  it("keeps the in-memory analysis when saving to the backend fails", async () => {
    const save = vi.fn(async () => {
      throw new Error("Backend POST /analyses failed with 422: total_recoverable does not match verdicts")
    })
    const { finished, events } = await run([GOOD], save)
    expect(finished.status).toBe("done")
    expect(finished.total_recoverable).toBe(40719.76)
    expect(events.some((e) => e.type === "step" && /not saved/i.test(e.message))).toBe(true)
    expect(events.at(-1)?.type).toBe("done")
  })
})

describe("prompts never carry the answer key", () => {
  it("the system prompt, user prompt and retry prompts never mention `expected`", async () => {
    expect(SYSTEM_PROMPT).not.toMatch(/expected/i)
    expect(buildUserPrompt("case_a")).not.toMatch(/expected/i)
    const { prompts } = await run([WRONG_D3, undefined, GOOD])
    expect(prompts).toHaveLength(3)
    for (const prompt of prompts) {
      expect(prompt).not.toMatch(/expected/i)
      expect(prompt).not.toMatch(/Ramesh|synthetic_notice/)
    }
  })
})

describe("evidence and totals", () => {
  it("recordToolResult keeps the verify_quote page and calc inputs/outputs", () => {
    const evidence: Evidence = { verifications: [], calcs: [] }
    recordToolResult(
      evidence,
      "verify_quote",
      { source_type: "policy", source_id: FHO, quote: QUOTE },
      { verified: true, match: "exact", score: 1, page: 4 },
    )
    recordToolResult(evidence, "calc_tat", { limit_minutes: 180 }, { breached: true })
    recordToolResult(evidence, "search_rules", { query: "x" }, [])
    expect(evidence.verifications).toEqual([
      { source_type: "policy", source_id: FHO, quote: QUOTE, verified: true, match: "exact", score: 1, page: 4 },
    ])
    expect(evidence.calcs).toEqual([{ tool: "calc_tat", input: { limit_minutes: 180 }, output: { breached: true } }])
  })

  it("totals in paise to avoid float drift", () => {
    expect(totalRecoverable([verdict("A", "contestable", 0.1), verdict("B", "contestable", 0.2)])).toBe(0.3)
  })

  it("backend saveAnalysis posts the analysis to /analyses", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ analysis_id: "a1" }), { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)
    const result = await createBackendClient("http://backend.test").saveAnalysis({ analysis_id: "a1" })
    expect(result).toEqual({ analysis_id: "a1" })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://backend.test/analyses")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ analysis_id: "a1" })
  })
})

describe("server in llm mode", () => {
  const LLM_ENV = {
    AGENT_MODE: "llm",
    BACKEND_URL: "http://localhost:8000",
    LLM_PROVIDER: "test-provider",
    LLM_MODEL: "test-model",
    LLM_API_KEY: "test-key",
  } as const

  it("runs the injected LLM runner instead of the scripted one", async () => {
    const settings = loadSettings({ ...LLM_ENV })
    const store = createAnalysisStore()
    const runLlm = vi.fn(async ({ analysisId }: { analysisId: string }) => {
      store.append(analysisId, { type: "done", message: "fake" })
      store.finish(analysisId, {
        status: "done",
        verdicts: [],
        total_recoverable: 0,
        flags: [],
        finished_at: new Date().toISOString(),
      })
    })
    const server = await buildServer({ settings, store, loadCase, runLlm })
    const created = await server.inject({ method: "POST", url: "/analyses", payload: { case_id: "case_a" } })
    const { analysis_id } = created.json() as { analysis_id: string }
    await server.waitFor(analysis_id)
    expect(runLlm).toHaveBeenCalledTimes(1)
    expect(store.events(analysis_id).map((e) => e.message)).toEqual(["fake"])
    await server.close()
  })

  it("refuses to build in llm mode without a runner", async () => {
    const settings = loadSettings({ ...LLM_ENV })
    await expect(buildServer({ settings, loadCase })).rejects.toThrow(/runLlm/)
  })
})

describe("verified quotes in the live timeline", () => {
  it("a finished verify_quote event carries its verified result and source", async () => {
    const store = createAnalysisStore()
    const analysis = store.createAnalysis("case_a")
    const factory: SessionFactory = (onEvent) => ({
      start: async () => {
        onEvent({
          type: "tool-finished",
          iteration: 1,
          toolCall: { type: "tool-call", toolCallId: "v1", toolName: "verify_quote", input: {} },
        })
        return GOOD
      },
      retry: async () => GOOD,
      evidence: (): Evidence => ({ verifications: VERIFICATIONS, calcs: CALCS }),
    })
    await runAnalysis({
      store,
      analysisId: analysis.analysis_id,
      sampleCase: await loadCase("case_a"),
      createSession: factory,
    })
    const result = store
      .events(analysis.analysis_id)
      .find((event) => event.type === "tool_result" && (event.data as { tool?: string })?.tool === "verify_quote")
    expect(result?.data).toMatchObject({ tool: "verify_quote", verified: true, source_id: FHO })
  })
})
