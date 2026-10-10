import { Agent } from "@cline/sdk"
import { describe, expect, it, vi } from "vitest"
import type { Language } from "../src/draft.js"
import { createLlmNarrator } from "../src/llm/narrator.js"
import { loadSettings } from "../src/settings.js"
import type { Case, Verdict } from "../src/types.js"

const settings = loadSettings({
  AGENT_MODE: "llm",
  BACKEND_URL: "http://localhost:8000",
  LLM_PROVIDER: "test-provider",
  LLM_MODEL: "test-model",
  LLM_API_KEY: "test-key",
})

const contested: Verdict[] = [
  {
    deduction_id: "D3",
    status: "contestable",
    recoverable_amount: 40719.76,
    reasoning: "Pharmacy, consumables, implants and diagnostics are not associated medical expenses.",
    citations: [],
    confidence: 0.9,
  },
]

/** The real SDK Agent driven by a scripted model that replies with `reply` (or throws). */
function scriptedAgent(reply: string | Error) {
  const prompts: string[] = []
  class ScriptedAgent extends Agent {
    constructor(config: Record<string, unknown>) {
      super({
        ...config,
        model: {
          async *stream(request: { messages: readonly unknown[] }) {
            prompts.push(JSON.stringify(request.messages))
            if (reply instanceof Error) throw reply
            yield { type: "text-delta", text: reply }
            yield { type: "finish", reason: "stop" }
          },
        },
      } as never)
    }
  }
  return { AgentClass: ScriptedAgent as unknown as typeof Agent, prompts }
}

async function narrate(reply: string | Error, language: Language = "en") {
  const { AgentClass, prompts } = scriptedAgent(reply)
  const onError = vi.fn()
  const narrator = createLlmNarrator(settings, onError, AgentClass)
  const text = await narrator({ contested, sampleCase: {} as Case, language, fallback: "TEMPLATE" })
  return { text, onError, prompts }
}

describe("LLM narrator", () => {
  it("uses the model paragraph when it contains no digits", async () => {
    const { text, prompts } = await narrate("The insurer cut items that the policy never links to the room category.")
    expect(text).toBe("The insurer cut items that the policy never links to the room category.")
    expect(prompts[0]).toContain("not associated medical expenses")
    expect(prompts[0]).not.toMatch(/40719|40,719/)
  })

  it("falls back to the template when the model paragraph contains any digit", async () => {
    const { text, onError } = await narrate("The insurer wrongly deducted Rs 40,719.76 from my claim.")
    expect(text).toBe("TEMPLATE")
    expect(onError).not.toHaveBeenCalled()
  })

  it("falls back to the template and reports the error when the model fails", async () => {
    const { text, onError } = await narrate(new Error("provider down"))
    expect(text).toBe("TEMPLATE")
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it("does not call the model when nothing is contested", async () => {
    const { AgentClass, prompts } = scriptedAgent("unused")
    const narrator = createLlmNarrator(settings, vi.fn(), AgentClass)
    expect(await narrator({ contested: [], sampleCase: {} as Case, language: "en", fallback: "TEMPLATE" })).toBe("TEMPLATE")
    expect(prompts).toHaveLength(0)
  })
})
