/**
 * Writes data/eval/candidates.csv: about 25 distinct Ombudsman awards to read and
 * label by hand. Backend only: no model call, no credits.
 *
 *   npx tsx --env-file-if-exists=../.env scripts/candidates.ts
 *
 * `keyword_outcome` is the backend's keyword guess and only a hint. A person
 * reads the end of each award and copies 10-15 rows into data/eval/awards.csv.
 * This script never writes awards.csv.
 */
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createBackendClient } from "../src/backend.js"
import { buildReplayCase, hasEnoughReplayText, parsePrecedentDetail, toCsv } from "../src/replay.js"
import { loadSettings } from "../src/settings.js"

const PER_GROUND = 5
const SEARCH_DEPTH = 20

/** Grounds that match the sample cases (room rent, pre-existing disease, waiting period, documents, cashless delay). */
const GROUNDS: ReadonlyArray<{ ground: string; query: string }> = [
  { ground: "room_rent", query: "proportionate deduction eligible room rent hospital charges" },
  { ground: "pre_existing", query: "non-disclosure pre-existing disease claim repudiated" },
  { ground: "waiting_period", query: "waiting period exclusion claim repudiated within the waiting period" },
  { ground: "documents", query: "claim repudiated documents not submitted despite reminders" },
  { ground: "cashless_delay", query: "cashless authorisation delayed discharge delay insurer TPA" },
]

const COLUMNS = ["precedent_id", "ground", "keyword_outcome", "excerpt"] as const

interface Hit {
  precedent_id?: unknown
  excerpt?: unknown
  outcome?: unknown
}

async function main(): Promise<void> {
  const settings = loadSettings()
  const client = createBackendClient(settings.backendUrl)
  const chosen = new Set<string>()
  const rows: Record<string, string>[] = []

  for (const { ground, query } of GROUNDS) {
    const hits = (await client.findPrecedents({ query, k: SEARCH_DEPTH })) as Hit[]
    let taken = 0
    for (const hit of hits) {
      if (taken >= PER_GROUND) break
      if (typeof hit.precedent_id !== "string" || chosen.has(hit.precedent_id)) continue
      // An award with almost nothing left after the decision is removed cannot be replayed, so it is not worth labelling.
      const precedent = parsePrecedentDetail(await client.getPrecedent(hit.precedent_id))
      if (!hasEnoughReplayText(buildReplayCase(precedent).settlement.letter_text)) continue
      chosen.add(hit.precedent_id)
      taken += 1
      rows.push({
        precedent_id: hit.precedent_id,
        ground,
        keyword_outcome: typeof hit.outcome === "string" ? hit.outcome : "",
        excerpt: typeof hit.excerpt === "string" ? hit.excerpt.replace(/\s+/g, " ").trim() : "",
      })
    }
    console.log(`${ground}: ${taken} candidate(s)`)
  }

  const file = path.join(settings.dataDir, "eval", "candidates.csv")
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, toCsv(COLUMNS, rows), "utf8")
  console.log(`Wrote ${rows.length} candidates to ${file}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
