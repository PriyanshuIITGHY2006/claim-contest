/**
 * Replays every human-labelled award (data/eval/awards.csv) through the real
 * agent and prints agreement with the labels and the citation-verification rate.
 *
 * COSTS CREDITS: one full model run per labelled award. Never run from tests.
 *
 *   AGENT_MODE=llm npx tsx --env-file-if-exists=../.env scripts/eval.ts
 *
 * Labels are read through GET /eval/awards. They are the outcomes a person read
 * from each award; nothing here derives a label from the keyword guess or from a
 * model. With no labelled rows there is nothing to measure and no numbers are made up.
 */
import { createBackendClient } from "../src/backend.js"
import { createAgentSessionFactory } from "../src/llm/agent.js"
import {
  agreement,
  buildReplayCase,
  citationVerificationRate,
  createReplayRegistry,
  hasEnoughReplayText,
  outcomeSchema,
  parsePrecedentDetail,
  type LabelledPrediction,
} from "../src/replay.js"
import { runAnalysis } from "../src/runner.js"
import { loadSettings } from "../src/settings.js"
import { createAnalysisStore } from "../src/store.js"
import type { Verdict, VerdictStatus } from "../src/types.js"

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`

async function main(): Promise<void> {
  const settings = loadSettings()
  if (settings.agentMode !== "llm") {
    throw new Error("scripts/eval.ts needs AGENT_MODE=llm (it measures the real agent)")
  }
  const client = createBackendClient(settings.backendUrl)

  const rows = (await client.getEvalAwards()) as Record<string, string>[]
  if (rows.length === 0) {
    console.log("No labelled awards in data/eval/awards.csv yet, so there is nothing to measure.")
    console.log("A person must read each candidate award (data/eval/candidates.csv) and fill awards.csv first.")
    return
  }

  const replays = createReplayRegistry()
  const createSession = createAgentSessionFactory(settings, client, undefined, (caseId) => replays.get(caseId))
  const predictions: LabelledPrediction[] = []
  const allVerdicts: Verdict[] = []
  const skipped: string[] = []

  for (const row of rows) {
    const precedentId = row.precedent_id ?? ""
    const label = outcomeSchema.safeParse(row.outcome)
    if (!label.success) {
      skipped.push(`${precedentId}: skipped: outcome "${row.outcome ?? ""}" is not allowed | partly | dismissed`)
      continue
    }

    const replayCase = buildReplayCase(parsePrecedentDetail(await client.getPrecedent(precedentId)))
    if (!hasEnoughReplayText(replayCase.settlement.letter_text)) {
      skipped.push(`${precedentId}: skipped: too little text after redaction`)
      continue
    }
    replays.register(replayCase)

    const store = createAnalysisStore()
    const analysis = store.createAnalysis(replayCase.case_id)
    await runAnalysis({ store, analysisId: analysis.analysis_id, sampleCase: replayCase, createSession })
    const finished = store.getAnalysis(analysis.analysis_id)
    if (finished === undefined || finished.status !== "done") {
      skipped.push(`${precedentId}: skipped: the agent run ended in an error`)
      continue
    }

    const predicted: VerdictStatus = finished.verdicts.find((v) => v.deduction_id === "D1")?.status ?? "needs_info"
    predictions.push({ label: label.data, predicted })
    allVerdicts.push(...finished.verdicts)
    console.log(`${precedentId}: label ${label.data}, agent ${predicted}`)
  }

  const result = agreement(predictions)
  const citations = citationVerificationRate(allVerdicts)
  console.log("")
  console.log("Agreement on historical (pre-2024) Ombudsman awards, not current accuracy")
  console.log(`  replayed: ${result.total} of ${rows.length} labelled awards`)
  console.log(`  agreement: ${result.correct}/${result.total} = ${percent(result.accuracy)}`)
  console.log(`  majority-class baseline: ${percent(result.majorityBaseline)}`)
  for (const [label, count] of Object.entries(result.perLabel)) {
    console.log(`  ${label}: ${count.correct}/${count.total} matched`)
  }
  console.log(`  citation verification: ${citations.verified}/${citations.total} = ${percent(citations.rate)}`)
  for (const line of skipped) console.log(`  ${line}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
