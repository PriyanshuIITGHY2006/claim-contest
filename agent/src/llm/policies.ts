import { ALL_TOOL_NAMES, type ToolName } from "./tools.js"

export interface ToolPolicy {
  autoApprove: boolean
  enabled?: boolean
}

/**
 * Explicit policy for every tool: all of them are read-only backend calls, so
 * they run without approval. Unlisted tools would default to enabled and
 * auto-approved, which is why each one is listed.
 */
export const toolPolicies: Record<ToolName, ToolPolicy> = Object.fromEntries(
  ALL_TOOL_NAMES.map((name) => [name, { autoApprove: true }]),
) as Record<ToolName, ToolPolicy>
