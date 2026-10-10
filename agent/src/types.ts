import { z } from "zod"

/**
 * Zod schemas for the shared data model. Field names mirror the "Data model"
 * section of memory-bank/systemPatterns.md exactly (snake_case on the wire).
 */

export const verdictStatusSchema = z.enum(["valid", "contestable", "needs_info"])
export const flagKindSchema = z.enum([
  "tat_breach",
  "letter_not_specific",
  "regulation_override",
])

export const citationSchema = z.object({
  source_type: z.enum(["policy", "rule"]),
  source_id: z.string(),
  quote: z.string(),
  verified: z.boolean(),
})

export const calculationSchema = z
  .object({
    calculator: z.string(),
    inputs: z.record(z.string(), z.unknown()),
    result: z.record(z.string(), z.unknown()),
  })
  .passthrough()

export const regulationOverrideSchema = z.object({
  policy_says: z.string(),
  law_says: z.string(),
  rule_id: z.string(),
})

export const verdictSchema = z.object({
  deduction_id: z.string(),
  status: verdictStatusSchema,
  recoverable_amount: z.number(),
  reasoning: z.string(),
  citations: z.array(citationSchema),
  calculation: calculationSchema.optional(),
  confidence: z.number().min(0).max(1),
  regulation_override: regulationOverrideSchema.optional(),
  /** Set by the citation gate: false for contestable verdicts below the 0.75 confidence threshold. */
  include_in_grievance: z.boolean().optional(),
})

export const flagSchema = z.object({
  kind: flagKindSchema,
  rule_id: z.string(),
  detail: z.string(),
})

export const analysisStatusSchema = z.enum(["running", "done", "error"])

export const analysisSchema = z.object({
  analysis_id: z.string(),
  case_id: z.string(),
  status: analysisStatusSchema,
  verdicts: z.array(verdictSchema),
  total_recoverable: z.number(),
  flags: z.array(flagSchema),
  started_at: z.string(),
  finished_at: z.string().nullable(),
})

export const agentEventTypeSchema = z.enum([
  "step",
  "tool_call",
  "tool_result",
  "verdict",
  "done",
  "error",
])

export const agentEventSchema = z.object({
  seq: z.number().int().positive(),
  type: agentEventTypeSchema,
  message: z.string(),
  data: z.unknown().optional(),
  at: z.string(),
})

/** Shape accepted by POST /analyses on the agent service. */
export const createAnalysisRequestSchema = z.object({ case_id: z.string().min(1) })

/* ---- Case file (data/cases/*.json); only the fields the agent needs. ---- */

const billLineCategorySchema = z.enum([
  "room",
  "nursing",
  "professional_fee",
  "ot",
  "procedure",
  "pharmacy",
  "consumables",
  "implant",
  "diagnostics",
  "non_medical",
])

export const billLineSchema = z.object({
  line_id: z.string(),
  date: z.string(),
  particulars: z.string(),
  category: billLineCategorySchema,
  rate: z.number(),
  units: z.number(),
  amount: z.number(),
})

export const deductionSchema = z.object({
  deduction_id: z.string(),
  label: z.string(),
  amount: z.number(),
  line_ids: z.array(z.string()),
  insurer_reason: z.string(),
})

/** ExpectedVerdict from the data model, plus the explanatory `note` the cases carry. */
export const expectedVerdictSchema = z.object({
  deduction_id: z.string(),
  status: verdictStatusSchema,
  recoverable: z.number(),
  basis: z.array(z.string()),
  note: z.string().optional(),
})

export const tatEventSchema = z.object({
  event: z.enum([
    "cashless_request",
    "cashless_decision",
    "discharge_request",
    "final_authorisation",
  ]),
  at: z.string(),
})

/** Policy, patient and admission details used by the grievance letters (TASK-09). */
export const policyRefSchema = z.object({
  doc_id: z.string(),
  product: z.string(),
  uin: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  schedule: z
    .object({
      sum_insured: z.number().optional(),
      inception_date: z.string().optional(),
    })
    .passthrough()
    .optional(),
})

export const patientSchema = z.object({ name: z.string(), age: z.number().optional() })

export const admissionSchema = z.object({
  hospital: z.string(),
  admitted: z.string(),
  discharged: z.string(),
  diagnosis: z.string().optional(),
  room_category: z.string().optional(),
  cashless: z.boolean().optional(),
})

export const caseSchema = z.object({
  case_id: z.string(),
  title: z.string(),
  policy: policyRefSchema,
  patient: patientSchema,
  admission: admissionSchema,
  settlement: z.object({
    claimed: z.number(),
    approved: z.number(),
    total_deducted: z.number(),
    deductions: z.array(deductionSchema),
    letter_text: z.string(),
  }),
  expected: z.array(expectedVerdictSchema),
  timeline: z.array(tatEventSchema).default([]),
})

export type VerdictStatus = z.infer<typeof verdictStatusSchema>
export type FlagKind = z.infer<typeof flagKindSchema>
export type Citation = z.infer<typeof citationSchema>
export type Verdict = z.infer<typeof verdictSchema>
export type Flag = z.infer<typeof flagSchema>
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>
export type Analysis = z.infer<typeof analysisSchema>
export type AgentEventType = z.infer<typeof agentEventTypeSchema>
export type AgentEvent = z.infer<typeof agentEventSchema>
export type CreateAnalysisRequest = z.infer<typeof createAnalysisRequestSchema>
export type ExpectedVerdict = z.infer<typeof expectedVerdictSchema>
export type Case = z.infer<typeof caseSchema>
