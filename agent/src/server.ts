import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import Fastify, { type FastifyInstance } from "fastify"
import cors from "@fastify/cors"
import { z } from "zod"
import { createAnalysisRequestSchema, type Analysis, type Case } from "./types.js"
import { DraftError, createDraftService, type DraftService, type Narrator } from "./draft.js"
import { createLlmNarrator } from "./llm/narrator.js"
import type { AnalysisStore } from "./store.js"
import { createAnalysisStore } from "./store.js"
import { createBackendCaseLoader, runScripted, type CaseLoader } from "./scripted.js"
import { loadSettings, type Settings } from "./settings.js"
import { BackendError, createBackendClient } from "./backend.js"
import { runAnalysis } from "./runner.js"
import { createAgentSessionFactory } from "./llm/agent.js"
import {
  buildReplayCase,
  createReplayRegistry,
  hasEnoughReplayText,
  parsePrecedentDetail,
  REPLAY_CASE_PREFIX,
  runScriptedReplay,
  type PrecedentDetail,
  type ReplayRegistry,
} from "./replay.js"

declare module "fastify" {
  interface FastifyInstance {
    /** Resolves when the analysis reaches a terminal state (used by tests). */
    waitFor(analysisId: string): Promise<Analysis>
  }
}

/** Runs one analysis with the real agent (AGENT_MODE=llm). */
export type LlmRunner = (options: { store: AnalysisStore; analysisId: string; sampleCase: Case }) => Promise<void>

export interface ServerDeps {
  settings: Settings
  store?: AnalysisStore
  loadCase: CaseLoader
  /** Delay between scripted events; tests pass 0. */
  delayMs?: number
  /** Required when `settings.agentMode` is "llm"; injected so tests never call a model. */
  runLlm?: LlmRunner
  /** Grievance drafting; defaults to the template narrator against BACKEND_URL. */
  draftService?: DraftService
  /** Reads one award from the backend for POST /replay; defaults to BACKEND_URL. */
  getPrecedent?: (precedentId: string) => Promise<PrecedentDetail>
  /** Replay cases live here so the agent's get_case can serve them; share it with `createLlmRunner`. */
  replays?: ReplayRegistry
}

const draftRequestSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  language: z.enum(["en", "hi", "as"]),
})

/** Baseline files are looked up by case id only; anything else could leave data/baseline. */
const BASELINE_CASE_ID = /^[A-Za-z0-9_-]{1,64}$/

const templateNarrator: Narrator = async ({ fallback }) => fallback

/** Production draft service: the LLM narrator in llm mode, the template otherwise. */
export function createServerDraftService(settings: Settings, log: (message: string) => void): DraftService {
  const narrator =
    settings.agentMode === "llm"
      ? createLlmNarrator(settings, (error) =>
          log(`narrator failed, using the template: ${error instanceof Error ? error.message : String(error)}`),
        )
      : templateNarrator
  return createDraftService({ client: createBackendClient(settings.backendUrl), narrator })
}

/** Production LLM runner: Cline SDK agent sessions, gate, and backend persistence. */
export function createLlmRunner(
  settings: Settings,
  replays: ReplayRegistry = createReplayRegistry(),
): LlmRunner {
  const client = createBackendClient(settings.backendUrl)
  const createSession = createAgentSessionFactory(
    settings,
    client,
    undefined,
    (caseId) => replays.get(caseId),
    (precedentId) => replays.get(`${REPLAY_CASE_PREFIX}${precedentId}`) !== undefined,
  )
  return ({ store, analysisId, sampleCase }) =>
    runAnalysis({
      store,
      analysisId,
      sampleCase,
      createSession,
      saveAnalysis: (analysis) => client.saveAnalysis(analysis),
    })
}

export type AgentServer = FastifyInstance

function sseFrame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export async function buildServer(deps: ServerDeps): Promise<AgentServer> {
  const { settings, loadCase, runLlm } = deps
  const store = deps.store ?? createAnalysisStore()
  const delayMs = deps.delayMs ?? 400
  if (settings.agentMode === "llm" && !runLlm) {
    throw new Error("AGENT_MODE=llm requires a runLlm runner (see createLlmRunner)")
  }

  const app = Fastify({
    logger: false,
    disableRequestLogging: true,
  })

  await app.register(cors, { origin: settings.frontendOrigin })

  app.waitFor = (analysisId: string): Promise<Analysis> => {
    const existing = store.getAnalysis(analysisId)
    if (existing && existing.status !== "running") return Promise.resolve(existing)
    return new Promise<Analysis>((resolve, reject) => {
      const unsubscribe = store.onStateChange((analysis) => {
        if (analysis.analysis_id !== analysisId) return
        unsubscribe()
        resolve(analysis)
      })
      if (!store.getAnalysis(analysisId)) {
        unsubscribe()
        reject(new Error(`Unknown analysis_id: ${analysisId}`))
      }
    })
  }

  app.get("/health", async () => ({ status: "ok" }))

  app.post("/analyses", async (request, reply) => {
    const parsed = createAnalysisRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: "case_id is required", error: parsed.error.message })
    }

    let sampleCase
    try {
      sampleCase = await loadCase(parsed.data.case_id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(404).send({ message })
    }

    const analysis = store.createAnalysis(sampleCase.case_id)
    const analysisId = analysis.analysis_id
    if (settings.agentMode === "llm" && runLlm) {
      void runLlm({ store, analysisId, sampleCase })
    } else {
      void runScripted({ store, analysisId, sampleCase, delayMs })
    }
    return { analysis_id: analysisId }
  })

  app.get("/analyses/:id/events", (request, reply) => {
    const { id } = request.params as { id: string }
    if (!store.getAnalysis(id)) {
      return reply.code(404).send({ message: `Unknown analysis_id: ${id}` })
    }

    // Raw SSE: the response stays open until `done` or `error`.
    reply.hijack()
    // hijack() bypasses @fastify/cors, so the browser's EventSource needs the header set here.
    reply.raw.writeHead(200, {
      ...(request.headers.origin === settings.frontendOrigin
        ? { "access-control-allow-origin": settings.frontendOrigin }
        : {}),
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    })
    reply.raw.write(": connected\n\n")

    let seen = 0
    let closed = false
    // Declared before `close` because a backlog replay can close the stream
    // synchronously, before `subscribe` returns the unsubscribe fn.
    let unsubscribe: (() => void) | undefined

    const close = () => {
      if (closed) return
      closed = true
      unsubscribe?.()
      reply.raw.end()
    }

    unsubscribe = store.subscribe(id, (event) => {
      if (event.seq <= seen) return
      seen = event.seq
      reply.raw.write(sseFrame(event))
      if (event.type === "done" || event.type === "error") close()
    })
    reply.raw.on("close", close)
    return reply
  })

  app.get("/analyses/:id", (request, reply) => {
    const { id } = request.params as { id: string }
    const analysis = store.getAnalysis(id)
    if (!analysis) {
      return reply.code(404).send({ message: `Unknown analysis_id: ${id}` })
    }
    return analysis
  })

  const replays = deps.replays ?? createReplayRegistry()
  const getPrecedent =
    deps.getPrecedent ??
    (async (precedentId: string) =>
      parsePrecedentDetail(await createBackendClient(settings.backendUrl).getPrecedent(precedentId)))

  // The id contains `#`, so clients send it URL-encoded; Fastify decodes the param.
  app.post("/replay/:precedent_id", async (request, reply) => {
    const { precedent_id: precedentId } = request.params as { precedent_id: string }

    let precedent: PrecedentDetail
    try {
      precedent = await getPrecedent(precedentId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const notFound = error instanceof BackendError && error.status === 404
      return reply.code(notFound ? 404 : 502).send({ message: notFound ? `Unknown precedent_id: ${precedentId}` : message })
    }

    const replayCase = buildReplayCase(precedent)
    if (!hasEnoughReplayText(replayCase.settlement.letter_text)) {
      return reply
        .code(422)
        .send({ message: `skipped: too little text after redaction (${precedentId})` })
    }

    replays.register(replayCase)
    const analysis = store.createAnalysis(replayCase.case_id)
    const analysisId = analysis.analysis_id
    if (settings.agentMode === "llm" && runLlm) {
      void runLlm({ store, analysisId, sampleCase: replayCase })
    } else {
      void runScriptedReplay({ store, analysisId, replayCase, delayMs })
    }
    return { analysis_id: analysisId }
  })

  const draftService =
    deps.draftService ?? createServerDraftService(settings, (message) => app.log.warn(message))

  app.post("/analyses/:id/draft", async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = draftRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: "tier (1, 2 or 3) and language (en, hi or as) are required" })
    }
    try {
      return await draftService.draft({ store, analysisId: id, ...parsed.data })
    } catch (error) {
      const status = error instanceof DraftError ? error.status : 500
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(status).send({ message })
    }
  })

  app.get("/baseline/:case_id", async (request, reply) => {
    const { case_id: caseId } = request.params as { case_id: string }
    if (!BASELINE_CASE_ID.test(caseId)) {
      return reply.code(400).send({ message: `Invalid case_id: ${caseId}` })
    }
    const file = path.join(settings.dataDir, "baseline", `${caseId}.json`)
    let raw: string
    try {
      raw = await readFile(file, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ message: `No recorded baseline for ${caseId}` })
      }
      throw error
    }
    return JSON.parse(raw) as unknown
  })

  return app
}

/** Entrypoint: `npm run dev` / `npm start`. */
async function main(): Promise<void> {
  const settings = loadSettings()
  const replays = createReplayRegistry()
  const server = await buildServer({
    settings,
    // From the backend, so uploaded cases (SQLite) are found as well as the samples.
    loadCase: createBackendCaseLoader(createBackendClient(settings.backendUrl)),
    replays,
    ...(settings.agentMode === "llm" ? { runLlm: createLlmRunner(settings, replays) } : {}),
  })
  await server.listen({ port: settings.port, host: "0.0.0.0" })
  server.log.info(`agent service listening on :${settings.port} in ${settings.agentMode} mode`)
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
