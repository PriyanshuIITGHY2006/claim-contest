"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState, type FormEvent } from "react"
import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

/** localStorage key holding the demo user's name. There is no account: the name never leaves the browser. */
export const DEMO_USER_KEY = "cc_demo_user"

const DEFAULT_NAME = "Priya"

/** Up to two initials, uppercased; "?" for an empty name. */
export function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]!.toUpperCase())
  return letters.length > 0 ? letters.join("") : "?"
}

function readName(): string | null {
  try {
    const stored = window.localStorage.getItem(DEMO_USER_KEY)?.trim()
    return stored ? stored : null
  } catch {
    // Storage can be blocked (private mode, policy); the app then behaves as signed out.
    return null
  }
}

/**
 * The saved demo name, or null when none is set. It is read after mount because the server
 * cannot see localStorage, and it follows a sign-in or sign-out made in another tab.
 */
export function useDemoUser(): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    setName(readName())
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === DEMO_USER_KEY) setName(readName())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])
  return name
}

export function DemoGreeting() {
  const name = useDemoUser()
  return <>{name ? `Hi, ${name}` : "Hi there"}</>
}

/** Header part: a sign-in link, or the avatar with My claims and Switch user. */
export function DemoUserMenu() {
  const router = useRouter()
  const name = useDemoUser()
  // useDemoUser keeps its own copy, so clearing storage alone would not re-render this menu.
  const [cleared, setCleared] = useState(false)
  const current = cleared ? null : name

  function switchUser() {
    try {
      window.localStorage.removeItem(DEMO_USER_KEY)
    } catch {
      // Nothing stored that could be removed; still leave the signed-in view.
    }
    setCleared(true)
    router.push("/welcome")
  }

  if (!current) {
    return (
      <Link
        href="/welcome"
        prefetch={false}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-teal-800"
      >
        Demo sign-in
      </Link>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <Link
        href="/dashboard"
        prefetch={false}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-teal-800"
      >
        My claims
      </Link>
      <span
        title={current}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white"
      >
        {initialsOf(current)}
      </span>
      <button
        type="button"
        onClick={switchUser}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        Switch user
      </button>
    </div>
  )
}

/** The /welcome card: a name field and a button that saves the name and opens the dashboard. */
export function WelcomeCard() {
  const router = useRouter()
  const [name, setName] = useState(DEFAULT_NAME)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Please enter a name to continue.")
      return
    }
    try {
      window.localStorage.setItem(DEMO_USER_KEY, trimmed)
    } catch {
      setError("This browser blocked saving the name, so the demo user cannot be set.")
      return
    }
    router.push("/dashboard")
  }

  return (
    <Card className="mx-auto w-full max-w-md rounded-2xl border-slate-200 shadow-sm">
      <CardContent className="space-y-5 p-6">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-900">
            Welcome to Claim Contest
          </h1>
          <p className="text-sm text-slate-600">
            Pick a name to see your claims in one place. You can switch at any time.
          </p>
        </div>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="demo-name" className="text-sm font-medium text-slate-900">
              Your name
            </label>
            <input
              id="demo-name"
              type="text"
              autoComplete="off"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-rose-700">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full bg-brand hover:bg-brand-hover">
            Continue as demo user
          </Button>
        </form>
        <p className="text-xs text-slate-500">
          Demo mode — no account is created and nothing leaves this browser.
        </p>
      </CardContent>
    </Card>
  )
}
