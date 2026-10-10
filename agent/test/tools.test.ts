import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BACKEND_TIMEOUT_MS, createBackendClient } from "../src/backend.js"
import { toolPolicies } from "../src/llm/policies.js"
import { ALL_TOOL_NAMES, AVAILABLE_TOOL_NAMES, createTools } from "../src/llm/tools.js"

const BASE_URL = "http://backend.test"

const LINE = {
  line_id: "L01",
  date: "2026-08-03",
  particulars: "Deluxe room rent",
  category: "room",
  rate: 8000,
  units: 4,
  amount: 32000,
} as const

interface ToolCase {
  name: string
  input: Record<string, unknown>
  method: "GET" | "POST"
  path: string
}

const TOOL_CASES: ToolCase[] = [
  { name: "get_case", input: { case_id: "case_a" }, method: "GET", path: "/cases/case_a" },
  {
    name: "search_policy",
    input: { doc_id: "star_fho_v19", query: "room rent limit", k: 3 },
    method: "POST",
    path: "/policy/search",
  },
  { name: "search_rules", input: { query: "moratorium", k: 5 }, method: "POST", path: "/rules/search" },
  { name: "get_rule", input: { rule_id: "MC24-13" }, method: "GET", path: "/rules/MC24-13" },
  {
    name: "verify_quote",
    input: { source_type: "rule", source_id: "MC24-13", quote: "60 months of continuous coverage" },
    method: "POST",
    path: "/verify-quote",
  },
  {
    name: "calc_proportionate",
    input: {
      eligible_room_rent: 5000,
      actual_room_rent: 8000,
      days: 4,
      lines: [LINE],
      exempt_categories: ["pharmacy"],
      deduction: { amount: 12000, line_ids: ["L01"] },
    },
    method: "POST",
    path: "/calc/proportionate",
  },
  {
    name: "calc_waiting_period",
    input: {
      inception_date: "2019-04-01",
      event_date: "2026-09-02",
      policy_months: 96,
      regulation_months: 60,
    },
    method: "POST",
    path: "/calc/waiting-period",
  },
  {
    name: "calc_tat",
    input: {
      requested_at: "2026-07-23T11:00:00",
      decided_at: "2026-07-23T16:30:00",
      limit_minutes: 180,
    },
    method: "POST",
    path: "/calc/tat",
  },
  {
    name: "calc_deadlines",
    input: { decision_date: "2026-08-07", grievance_sent_on: "2026-08-10" },
    method: "POST",
    path: "/calc/deadlines",
  },
  {
    name: "find_precedents",
    input: { query: "proportionate deduction pharmacy", k: 3 },
    method: "POST",
    path: "/precedents/search",
  },
  {
    name: "classify_npi",
    input: { doc_id: "star_fho_v19", lines: [LINE] },
    method: "POST",
    path: "/classify/npi",
  },
  {
    name: "check_bill",
    input: { lines: [LINE], printed_total: 32000 },
    method: "POST",
    path: "/calc/bill-check",
  },
]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function tools() {
  return createTools(createBackendClient(BASE_URL))
}

function toolNamed(name: string) {
  const tool = tools().ALL_TOOLS.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`tool ${name} not exported`)
  return tool
}

function lastRequest(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1)
  if (call === undefined) throw new Error("fetch was not called")
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit }
}

describe("acceptance 1: each tool sends the right method, path and body", () => {
  it("covers every exported tool", () => {
    expect(TOOL_CASES.map((toolCase) => toolCase.name).sort()).toEqual([...ALL_TOOL_NAMES].sort())
  })

  it.each(TOOL_CASES)("$name -> $method $path", async ({ name, input, method, path }) => {
    const result = await toolNamed(name).execute(input, {} as never)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init } = lastRequest()
    expect(url).toBe(`${BASE_URL}${path}`)
    expect(init.method).toBe(method)
    if (method === "GET") {
      expect(init.body).toBeUndefined()
    } else {
      expect(JSON.parse(String(init.body))).toEqual(input)
      expect(new Headers(init.headers).get("content-type")).toBe("application/json")
    }
    expect(result).toEqual({ ok: true })
  })

  it("URL-encodes path parameters", async () => {
    await toolNamed("get_rule").execute({ rule_id: "a/b c" }, {} as never)
    expect(lastRequest().url).toBe(`${BASE_URL}/rules/a%2Fb%20c`)
  })

  it("tolerates a trailing slash on the base URL", async () => {
    const tool = createTools(createBackendClient(`${BASE_URL}/`)).ALL_TOOLS.find(
      (candidate) => candidate.name === "get_case",
    )
    await tool?.execute({ case_id: "case_a" }, {} as never)
    expect(lastRequest().url).toBe(`${BASE_URL}/cases/case_a`)
  })
})

describe("acceptance 2: tool policies", () => {
  it("has an explicit autoApprove policy for every exported tool and nothing else", () => {
    expect(Object.keys(toolPolicies).sort()).toEqual([...ALL_TOOL_NAMES].sort())
    for (const name of ALL_TOOL_NAMES) {
      expect(toolPolicies[name]).toEqual({ autoApprove: true })
    }
  })
})

describe("acceptance 3: invalid input fails validation before any fetch", () => {
  it("rejects verify_quote without a quote", async () => {
    await expect(
      toolNamed("verify_quote").execute({ source_type: "rule", source_id: "MC24-13" }, {} as never),
    ).rejects.toThrow(/verify_quote[\s\S]*quote/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects calc_tat without limit_minutes", async () => {
    await expect(
      toolNamed("calc_tat").execute(
        { requested_at: "2026-07-23T11:00:00", decided_at: "2026-07-23T16:30:00" },
        {} as never,
      ),
    ).rejects.toThrow(/limit_minutes/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a malformed date in calc_deadlines", async () => {
    await expect(
      toolNamed("calc_deadlines").execute({ decision_date: "07/08/2026" }, {} as never),
    ).rejects.toThrow(/decision_date/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("acceptance 4: backend 500 surfaces with the path", () => {
  it("throws an error naming the method, path and status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }))
    await expect(
      toolNamed("search_rules").execute({ query: "moratorium" }, {} as never),
    ).rejects.toThrow(/POST \/rules\/search[\s\S]*500/)
  })
})

describe("acceptance 5: backend 422 surfaces the backend detail", () => {
  it("includes the FastAPI validation message so the agent can correct its input", async () => {
    const message = "Value error, requested_at and decided_at must both have a time zone or neither"
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: [{ type: "value_error", loc: ["body"], msg: message }] }, 422),
    )
    const run = toolNamed("calc_tat").execute(
      {
        requested_at: "2026-07-23T11:00:00+05:30",
        decided_at: "2026-07-23T16:30:00",
        limit_minutes: 180,
      },
      {} as never,
    )
    await expect(run).rejects.toThrow(/\/calc\/tat[\s\S]*422/)
    await expect(run).rejects.toThrow(message)
  })

  it("includes a string detail (e.g. 404 Rule not found)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Rule not found" }, 404))
    await expect(
      toolNamed("get_rule").execute({ rule_id: "nope" }, {} as never),
    ).rejects.toThrow(/GET \/rules\/nope[\s\S]*404[\s\S]*Rule not found/)
  })
})

describe("acceptance 6: tool lists", () => {
  it("ALL_TOOLS has all twelve tools", () => {
    expect(ALL_TOOL_NAMES).toHaveLength(12)
    expect(tools().ALL_TOOLS.map((tool) => tool.name)).toEqual([...ALL_TOOL_NAMES])
  })

  it("AVAILABLE_TOOLS includes classify_npi and check_bill now that TASK-13 is merged", () => {
    const available = tools().AVAILABLE_TOOLS.map((tool) => tool.name)
    expect(available).toEqual([...AVAILABLE_TOOL_NAMES])
    expect(available).toHaveLength(12)
    expect(available).toContain("classify_npi")
    expect(available).toContain("check_bill")
  })
})

describe("timeouts", () => {
  it("passes AbortSignal.timeout(30_000) to every fetch", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    await toolNamed("get_case").execute({ case_id: "case_a" }, {} as never)
    expect(BACKEND_TIMEOUT_MS).toBe(30_000)
    expect(timeoutSpy).toHaveBeenCalledWith(30_000)
    expect(lastRequest().init.signal).toBeInstanceOf(AbortSignal)
  })

  it("a timeout throws an error that includes method and path", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"))
    await expect(
      toolNamed("search_rules").execute({ query: "moratorium" }, {} as never),
    ).rejects.toThrow(/timed out[\s\S]*POST \/rules\/search/)
  })

  it("a network failure throws an error that includes method and path", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"))
    await expect(
      toolNamed("get_case").execute({ case_id: "case_a" }, {} as never),
    ).rejects.toThrow(/GET \/cases\/case_a[\s\S]*fetch failed/)
  })
})

describe("get_case hides the answer key from the agent", () => {
  it("removes the case's expected verdicts before returning it", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        case_id: "case_a",
        title: "Sample",
        settlement: { deductions: [{ deduction_id: "D3", amount: 40719.76 }] },
        expected: [{ deduction_id: "D3", status: "contestable", recoverable: 40719.76 }],
      }),
    )
    const result = (await toolNamed("get_case").execute({ case_id: "case_a" }, {} as never)) as Record<
      string,
      unknown
    >
    expect(result).not.toHaveProperty("expected")
    expect(result).toHaveProperty("settlement")
    expect(JSON.stringify(result)).not.toContain("contestable")
  })
})
