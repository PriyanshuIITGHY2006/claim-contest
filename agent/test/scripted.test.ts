import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { buildServer } from "../src/server.js"
import { buildScriptedOutcome, createCaseLoader } from "../src/scripted.js"
import { DEFAULT_DATA_DIR, loadSettings } from "../src/settings.js"
import { createAnalysisStore } from "../src/store.js"

const SCRIPTED_ENV = {
  AGENT_MODE: "scripted",
  BACKEND_URL: "http://localhost:8000",
} as const

describe("loadSettings", () => {
  it("defaults PORT to 8100 and does not require LLM vars in scripted mode", () => {
    const settings = loadSettings({ ...SCRIPTED_ENV })
    expect(settings.port).toBe(8100)
    expect(settings.agentMode).toBe("scripted")
    expect(settings.backendUrl).toBe("http://localhost:8000")
    expect(settings.llmApiKey).toBeUndefined()
  })

  it("treats blank LLM vars (as in .env.example) as unset in scripted mode", () => {
    const settings = loadSettings({
      ...SCRIPTED_ENV,
      LLM_PROVIDER: "",
      LLM_MODEL: "",
      LLM_API_KEY: "",
    })
    expect(settings.llmProvider).toBeUndefined()
    expect(() =>
      loadSettings({ ...SCRIPTED_ENV, AGENT_MODE: "llm", LLM_PROVIDER: "", LLM_MODEL: "", LLM_API_KEY: "" }),
    ).toThrowError(/LLM_PROVIDER, LLM_MODEL, LLM_API_KEY/)
  })

  it("fails with a clear message when BACKEND_URL is missing", () => {
    expect(() => loadSettings({ AGENT_MODE: "scripted" })).toThrowError(/BACKEND_URL/)
  })

  it("requires the LLM vars in llm mode", () => {
    expect(() =>
      loadSettings({
        AGENT_MODE: "llm",
        BACKEND_URL: "http://localhost:8000",
        LLM_PROVIDER: "test-provider",
        LLM_MODEL: "test-model",
      }),
    ).toThrowError(/LLM_API_KEY/)

    const settings = loadSettings({
      AGENT_MODE: "llm",
      BACKEND_URL: "http://localhost:8000",
      LLM_PROVIDER: "test-provider",
      LLM_MODEL: "test-model",
      LLM_API_KEY: "test-key",
    })
    expect(settings.llmApiKey).toBe("test-key")
  })

  it("rejects an unknown AGENT_MODE and a non-numeric PORT", () => {
    expect(() => loadSettings({ ...SCRIPTED_ENV, AGENT_MODE: "magic" })).toThrowError(/AGENT_MODE/)
    expect(() => loadSettings({ ...SCRIPTED_ENV, PORT: "abc" })).toThrowError(/PORT/)
  })

  it("resolves DATA_DIR relative to the agent folder when not set", () => {
    const settings = loadSettings({ ...SCRIPTED_ENV })
    // Path-independent: the repo folder name differs between checkouts.
    expect(settings.dataDir).toBe(DEFAULT_DATA_DIR)
    expect(existsSync(path.join(settings.dataDir, "cases", "case_a.json"))).toBe(true)
  })
})

describe("createCaseLoader", () => {
  it("loads a known case and throws for an unknown one", async () => {
    const settings = loadSettings({ ...SCRIPTED_ENV })
    const loadCase = createCaseLoader(settings.dataDir)
    const loaded = await loadCase("case_a")
    expect(loaded.case_id).toBe("case_a")
    expect(loaded.settlement.deductions).toHaveLength(4)
    await expect(loadCase("case_nope")).rejects.toThrow(/case_nope/)
  })
})

describe("buildScriptedOutcome", () => {
  it("maps expected entries to verdicts for deductions and flags for the rest", async () => {
    const settings = loadSettings({ ...SCRIPTED_ENV })
    const caseA = await createCaseLoader(settings.dataDir)("case_a")
    const outcome = buildScriptedOutcome(caseA)

    expect(outcome.verdicts.map((verdict) => verdict.deduction_id)).toEqual([
      "D1",
      "D2",
      "D3",
      "D4",
    ])
    expect(outcome.totalRecoverable).toBeCloseTo(40719.76, 2)
    expect(outcome.flags).toEqual([
      {
        kind: "letter_not_specific",
        rule_id: "MC24-17b",
        detail: "Letter does not reference specific policy terms",
      },
    ])

    const d3 = outcome.verdicts.find((verdict) => verdict.deduction_id === "D3")
    expect(d3?.status).toBe("contestable")
    expect(d3?.recoverable_amount).toBeCloseTo(40719.76, 2)
    expect(d3?.confidence).toBe(0.9)
    expect(d3?.reasoning.length).toBeGreaterThan(0)
    expect(d3?.citations).toEqual([
      {
        source_type: "policy",
        source_id: "associated_expenses_definition",
        quote: "",
        verified: false,
      },
    ])

    const d1 = outcome.verdicts.find((verdict) => verdict.deduction_id === "D1")
    expect(d1?.citations).toEqual([
      { source_type: "policy", source_id: "room_limit_table", quote: "", verified: false },
    ])
  })

  it("mixes rule citations and raises both flag kinds for case_d", async () => {
    const settings = loadSettings({ ...SCRIPTED_ENV })
    const caseD = await createCaseLoader(settings.dataDir)("case_d")
    const outcome = buildScriptedOutcome(caseD)

    expect(outcome.verdicts).toHaveLength(1)
    expect(outcome.totalRecoverable).toBeCloseTo(3750, 2)
    expect(outcome.verdicts[0]?.citations).toEqual([
      { source_type: "rule", source_id: "MC24-16a", quote: "", verified: false },
      { source_type: "rule", source_id: "MC24-16b", quote: "", verified: false },
    ])
    expect(outcome.flags).toEqual([
      {
        kind: "tat_breach",
        rule_id: "MC24-15b",
        detail: "Cashless decision took 2h15m against a one-hour limit (breach recorded; no separate amount)",
      },
      {
        kind: "letter_not_specific",
        rule_id: "MC24-17b",
        detail: "Letter cites 'policy terms' without a specific clause",
      },
    ])
  })
})


describe("createAnalysisStore", () => {
  it("assigns strictly increasing seq numbers per analysis", () => {
    const store = createAnalysisStore()
    const analysis = store.createAnalysis("case_a")
    store.append(analysis.analysis_id, { type: "step", message: "one" })
    store.append(analysis.analysis_id, { type: "step", message: "two" })
    expect(store.events(analysis.analysis_id).map((event) => event.seq)).toEqual([1, 2])
    expect(store.getAnalysis(analysis.analysis_id)?.status).toBe("running")
    expect(store.getAnalysis("nope")).toBeUndefined()
  })

  it("throws when appending to an unknown analysis", () => {
    const store = createAnalysisStore()
    expect(() => store.append("nope", { type: "step", message: "x" })).toThrowError(/nope/)
  })
})

describe("server.waitFor", () => {
  it("resolves once the scripted run reaches done", async () => {
    const settings = loadSettings({ ...SCRIPTED_ENV })
    const server = await buildServer({
      settings,
      store: createAnalysisStore(),
      loadCase: createCaseLoader(settings.dataDir),
      delayMs: 0,
    })
    const created = await server.inject({
      method: "POST",
      url: "/analyses",
      payload: { case_id: "case_b" },
    })
    const { analysis_id } = created.json() as { analysis_id: string }
    const analysis = await server.waitFor(analysis_id)
    expect(analysis.status).toBe("done")
    expect(analysis.total_recoverable).toBeCloseTo(110000, 2)
    await server.close()
  })
})

