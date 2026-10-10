"use client"

import { useState, type ReactNode } from "react"
import { LoaderCircle, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { BillCategory, CaseDraft, NewCase } from "@/lib/api"
import { formatINR } from "@/lib/format"

const CATEGORIES: BillCategory[] = [
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
]

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const NUMBER_CLASS = `${INPUT_CLASS} text-right tabular-nums`
const ICON_BUTTON_CLASS =
  "rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

interface LineRow {
  line_id: string
  date: string
  particulars: string
  category: BillCategory
  rate: string
  units: string
  amount: string
}

interface DeductionRow {
  deduction_id: string
  label: string
  amount: string
  line_ids: string[]
  insurer_reason: string
}

interface Details {
  patientName: string
  patientAge: string
  hospital: string
  admitted: string
  discharged: string
  diagnosis: string
  sumInsured: string
  inception: string
  eligibleRent: string
  chargedRent: string
  claimed: string
  approved: string
}

const text = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(value))

/** A number typed into a field, or null when it is empty or not a number. */
function toNumber(value: string): number | null {
  if (value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const paise = (value: string): number => Math.round((toNumber(value) ?? 0) * 100)
const round2 = (value: number): number => Math.round(value * 100) / 100

function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function nextId(prefix: string, used: string[], pad: number): string {
  const highest = used.reduce((max, id) => Math.max(max, Number(id.slice(prefix.length)) || 0), 0)
  return `${prefix}${String(highest + 1).padStart(pad, "0")}`
}

function toLineRow(line: CaseDraft["bill_lines"][number]): LineRow {
  return {
    line_id: line.line_id,
    date: line.date,
    particulars: line.particulars,
    category: line.category,
    rate: text(line.rate),
    units: text(line.units),
    amount: text(line.amount),
  }
}

function toDeductionRow(deduction: CaseDraft["deductions"][number]): DeductionRow {
  return {
    deduction_id: deduction.deduction_id,
    label: deduction.label,
    amount: text(deduction.amount),
    line_ids: deduction.line_ids,
    insurer_reason: deduction.insurer_reason,
  }
}

/**
 * Editing the amount of a one-unit line moves its rate with it; editing rate or
 * units recomputes the amount. Rate x units therefore stays equal to the amount,
 * which the agent's bill check would otherwise report as a hospital error.
 */
function editMoney(row: LineRow, field: "rate" | "units" | "amount", value: string): LineRow {
  const next = { ...row, [field]: value }
  if (field === "amount") {
    return toNumber(next.units) === 1 ? { ...next, rate: value } : next
  }
  const rate = toNumber(next.rate)
  const units = toNumber(next.units)
  return rate !== null && units !== null ? { ...next, amount: String(round2(rate * units)) } : next
}

/** What keeps "Analyse my claim" disabled: the totals must be consistent. */
function totalsProblems(lines: LineRow[], deductions: DeductionRow[], claimed: string, approved: string): string[] {
  const out: string[] = []
  const billTotal = lines.reduce((sum, line) => sum + paise(line.amount), 0)
  if (billTotal <= 0) out.push("Add at least one bill line with an amount above zero")
  if (deductions.length === 0) out.push("Add at least one deduction")
  if (deductions.some((deduction) => paise(deduction.amount) <= 0)) {
    out.push("Every deduction needs an amount above zero")
  }
  if (billTotal > 0) {
    deductions.forEach((deduction, index) => {
      if (paise(deduction.amount) > billTotal) out.push(`Deduction ${index + 1} is larger than the bill total`)
    })
  }
  if (paise(approved) > paise(claimed)) out.push("The approved amount cannot be more than the claimed amount")
  return out
}

/** Details the backend needs that a PDF rarely gives; checked when the user submits. */
function missingDetails(details: Details, lines: LineRow[], deductions: DeductionRow[]): string[] {
  const out: string[] = []
  const required: [string, string][] = [
    ["Patient name", details.patientName],
    ["Hospital", details.hospital],
    ["Diagnosis", details.diagnosis],
    ["Admitted on", details.admitted],
    ["Discharged on", details.discharged],
    ["Policy start date", details.inception],
  ]
  for (const [label, value] of required) {
    if (value.trim() === "") out.push(`${label} is required`)
  }
  const age = toNumber(details.patientAge)
  if (age === null || age < 0 || !Number.isInteger(age)) out.push("Patient age must be a whole number")
  const sumInsured = toNumber(details.sumInsured)
  if (sumInsured === null || sumInsured <= 0) out.push("Sum insured must be above zero")
  if (details.admitted && details.discharged && details.discharged < details.admitted) {
    out.push("Discharged on cannot be before Admitted on")
  }
  if (details.inception && details.admitted && details.inception >= details.admitted) {
    out.push("Policy start date must be before Admitted on")
  }
  // Without its bill lines the calculators cannot price a deduction, and the agent cannot settle it.
  deductions.forEach((deduction, index) => {
    if (deduction.line_ids.length === 0) out.push(`Link deduction ${index + 1} to the bill lines it covers`)
  })
  if (toNumber(details.claimed) === null) out.push("Claimed amount is required")
  if (toNumber(details.approved) === null) out.push("Approved amount is required")
  lines.forEach((line, index) => {
    const number = index + 1
    if (line.particulars.trim() === "") out.push(`Line ${number} needs a description`)
    if (line.date === "") out.push(`Line ${number} needs a date`)
    const units = toNumber(line.units)
    const rate = toNumber(line.rate)
    if (units === null || units <= 0) out.push(`Line ${number} needs units above zero`)
    if (rate === null || rate < 0) out.push(`Line ${number} needs a rate`)
  })
  return out
}

function buildCase(
  docId: string,
  letterText: string,
  details: Details,
  lines: LineRow[],
  deductions: DeductionRow[],
): NewCase {
  const num = (value: string): number => toNumber(value) ?? 0
  const charged = toNumber(details.chargedRent)
  return {
    doc_id: docId,
    schedule: {
      sum_insured: num(details.sumInsured),
      inception_date: details.inception,
      eligible_room_rent_per_day: toNumber(details.eligibleRent),
    },
    patient: { name: details.patientName.trim(), age: num(details.patientAge) },
    admission: {
      hospital: details.hospital.trim(),
      admitted: `${details.admitted}T00:00:00`,
      discharged: `${details.discharged}T00:00:00`,
      diagnosis: details.diagnosis.trim(),
      room_category: charged === null ? "Not stated" : `Room (${formatINR(charged).replace("₹", "Rs ")}/day)`,
      cashless: false,
    },
    bill_lines: lines.map((line) => ({
      line_id: line.line_id,
      date: line.date,
      particulars: line.particulars.trim(),
      category: line.category,
      rate: num(line.rate),
      units: num(line.units),
      amount: num(line.amount),
    })),
    deductions: deductions.map((deduction, index) => {
      const label = deduction.label.trim() || `Deduction ${index + 1}`
      return {
        deduction_id: deduction.deduction_id,
        label,
        amount: num(deduction.amount),
        line_ids: deduction.line_ids,
        insurer_reason: deduction.insurer_reason.trim() || label,
      }
    }),
    claimed: num(details.claimed),
    approved: num(details.approved),
    letter_text: letterText,
  }
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      {children(id)}
    </div>
  )
}

function LinesTable({
  lines,
  onChange,
  onRemove,
  onAdd,
}: {
  lines: LineRow[]
  onChange: (index: number, row: LineRow) => void
  onRemove: (index: number) => void
  onAdd: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-14 px-1 pb-2 font-medium">Line</th>
              <th className="px-1 pb-2 font-medium">Date</th>
              <th className="px-1 pb-2 font-medium">Particulars</th>
              <th className="px-1 pb-2 font-medium">Category</th>
              <th className="px-1 pb-2 text-right font-medium">Rate</th>
              <th className="px-1 pb-2 text-right font-medium">Units</th>
              <th className="px-1 pb-2 text-right font-medium">Amount</th>
              <th className="w-10 px-1 pb-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const n = index + 1
              return (
                <tr key={line.line_id} className="align-top">
                  <td className="px-1 py-1 pt-2.5 text-xs tabular-nums text-slate-500">{line.line_id}</td>
                  <td className="px-1 py-1">
                    <input
                      type="date"
                      aria-label={`Line ${n} date`}
                      className={INPUT_CLASS}
                      value={line.date}
                      onChange={(event) => onChange(index, { ...line, date: event.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="text"
                      aria-label={`Line ${n} particulars`}
                      className={INPUT_CLASS}
                      value={line.particulars}
                      onChange={(event) => onChange(index, { ...line, particulars: event.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      aria-label={`Line ${n} category`}
                      className={INPUT_CLASS}
                      value={line.category}
                      onChange={(event) => onChange(index, { ...line, category: event.target.value as BillCategory })}
                    >
                      {CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </td>
                  {(["rate", "units", "amount"] as const).map((field) => (
                    <td key={field} className="px-1 py-1">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        aria-label={`Line ${n} ${field}`}
                        className={NUMBER_CLASS}
                        value={line[field]}
                        onChange={(event) => onChange(index, editMoney(line, field, event.target.value))}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      aria-label={`Remove line ${n}`}
                      className={ICON_BUTTON_CLASS}
                      onClick={() => onRemove(index)}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add bill line
      </Button>
    </div>
  )
}

function DeductionsTable({
  deductions,
  lines,
  onChange,
  onRemove,
  onAdd,
}: {
  deductions: DeductionRow[]
  lines: LineRow[]
  onChange: (index: number, row: DeductionRow) => void
  onRemove: (index: number) => void
  onAdd: () => void
}) {
  return (
    <div className="space-y-3">
      {deductions.map((deduction, index) => {
        const n = index + 1
        return (
          <div key={deduction.deduction_id} className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="flex items-start gap-2">
              <span className="w-8 pt-2.5 text-xs tabular-nums text-slate-500">{deduction.deduction_id}</span>
              <input
                type="text"
                aria-label={`Deduction ${n} label`}
                className={INPUT_CLASS}
                value={deduction.label}
                onChange={(event) => onChange(index, { ...deduction, label: event.target.value })}
              />
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                aria-label={`Deduction ${n} amount`}
                className={`${NUMBER_CLASS} max-w-[10rem]`}
                value={deduction.amount}
                onChange={(event) => onChange(index, { ...deduction, amount: event.target.value })}
              />
              <button
                type="button"
                aria-label={`Remove deduction ${n}`}
                className={ICON_BUTTON_CLASS}
                onClick={() => onRemove(index)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {lines.length > 0 && (
              <fieldset className="flex flex-wrap gap-x-4 gap-y-1 pl-10">
                <legend className="sr-only">Bill lines covered by deduction {n}</legend>
                {lines.map((line, lineIndex) => (
                  <label key={line.line_id} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      aria-label={`Link deduction ${n} to line ${lineIndex + 1}`}
                      checked={deduction.line_ids.includes(line.line_id)}
                      onChange={(event) =>
                        onChange(index, {
                          ...deduction,
                          line_ids: event.target.checked
                            ? [...deduction.line_ids, line.line_id]
                            : deduction.line_ids.filter((id) => id !== line.line_id),
                        })
                      }
                    />
                    <span>
                      {line.line_id} {line.particulars}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add deduction
      </Button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {children}
      </CardContent>
    </Card>
  )
}

export interface CaseConfirmFormProps {
  draft: CaseDraft
  submitting: boolean
  error: string | null
  onSubmit: (body: NewCase) => void
}

export function CaseConfirmForm({ draft, submitting, error, onSubmit }: CaseConfirmFormProps) {
  const [lines, setLines] = useState<LineRow[]>(() => draft.bill_lines.map(toLineRow))
  const [deductions, setDeductions] = useState<DeductionRow[]>(() => draft.deductions.map(toDeductionRow))
  const [details, setDetails] = useState<Details>({
    patientName: draft.patient_name ?? "",
    patientAge: "",
    hospital: draft.hospital ?? "",
    admitted: draft.admitted ?? "",
    discharged: draft.discharged ?? "",
    diagnosis: "",
    sumInsured: text(draft.sum_insured),
    inception: "",
    eligibleRent: "",
    chargedRent: text(draft.room_rent_per_day),
    claimed: text(draft.claimed),
    approved: text(draft.approved),
  })
  const [missing, setMissing] = useState<string[]>([])

  const set = (key: keyof Details) => (event: { target: { value: string } }) =>
    setDetails((current) => ({ ...current, [key]: event.target.value }))
  const billTotal = lines.reduce((sum, line) => sum + paise(line.amount), 0) / 100
  const deductedTotal = deductions.reduce((sum, deduction) => sum + paise(deduction.amount), 0) / 100
  const problems = totalsProblems(lines, deductions, details.claimed, details.approved)

  function removeLine(index: number) {
    const removed = lines[index].line_id
    setLines((current) => current.filter((_, i) => i !== index))
    setDeductions((current) =>
      current.map((deduction) => ({ ...deduction, line_ids: deduction.line_ids.filter((id) => id !== removed) })),
    )
  }

  function addLine() {
    setLines((current) => [
      ...current,
      {
        line_id: nextId("L", current.map((line) => line.line_id), 2),
        date: current.length > 0 ? current[current.length - 1].date : todayISO(),
        particulars: "",
        category: "non_medical",
        rate: "",
        units: "1",
        amount: "",
      },
    ])
  }

  function addDeduction() {
    setDeductions((current) => [
      ...current,
      {
        deduction_id: nextId("D", current.map((d) => d.deduction_id), 0),
        label: "",
        amount: "",
        line_ids: [],
        insurer_reason: "",
      },
    ])
  }

  function handleSubmit(event: { preventDefault: () => void }) {
    event.preventDefault()
    const issues = missingDetails(details, lines, deductions)
    setMissing(issues)
    if (issues.length === 0 && problems.length === 0) {
      onSubmit(buildCase(draft.doc_id, draft.letter_text, details, lines, deductions))
    }
  }

  const input = (label: string, key: keyof Details, type = "text") => (
    <Field label={label}>
      {(id) => <input id={id} type={type} className={INPUT_CLASS} value={details[key]} onChange={set(key)} />}
    </Field>
  )
  const money = (label: string, key: keyof Details) => (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          className={NUMBER_CLASS}
          value={details[key]}
          onChange={set(key)}
        />
      )}
    </Field>
  )

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {draft.warnings.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="space-y-1 p-4 text-sm text-amber-900">
            <p className="font-medium">Please check these before analysing</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {draft.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Section title="Patient and policy">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {input("Patient name", "patientName")}
          {input("Patient age", "patientAge", "number")}
          {input("Hospital", "hospital")}
          {input("Admitted on", "admitted", "date")}
          {input("Discharged on", "discharged", "date")}
          {input("Diagnosis", "diagnosis")}
          {money("Sum insured", "sumInsured")}
          {input("Policy start date", "inception", "date")}
          {money("Eligible room rent per day", "eligibleRent")}
          {money("Room rent charged per day", "chargedRent")}
          {money("Claimed amount", "claimed")}
          {money("Approved amount", "approved")}
        </div>
      </Section>

      <Section title="Bill lines">
        <LinesTable
          lines={lines}
          onChange={(index, row) => setLines((current) => current.map((line, i) => (i === index ? row : line)))}
          onRemove={removeLine}
          onAdd={addLine}
        />
        <p className="text-sm text-slate-600">
          Bill total:{" "}
          <span data-testid="bill-total" className="font-semibold tabular-nums text-slate-900">
            {formatINR(billTotal)}
          </span>
        </p>
      </Section>

      <Section title="Deductions in the settlement letter">
        <DeductionsTable
          deductions={deductions}
          lines={lines}
          onChange={(index, row) => setDeductions((current) => current.map((d, i) => (i === index ? row : d)))}
          onRemove={(index) => setDeductions((current) => current.filter((_, i) => i !== index))}
          onAdd={addDeduction}
        />
        <p className="text-sm text-slate-600">
          Total deducted:{" "}
          <span data-testid="deducted-total" className="font-semibold tabular-nums text-slate-900">
            {formatINR(deductedTotal)}
          </span>
        </p>
      </Section>

      {problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-600">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {(missing.length > 0 || error) && (
        <Card role="alert" className="border-rose-200 bg-rose-50">
          <CardContent className="space-y-1 p-4 text-sm text-rose-800">
            {error && <p>{error}</p>}
            {missing.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        <Button type="submit" size="lg" disabled={problems.length > 0 || submitting}>
          {submitting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Analyse my claim
        </Button>
        <p className="text-sm text-slate-500">Your documents are processed on this server and not shared.</p>
      </div>
    </form>
  )
}
