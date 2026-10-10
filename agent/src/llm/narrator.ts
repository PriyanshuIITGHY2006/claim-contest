import { Agent } from "@cline/sdk"
import type { Language, Narrator } from "../draft.js"
import type { Settings } from "../settings.js"

/**
 * LLM narrator for the one narrative paragraph of a grievance letter, used only
 * when AGENT_MODE=llm. Amounts, dates, quotes and rule ids are all built by
 * code, so a paragraph that contains any digit is discarded for the template.
 */

const LANGUAGE_NAMES: Record<Language, string> = { en: "English", hi: "Hindi", as: "Assamese" }

const NARRATOR_PROMPT = `You write one short paragraph (at most five sentences) for a policyholder's grievance letter to an Indian health insurer.
Explain in plain language why the contested deductions are wrong, using only the reasons given to you.
Never write any digit: no amounts, dates, percentages, clause numbers or deduction ids. The letter already contains them.
Do not add facts, threats or legal claims. Reply with the paragraph only.`

/** Returns the model paragraph if it is usable, otherwise the template fallback. */
export function safeNarrative(candidate: string | undefined, fallback: string): string {
  const text = candidate?.trim()
  if (!text) return fallback
  if (/\d/.test(text)) return fallback
  return text
}

export function createLlmNarrator(
  settings: Settings,
  // Called when the model fails; the draft then uses the template paragraph.
  onError: (error: unknown) => void,
  AgentClass: typeof Agent = Agent,
): Narrator {
  const { llmProvider, llmModel, llmApiKey } = settings
  if (!llmProvider || !llmModel || !llmApiKey) {
    throw new Error("The LLM narrator requires LLM_PROVIDER, LLM_MODEL and LLM_API_KEY")
  }

  return async ({ contested, language, fallback }) => {
    if (contested.length === 0) return fallback
    const agent = new AgentClass({
      providerId: llmProvider,
      modelId: llmModel,
      apiKey: llmApiKey,
      systemPrompt: NARRATOR_PROMPT,
      maxIterations: 1,
      tools: [],
      toolPolicies: {},
    })
    const reasons = contested.map((v) => `- ${v.reasoning}`).join("\n")
    try {
      const result = await agent.run(
        `Write the paragraph in ${LANGUAGE_NAMES[language]}. Reasons the deductions are wrong:\n${reasons}`,
      )
      if (result.status !== "completed") {
        onError(new Error(`Narrator run ${result.status}: ${result.error?.message ?? "no details"}`))
        return fallback
      }
      return safeNarrative(result.outputText, fallback)
    } catch (error) {
      // A narrator failure must never block a draft: report it, use the template.
      onError(error)
      return fallback
    }
  }
}
