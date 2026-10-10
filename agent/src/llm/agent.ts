import { Agent, createTool } from "@cline/sdk"
import type { BackendClient } from "../backend.js"
import { recordToolResult, submissionSchema, type Evidence, type Submission } from "../gate.js"
import type { AnalysisSession, SdkEvent, SessionFactory } from "../runner.js"
import type { Settings } from "../settings.js"
import { toolPolicies as backendToolPolicies, type ToolPolicy } from "./policies.js"
import { SYSTEM_PROMPT } from "./prompt.js"
import { createTools, type AgentTool, type CaseOverride, type HiddenPrecedent } from "./tools.js"

/** Upper bound on model turns per run (tool calls plus the final submission). */
export const MAX_ITERATIONS = 40

export const SUBMIT_TOOL_NAME = "submit_verdicts"

/**
 * Wraps a backend tool so its validated input and output are recorded as
 * evidence for the citation gate. Errors still reach the model unchanged.
 */
function withEvidence(tool: AgentTool, evidence: Evidence): AgentTool {
  return {
    ...tool,
    async execute(input: unknown, context: unknown) {
      const output = await (tool.execute as (i: unknown, c: unknown) => Promise<unknown>)(input, context)
      recordToolResult(evidence, tool.name, input, output)
      return output
    },
  } as AgentTool
}

function createSubmitTool(onSubmit: (submission: Submission) => void) {
  return createTool({
    name: SUBMIT_TOOL_NAME,
    description:
      "Submit the final audit: exactly one verdict per settlement deduction plus all flags. Every citation must have passed verify_quote and every rupee amount must come from a calc tool. This ends your turn; if the gate finds problems you will be told which ones to fix.",
    inputSchema: submissionSchema,
    lifecycle: { completesRun: true },
    async execute(input: unknown) {
      const parsed = submissionSchema.safeParse(input)
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`).join("; ")
        throw new Error(`Invalid input for ${SUBMIT_TOOL_NAME}: ${issues}`)
      }
      onSubmit(parsed.data)
      return { received: parsed.data.verdicts.length }
    },
  })
}

/** Explicit policy for every registered tool, including submit_verdicts. */
export function agentToolPolicies(toolNames: readonly string[]): Record<string, ToolPolicy> {
  const policies: Record<string, ToolPolicy> = {}
  for (const name of toolNames) {
    const policy = (backendToolPolicies as Record<string, ToolPolicy>)[name]
    if (!policy) throw new Error(`No tool policy defined for ${name}`)
    policies[name] = policy
  }
  policies[SUBMIT_TOOL_NAME] = { autoApprove: true }
  return policies
}

/**
 * Session factory backed by the Cline SDK Agent. Provider, model and key come
 * from settings (LLM_PROVIDER / LLM_MODEL / LLM_API_KEY), never from code.
 */
export function createAgentSessionFactory(
  settings: Settings,
  client: BackendClient,
  // Injectable so the full SDK loop can be exercised with a scripted model.
  AgentClass: typeof Agent = Agent,
  caseOverride?: CaseOverride,
  isHiddenPrecedent?: HiddenPrecedent,
): SessionFactory {
  const { llmProvider, llmModel, llmApiKey } = settings
  if (!llmProvider || !llmModel || !llmApiKey) {
    throw new Error("AGENT_MODE=llm requires LLM_PROVIDER, LLM_MODEL and LLM_API_KEY")
  }

  return (onEvent: (event: SdkEvent) => void): AnalysisSession => {
    const evidence: Evidence = { verifications: [], calcs: [] }
    let submitted: Submission | undefined

    const tools = createTools(client, caseOverride, isHiddenPrecedent).AVAILABLE_TOOLS.map((tool) => withEvidence(tool, evidence))
    const submitTool = createSubmitTool((submission) => {
      submitted = submission
    })
    const agent = new AgentClass({
      providerId: llmProvider,
      modelId: llmModel,
      apiKey: llmApiKey,
      systemPrompt: SYSTEM_PROMPT,
      maxIterations: MAX_ITERATIONS,
      tools: [...tools, submitTool],
      toolPolicies: agentToolPolicies(tools.map((tool) => tool.name)),
    })
    agent.subscribe((event: SdkEvent) => onEvent(event))

    const turn = async (send: () => Promise<{ status: string; error?: Error }>) => {
      submitted = undefined
      const result = await send()
      if (result.status === "failed" || result.status === "aborted") {
        throw new Error(`Agent run ${result.status}: ${result.error?.message ?? "no details"}`)
      }
      return submitted
    }

    return {
      start: (prompt) => turn(() => agent.run(prompt)),
      retry: (prompt) => turn(() => agent.continue(prompt)),
      evidence: () => evidence,
    }
  }
}
