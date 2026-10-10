import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import DashboardPage from "@/app/dashboard/page"
import WelcomePage from "@/app/welcome/page"
import { AppHeader } from "@/components/AppHeader"
import { DEMO_USER_KEY, DemoGreeting, initialsOf } from "@/components/DemoUser"

const api = vi.hoisted(() => ({
  listCases: vi.fn(),
  getCase: vi.fn(),
  listAnalyses: vi.fn(),
}))

const router = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return { ...actual, ...api }
})

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}))

/**
 * An in-memory Storage. Newer Node versions define a `localStorage` global that is undefined
 * unless started with --localstorage-file, which hides jsdom's own, so the tests bring their own.
 */
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("localStorage", memoryStorage())
  api.listCases.mockResolvedValue([])
  api.listAnalyses.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("welcome page", () => {
  it("pre-fills Priya, saves the name and continues to the dashboard", () => {
    render(<WelcomePage />)

    expect(screen.getByText("Welcome to Claim Contest")).toBeTruthy()
    expect(
      screen.getByText("Demo mode — no account is created and nothing leaves this browser."),
    ).toBeTruthy()
    const field = screen.getByLabelText("Your name") as HTMLInputElement
    expect(field.value).toBe("Priya")

    fireEvent.change(field, { target: { value: "  Ravi  " } })
    fireEvent.click(screen.getByRole("button", { name: "Continue as demo user" }))

    expect(window.localStorage.getItem(DEMO_USER_KEY)).toBe("Ravi")
    expect(router.push).toHaveBeenCalledWith("/dashboard")
  })

  it("does not continue with an empty name", () => {
    render(<WelcomePage />)

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "   " } })
    fireEvent.click(screen.getByRole("button", { name: "Continue as demo user" }))

    expect(window.localStorage.getItem(DEMO_USER_KEY)).toBeNull()
    expect(router.push).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toMatch(/enter a name/i)
  })
})

describe("dashboard greeting", () => {
  it("greets the saved demo user by name", async () => {
    window.localStorage.setItem(DEMO_USER_KEY, "Ravi")
    render(await DashboardPage())

    expect(await screen.findByText("Hi, Ravi")).toBeTruthy()
  })

  it("still works, and says Hi there, when no demo user is set", async () => {
    render(await DashboardPage())

    expect(screen.getByText("Hi there")).toBeTruthy()
    expect(screen.getByRole("link", { name: /check a new claim/i })).toBeTruthy()
  })

  it("greets with the saved name after the first render", () => {
    window.localStorage.setItem(DEMO_USER_KEY, "Asha")
    render(<DemoGreeting />)

    expect(screen.getByText("Hi, Asha")).toBeTruthy()
  })
})

describe("header demo user", () => {
  it("offers a Demo sign-in link to /welcome when no demo user is set", () => {
    render(<AppHeader />)

    expect(screen.getByRole("link", { name: "Demo sign-in" }).getAttribute("href")).toBe("/welcome")
    expect(screen.queryByRole("link", { name: "My claims" })).toBeNull()
  })

  it("shows initials, My claims and Switch user once a demo user is set", () => {
    window.localStorage.setItem(DEMO_USER_KEY, "Priya Sharma")
    render(<AppHeader />)

    expect(screen.getByText("PS")).toBeTruthy()
    expect(screen.getByRole("link", { name: "My claims" }).getAttribute("href")).toBe("/dashboard")
    expect(screen.queryByRole("link", { name: "Demo sign-in" })).toBeNull()
  })

  it("clears cc_demo_user on Switch user and goes back to the welcome page", () => {
    window.localStorage.setItem(DEMO_USER_KEY, "Priya")
    render(<AppHeader />)

    fireEvent.click(screen.getByRole("button", { name: "Switch user" }))

    expect(window.localStorage.getItem(DEMO_USER_KEY)).toBeNull()
    expect(router.push).toHaveBeenCalledWith("/welcome")
    expect(screen.getByRole("link", { name: "Demo sign-in" })).toBeTruthy()
  })

  it("follows a user who signs in on another tab", () => {
    render(<AppHeader />)
    expect(screen.getByRole("link", { name: "Demo sign-in" })).toBeTruthy()

    act(() => {
      window.localStorage.setItem(DEMO_USER_KEY, "Meera")
      window.dispatchEvent(new StorageEvent("storage", { key: DEMO_USER_KEY, newValue: "Meera" }))
    })

    expect(screen.getByText("M")).toBeTruthy()
  })
})

describe("initialsOf", () => {
  it("takes the first letters of up to two words, uppercased", () => {
    expect(initialsOf("priya sharma")).toBe("PS")
    expect(initialsOf("Ravi")).toBe("R")
    expect(initialsOf("  anna  maria  lopez ")).toBe("AM")
    expect(initialsOf("")).toBe("?")
  })
})
