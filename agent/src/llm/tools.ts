import { createTool } from "@cline/sdk"
import { z } from "zod"
import type { BackendClient } from "../backend.js"
import { billLineSchema } from "../types.js"

/** Every agent tool, in the order they are registered (systemPatterns -> Agent tools). */
export const ALL_TOOL_NAMES = [
  "get_case",
  "search_policy",
  "search_rules",
  "get_rule",
  "verify_quote",
  "calc_proportionate",
  "calc_waiting_period",
  "calc_tat",
  "calc_deadlines",
  "find_precedents",
  "classify_npi",
  "check_bill",
] as const

export type ToolName = (typeof ALL_TOOL_NAMES)[number]

// Tools whose backend endpoint is not merged yet. Empty since TASK-13 added
// `/classify/npi` and `/calc/bill-check`.
const PENDING_BACKEND: ReadonlySet<ToolName> = new Set<ToolName>()

export const AVAILABLE_TOOL_NAMES: readonly ToolName[] = ALL_TOOL_NAMES.filter(
  (name) => !PENDING_BACKEND.has(name),
)

const AMOUNTS_RULE =
  "Never state a rupee amount or date yourself: every amount in a verdict must come from a calc_* tool result."

const isoDate = z.iso.date().describe("ISO date, YYYY-MM-DD")
const isoDateTime = z.iso
  .datetime({ local: true, offset: true })
  .describe("ISO date-time; give both values a time zone or neither")
const topK = (max: number) => z.number().int().min(1).max(max).optional()
const lines = z.array(billLineSchema).min(1).describe("Bill lines exactly as returned by get_case")

const schemas = {
  get_case: z.object({ case_id: z.string().min(1).describe("Case id, e.g. case_a") }),
  search_policy: z.object({
    doc_id: z.string().min(1).describe("Policy document id from the case, e.g. star_fho_v19"),
    query: z.string().min(1),
    k: topK(50),
  }),
  search_rules: z.object({ query: z.string().min(1), k: topK(27) }),
  get_rule: z.object({ rule_id: z.string().min(1).describe("Rule id, e.g. MC24-13") }),
  verify_quote: z.object({
    source_type: z.enum(["policy", "rule"]),
    source_id: z.string().min(1).describe("Rule id for rules, document id for policy text"),
    quote: z.string().min(1).describe("The exact words you intend to cite"),
  }),
  calc_proportionate: z.object({
    eligible_room_rent: z.number().nonnegative(),
    actual_room_rent: z.number().positive(),
    days: z.number().int().positive(),
    lines,
    exempt_categories: z.array(z.string()).optional(),
    deduction: z
      .object({ amount: z.number().nonnegative(), line_ids: z.array(z.string()).min(1) })
      .optional()
      .describe("The insurer's deduction (amount and bill line ids) being checked"),
  }),
  calc_waiting_period: z.object({
    inception_date: isoDate,
    event_date: isoDate,
    policy_months: z.number().int().positive(),
    regulation_months: z.number().int().positive().optional(),
  }),
  calc_tat: z.object({
    requested_at: isoDateTime,
    decided_at: isoDateTime,
    limit_minutes: z.number().int().positive(),
  }),
  calc_deadlines: z.object({ decision_date: isoDate, grievance_sent_on: isoDate.optional() }),
  find_precedents: z.object({ query: z.string().min(1), k: topK(20) }),
  classify_npi: z.object({ doc_id: z.string().min(1), lines }),
  check_bill: z.object({ lines, printed_total: z.number().nonnegative().optional() }),
} satisfies Record<ToolName, z.ZodType>

type Input<N extends ToolName> = z.infer<(typeof schemas)[N]>

const descriptions: Record<ToolName, string> = {
  get_case:
    "Load the full case: policy schedule, admission, itemised bill lines, settlement deductions, letter text and TAT timeline. Call this first.",
  search_policy:
    "Search the policy wording for clauses (room-rent limit, associated medical expenses, waiting periods, exclusions). Returns clauses with page numbers; quote only text you find here.",
  search_rules:
    "Search the IRDAI / Ombudsman rule base for rules relevant to a deduction ground. Only cite rules with verified: true.",
  get_rule: "Fetch one rule by id with its full verbatim text, page and overrides_policy flag.",
  verify_quote:
    "Check that a quote really appears in the cited rule or policy document. Every citation must pass this before you submit it.",
  calc_proportionate: `Compute a proportionate (room-rent) deduction. Pass the insurer's deduction as \`deduction\` and use the returned \`recoverable_amount\`. Only for proportionate room-rent cuts, not for non-payable items. ${AMOUNTS_RULE}`,
  calc_waiting_period: `Whole months of cover from inception to the event, and whether the waiting period or moratorium has elapsed; pass regulation_months when a regulation caps the policy period. ${AMOUNTS_RULE}`,
  calc_tat: `Minutes between a request and the insurer's decision versus a limit (cashless 60, discharge 180); reports breach and minutes over. ${AMOUNTS_RULE}`,
  calc_deadlines: `Escalation dates from the decision date: insurer grievance (14 days) and Ombudsman window (one year), each with its rule id. ${AMOUNTS_RULE}`,
  find_precedents:
    "Find similar Insurance Ombudsman awards for a deduction ground; use them as supporting context.",
  classify_npi:
    "Classify bill lines against the policy's own non-payable item lists (subsumed into room, procedure or treatment costs).",
  check_bill: `Check bill arithmetic (rate x units, printed total, duplicates). An empty list means the bill is consistent. ${AMOUNTS_RULE}`,
}

/**
 * The sample cases carry their answer key in `expected` (used by tests and the
 * evaluation harness). The agent must never see it, or every verdict is copied.
 */
export function withoutAnswerKey(caseData: unknown): unknown {
  if (caseData === null || typeof caseData !== "object" || Array.isArray(caseData)) return caseData
  const { expected: _answerKey, ...visible } = caseData as Record<string, unknown>
  return visible
}

function parseInput<N extends ToolName>(name: N, input: unknown): Input<N> {
  const parsed = schemas[name].safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(input)"}: ${issue.message}`)
      .join("; ")
    throw new Error(`Invalid input for ${name}: ${issues}`)
  }
  return parsed.data as Input<N>
}

function defineTool<N extends ToolName>(name: N, call: (input: Input<N>) => Promise<unknown>) {
  return createTool({
    name,
    description: descriptions[name],
    inputSchema: schemas[name],
    // createTool's execute receives the raw model input unvalidated (checked
    // against v0.0.92), so validate here before any backend call.
    async execute(input: unknown) {
      return call(parseInput(name, input))
    },
  })
}

export type AgentTool = ReturnType<typeof defineTool>

/** Serves a case that exists only in memory (an Ombudsman replay); `undefined` means ask the backend. */
export type CaseOverride = (caseId: string) => unknown

/** True for an award the agent must not see: the one being replayed, whose result would give the answer away. */
export type HiddenPrecedent = (precedentId: string) => boolean

/** Builds all twelve tools around one backend client (BACKEND_URL from settings). */
export function createTools(
  client: BackendClient,
  caseOverride: CaseOverride = () => undefined,
  isHiddenPrecedent: HiddenPrecedent = () => false,
): {
  ALL_TOOLS: AgentTool[]
  AVAILABLE_TOOLS: AgentTool[]
} {
  const byName: Record<ToolName, AgentTool> = {
    get_case: defineTool("get_case", async (input) =>
      withoutAnswerKey(caseOverride(input.case_id) ?? (await client.getCase(input.case_id))),
    ),
    search_policy: defineTool("search_policy", (input) => client.searchPolicy(input)),
    search_rules: defineTool("search_rules", (input) => client.searchRules(input)),
    get_rule: defineTool("get_rule", (input) => client.getRule(input.rule_id)),
    verify_quote: defineTool("verify_quote", (input) => client.verifyQuote(input)),
    calc_proportionate: defineTool("calc_proportionate", (input) => client.calcProportionate(input)),
    calc_waiting_period: defineTool("calc_waiting_period", (input) => client.calcWaitingPeriod(input)),
    calc_tat: defineTool("calc_tat", (input) => client.calcTat(input)),
    calc_deadlines: defineTool("calc_deadlines", (input) => client.calcDeadlines(input)),
    find_precedents: defineTool("find_precedents", async (input) => {
      const results = await client.findPrecedents(input)
      return Array.isArray(results)
        ? results.filter((result) => !isHiddenPrecedent(String((result as { precedent_id?: unknown }).precedent_id)))
        : results
    }),
    classify_npi: defineTool("classify_npi", (input) => client.classifyNpi(input)),
    check_bill: defineTool("check_bill", (input) => client.checkBill(input)),
  }
  return {
    ALL_TOOLS: ALL_TOOL_NAMES.map((name) => byName[name]),
    AVAILABLE_TOOLS: AVAILABLE_TOOL_NAMES.map((name) => byName[name]),
  }
}
