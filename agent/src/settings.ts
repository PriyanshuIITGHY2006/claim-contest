import { fileURLToPath } from "node:url"
import path from "node:path"
import { z } from "zod"

const agentDir = path.dirname(fileURLToPath(import.meta.url))

/** DATA_DIR is resolved from the agent folder, not the process cwd, so tests pass anywhere. */
export const DEFAULT_DATA_DIR = path.resolve(agentDir, "..", "..", "data")
export const DEFAULT_PORT = 8100
const FRONTEND_ORIGIN = "http://localhost:3000"

// `.env.example` ships `LLM_*=` blank; treat blank as unset so scripted mode starts.
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
)

const envSchema = z.object({
  AGENT_MODE: z.enum(["scripted", "llm"]).default("scripted"),
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
  BACKEND_URL: z.url(),
  DATA_DIR: z.string().min(1).default(DEFAULT_DATA_DIR),
  LLM_PROVIDER: optionalString,
  LLM_MODEL: optionalString,
  LLM_API_KEY: optionalString,
})

export interface Settings {
  agentMode: "scripted" | "llm"
  port: number
  backendUrl: string
  dataDir: string
  frontendOrigin: string
  llmProvider?: string
  llmModel?: string
  llmApiKey?: string
}

function nameMissingKeys(error: z.ZodError): string[] {
  return error.issues
    .filter((issue) => issue.code === "invalid_type" && issue.expected !== "undefined")
    .map((issue) => issue.path.join("."))
    .filter((key) => key.length > 0)
}

/** Reads and validates configuration once, at startup. */
export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const missing = nameMissingKeys(parsed.error)
    const detail = missing.length > 0 ? `missing: ${missing.join(", ")}` : parsed.error.message
    throw new Error(`Invalid agent configuration (${detail})`)
  }

  const settings = parsed.data
  if (settings.AGENT_MODE === "llm") {
    const required = {
      LLM_PROVIDER: settings.LLM_PROVIDER,
      LLM_MODEL: settings.LLM_MODEL,
      LLM_API_KEY: settings.LLM_API_KEY,
    }
    const absent = Object.entries(required)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key)
    if (absent.length > 0) {
      throw new Error(
        `Invalid agent configuration (AGENT_MODE=llm requires ${absent.join(", ")})`,
      )
    }
  }

  return {
    agentMode: settings.AGENT_MODE,
    port: settings.PORT,
    backendUrl: settings.BACKEND_URL,
    dataDir: settings.DATA_DIR,
    frontendOrigin: FRONTEND_ORIGIN,
    ...(settings.LLM_PROVIDER !== undefined ? { llmProvider: settings.LLM_PROVIDER } : {}),
    ...(settings.LLM_MODEL !== undefined ? { llmModel: settings.LLM_MODEL } : {}),
    ...(settings.LLM_API_KEY !== undefined ? { llmApiKey: settings.LLM_API_KEY } : {}),
  }
}
