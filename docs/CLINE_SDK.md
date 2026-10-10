# Cline SDK — reference for using Cline inside the product

If the product needs an AI agent (anything that reasons, calls tools, or works through multi-step tasks), build it on the Cline SDK instead of a raw model API. Cline is then used both to build the project and as the product's agent runtime.

Sources: docs.cline.bot/sdk/overview, docs.cline.bot/sdk/tools, docs.cline.bot/sdk/model-providers. The SDK is pre-1.0 (v0.0.92 at the time of writing): pin the version and check the docs if an API differs.

## Install
- Node.js ≥ 22.
- `npm install @cline/sdk zod` (pin exact versions in `package.json`; list both as allowed dependencies in the task file).

## Packages
| Package | Role |
|---|---|
| `@cline/sdk` | Entry point (re-exports `@cline/core`) |
| `@cline/core` | Node runtime: sessions, built-in tools, persistence, checkpoints, subagents |
| `@cline/agents` | Stateless agent loop, no built-in tools, browser-compatible |
| `@cline/llms` | Model gateway and provider catalog |
| `@cline/shared` | Shared types, schemas, tool helpers, hooks |

## Verified API (v0.0.92, checked against the package's type definitions)
- `Agent` (alias of `AgentRuntime`) constructor takes `providerId`, `modelId`, `apiKey`, plus optional `systemPrompt`, `tools`, `maxIterations`, `toolPolicies`, `hooks`, `plugins`.
- Methods: `run(input)`, `continue(input?)`, `abort(reason?)`, `subscribe(listener)` (returns an unsubscribe function), `snapshot()`, `restore(messages)`.
- Event types from `subscribe`: `run-started`, `turn-started`, `assistant-text-delta`, `assistant-reasoning-delta`, `assistant-message`, `tool-started`, `tool-updated`, `tool-finished`, `usage-updated`, `turn-finished`, `status-notice`, `run-finished`, `run-failed` (plus `message-added`, `assistant-media`).
- `createTool({ name, description, inputSchema, execute(input, context) })` — `inputSchema` is a zod schema or JSON Schema; optional `timeoutMs`, `retryable`, `maxRetries`.
- Multi-agent: `AgentTeam`, `createSpawnAgentTool`, `createDelegatedAgent` (exported from `@cline/sdk`).
- MCP: `createMcpTools`, `InMemoryMcpManager` (exported from `@cline/sdk`).

## Known issue in v0.0.92: TypeScript types
The runtime works (`Agent`, `createTool`, `AgentTeam` load and run in Node), but the published `.d.ts` files reference names `@cline/shared` does not export, so some types resolve to `any`.
- Use `"skipLibCheck": true` in `tsconfig.json`.
- Annotate explicitly: tool input as `z.infer<typeof schema>` and the `subscribe` callback parameter with a local event type.
- Use `"type": "module"` in `package.json` (the SDK is ESM).

## Running the product's agent on Cline credits
The SDK's provider catalog (v0.0.92) includes provider id `cline` ("Cline Usage-Billing") and ClinePass models with ids `cline-pass/<model>` (e.g. `cline-pass/deepseek-v4-pro`, `cline-pass/glm-5.3`). So the product's agent can run on the team's Cline credits or ClinePass instead of a separate model API key:
- `LLM_PROVIDER=cline`, `LLM_MODEL=cline-pass/deepseek-v4-pro` (or a usage-billing model), `LLM_API_KEY=<Cline account key>`.
- The SDK also exports Cline account helpers (`loginClineOAuth`, `getValidClineCredentials`, `ClineAccountService`). Confirm in TASK-06 how the key/credentials are obtained (account API key vs OAuth) before relying on it; fall back to another provider if it does not work.
- This makes Cline the runtime of the product's agent as well as the development tool.

## Minimal agent
```ts
import "server-only"
import { Agent } from "@cline/sdk"
import { settings } from "./settings" // validates LLM_* at startup

const agent = new Agent({
  providerId: settings.llmProvider,
  modelId: settings.llmModel,
  apiKey: settings.llmApiKey,
  systemPrompt: "…role and rules for the agent…",
  maxIterations: 8,
  tools: [/* createTool(...) */],
  toolPolicies: { /* tool_name: { autoApprove: true } */ },
})

agent.subscribe((event) => {
  if (event.type === "assistant-text-delta") process.stdout.write(event.text ?? "")
})

const result = await agent.run("…task for the agent…")
```

## Custom tools
```ts
import { createTool } from "@cline/sdk"
import { z } from "zod"

const lookupRecord = createTool({
  name: "lookup_record",
  description: "Find a record by id. Returns it as JSON.",
  inputSchema: z.object({ id: z.string().describe("Record id") }),
  async execute(input) {
    return await db.find(input.id)
  },
})
```
- `inputSchema`: zod or JSON Schema.
- Pass tools in `tools: [...]` on `Agent`; for `ClineCore` sessions use `extraTools` in the session config; plugins can call `api.registerTool(...)`.
- `toolPolicies` per tool: `{ autoApprove: true }`, `{ autoApprove: false }` (needs approval), `{ enabled: false }`. Unlisted tools default to enabled and auto-approved — always list policies explicitly.

## Built-in tools (ClineCore)
`read_files`, `editor`, `apply_patch`, `run_commands`, `search_codebase`, `fetch_web_content`, `skills`, `ask_question`, `submit_and_exit`. `Agent` has none built in; enable only what the product needs.

## Other capabilities (check docs before relying on them)
Sessions and persistence, checkpoints, subagents with their own model/tools, plugins and lifecycle hooks, cron jobs, MCP connectors, multiple model providers, LiteLLM and OpenAI-compatible endpoints.

## Project conventions
- The SDK lives in one module (the LLM client, e.g. `frontend/lib/server/agent.ts` or a Node service). Nothing else imports it.
- The SDK needs Node ≥ 22, so it cannot run inside FastAPI; see `.clinerules/02-stack.md`.
- Server only: `import "server-only"` at the top, called from route handlers or server actions, never from client components. No `NEXT_PUBLIC_` prefix on `LLM_*` variables.
- Env vars are read and validated in one settings module; a missing value fails at startup, not inside the SDK.
- Provider, model and key come from environment variables (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`); no provider or model names in source.
- Every custom tool has a unit test for `execute` that runs without calling a model.
- Note: the SDK uses an API key (per-token billing), not a chat subscription. Budget the app's model calls accordingly.
