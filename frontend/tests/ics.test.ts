import { describe, expect, it } from "vitest"
import { buildIcs, deadlineEvents } from "@/lib/ics"
import type { DeadlineStep } from "@/lib/api"

const STAMP = new Date("2026-10-10T08:00:00Z")

/** /calc/deadlines for case A: decision (discharge) 2026-08-07, no grievance date. */
const FROM_DECISION: DeadlineStep[] = [
  { stage: "insurer_grievance", earliest: "2026-08-07", latest: "2026-08-21", rule_id: "PPI24-B-VI-2-i", note: "" },
  { stage: "ombudsman", earliest: "2026-09-07", latest: "2027-08-07", rule_id: "OMB17-14-3b", note: "" },
]

/** The same with grievance_sent_on 2026-08-10. */
const FROM_GRIEVANCE: DeadlineStep[] = [
  { stage: "insurer_grievance", earliest: "2026-08-10", latest: "2026-08-24", rule_id: "PPI24-B-VI-2-i", note: "" },
  { stage: "ombudsman", earliest: "2026-09-10", latest: "2027-08-07", rule_id: "OMB17-14-3b", note: "" },
]

const vevents = (ics: string) => ics.split("BEGIN:VEVENT").length - 1
const dtstarts = (ics: string) => Array.from(ics.matchAll(/^DTSTART;VALUE=DATE:(\d{8})\r?$/gm), (m) => m[1])

describe("deadlineEvents", () => {
  it("without a grievance date, only the Ombudsman one-year limit is a real date", () => {
    expect(deadlineEvents(FROM_DECISION, false)).toEqual([
      expect.objectContaining({ date: "2027-08-07", ruleId: "OMB17-14-3b" }),
    ])
  })

  it("with a grievance date, every step is dated: insurer latest, Ombudsman earliest and latest", () => {
    const events = deadlineEvents(FROM_GRIEVANCE, true)
    expect(events.map((e) => e.date)).toEqual(["2026-08-24", "2026-09-10", "2027-08-07"])
    expect(events.map((e) => e.ruleId)).toEqual(["PPI24-B-VI-2-i", "OMB17-14-3a", "OMB17-14-3b"])
  })
})

describe("buildIcs", () => {
  it("acceptance 1: one VEVENT per dated step with the correct DTSTART dates", () => {
    const ics = buildIcs(deadlineEvents(FROM_GRIEVANCE, true), { caseTitle: "Case A", now: STAMP })
    expect(vevents(ics)).toBe(3)
    expect(dtstarts(ics)).toEqual(["20260824", "20260910", "20270807"])
    expect(ics).toMatch(/^DTEND;VALUE=DATE:20260825\r$/m)
  })

  it("no grievance date -> exactly one VEVENT, DTSTART 20270807 for case A", () => {
    const ics = buildIcs(deadlineEvents(FROM_DECISION, false), { caseTitle: "Case A", now: STAMP })
    expect(vevents(ics)).toBe(1)
    expect(dtstarts(ics)).toEqual(["20270807"])
    expect(ics).toContain("SUMMARY:Last day to complain to the Insurance Ombudsman")
  })

  it("is a valid calendar: CRLF lines, VCALENDAR wrapper, DTSTAMP, unique UIDs", () => {
    const ics = buildIcs(deadlineEvents(FROM_GRIEVANCE, true), { caseTitle: "Case A", now: STAMP })
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true)
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true)
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/\n/)
    expect(ics).toContain("DTSTAMP:20261010T080000Z")
    const uids = Array.from(ics.matchAll(/^UID:(.+)\r$/gm), (m) => m[1])
    expect(new Set(uids).size).toBe(3)
  })

  it("escapes commas, semicolons, backslashes and newlines in text", () => {
    const ics = buildIcs(deadlineEvents(FROM_DECISION, false), { caseTitle: "Room cut; pharmacy, stent\\tests\nx", now: STAMP })
    expect(ics).toContain("Room cut\\; pharmacy\\, stent\\\\tests\\nx")
  })

  it("an empty list gives a calendar with no events", () => {
    const ics = buildIcs([], { caseTitle: "Case A", now: STAMP })
    expect(vevents(ics)).toBe(0)
    expect(ics).toContain("END:VCALENDAR")
  })
})
