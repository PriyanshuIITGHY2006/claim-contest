import type { DeadlineStep } from "@/lib/api"

/**
 * Calendar export for the escalation deadlines (RFC 5545, all-day events).
 *
 * Without the date the grievance was sent, only the Ombudsman's one-year limit
 * (decision date + 1 year, OMB17-14-3b) is a real date: the insurer's 14 days
 * and the one-month wait run from the grievance. So that case yields one event;
 * with the grievance date every step is dated.
 */

export interface DeadlineEvent {
  /** ISO date, YYYY-MM-DD. */
  date: string
  summary: string
  description: string
  ruleId: string
}

const stepFor = (steps: readonly DeadlineStep[], stage: string) => steps.find((step) => step.stage === stage)

export function deadlineEvents(steps: readonly DeadlineStep[], grievanceSent: boolean): DeadlineEvent[] {
  const insurer = stepFor(steps, "insurer_grievance")
  const ombudsman = stepFor(steps, "ombudsman")
  const events: DeadlineEvent[] = []
  if (grievanceSent && insurer) {
    events.push({
      date: insurer.latest,
      summary: "Insurer must reply to your grievance",
      description: "The insurer must resolve the grievance within 14 days of receiving it, citing specific policy terms.",
      ruleId: insurer.rule_id,
    })
  }
  if (grievanceSent && ombudsman) {
    events.push({
      date: ombudsman.earliest,
      summary: "You may complain to the Insurance Ombudsman",
      description:
        "One month after you sent the grievance without a reply you may complain to the Ombudsman (earlier if the insurer rejects it). Free of charge.",
      ruleId: "OMB17-14-3a",
    })
  }
  if (ombudsman) {
    events.push({
      date: ombudsman.latest,
      summary: "Last day to complain to the Insurance Ombudsman",
      description: "The Ombudsman complaint must be made within one year. Free of charge, claims up to Rs 50 lakh.",
      ruleId: ombudsman.rule_id,
    })
  }
  return events
}

/** RFC 5545 TEXT escaping. */
function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")
}

/** Long lines are folded at 75 octets (approximated by characters) with CRLF + space. */
function fold(line: string): string {
  if (line.length <= 75) return line
  const parts = [line.slice(0, 75)]
  for (let index = 75; index < line.length; index += 74) parts.push(` ${line.slice(index, index + 74)}`)
  return parts.join("\r\n")
}

const basicDate = (iso: string) => iso.slice(0, 10).replace(/-/g, "")

function nextDay(iso: string): string {
  const day = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + 1)
  return day.toISOString().slice(0, 10)
}

const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")

export interface IcsOptions {
  caseTitle: string
  /** Fixed in tests so the output is repeatable. */
  now?: Date
}

export function buildIcs(events: readonly DeadlineEvent[], options: IcsOptions): string {
  const dtstamp = stamp(options.now ?? new Date())
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Claim Contest//Escalation deadlines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ]
  events.forEach((event, index) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${basicDate(event.date)}-${index}-${event.ruleId}@claim-contest`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${basicDate(event.date)}`,
      `DTEND;VALUE=DATE:${basicDate(nextDay(event.date))}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `DESCRIPTION:${escapeText(`${options.caseTitle}: ${event.description} (${event.ruleId}). Self-help tool, not legal advice.`)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    )
  })
  lines.push("END:VCALENDAR")
  return `${lines.map(fold).join("\r\n")}\r\n`
}
