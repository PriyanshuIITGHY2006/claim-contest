import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import { DemoUserMenu } from "@/components/DemoUser"

const LINKS = [
  { href: "/#cases", label: "Cases" },
  { href: "/#how", label: "How it works" },
]

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="font-heading text-base font-bold tracking-tight text-slate-900">
            Claim Contest
          </span>
        </Link>
        <nav aria-label="Main" className="ml-auto flex items-center gap-1 text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              prefetch={false}
              className="rounded-md px-3 py-1.5 font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-teal-800"
            >
              {link.label}
            </Link>
          ))}
          <DemoUserMenu />
        </nav>
      </div>
    </header>
  )
}
