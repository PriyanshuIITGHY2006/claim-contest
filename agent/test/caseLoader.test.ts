import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createBackendClient } from "../src/backend.js"
import { createBackendCaseLoader } from "../src/scripted.js"
import { DEFAULT_DATA_DIR } from "../src/settings.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createBackendCaseLoader", () => {
  it("loads a case (sample or uploaded) from the backend's GET /cases/{id}", async () => {
    const caseA = JSON.parse(await readFile(path.join(DEFAULT_DATA_DIR, "cases", "case_a.json"), "utf8"))
    const fetchMock = vi.fn(async (_url: string | URL) => new Response(JSON.stringify({ ...caseA, case_id: "user_1a2b3c4d" })))
    vi.stubGlobal("fetch", fetchMock)

    const loaded = await createBackendCaseLoader(createBackendClient("http://backend.test"))("user_1a2b3c4d")

    expect(loaded.case_id).toBe("user_1a2b3c4d")
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://backend.test/cases/user_1a2b3c4d")
  })

  it("reports an unknown case id when the backend answers 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Case not found" }), { status: 404 })))

    await expect(createBackendCaseLoader(createBackendClient("http://backend.test"))("nope")).rejects.toThrow(
      /Unknown case_id: nope/,
    )
  })
})
