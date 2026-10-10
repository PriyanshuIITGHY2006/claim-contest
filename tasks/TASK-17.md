# TASK-17: UI polish — typography, medical theme, landing page, verdict board, timeline, app shell

## Goal
Make the frontend look like a finished health-finance product for the demo. Visual and layout changes only: no change to data contracts, API calls or business logic.

## Files to touch
- `frontend/app/layout.tsx` (modify: fonts, app shell header + footer)
- `frontend/app/globals.css`, `frontend/tailwind.config.ts` (modify: theme tokens, font families, tabular numbers)
- `frontend/app/page.tsx` (modify: landing page)
- `frontend/app/case/[id]/page.tsx` (modify: layout only, plus the redirect fix below)
- `frontend/app/case/[id]/loading.tsx`, `frontend/app/loading.tsx` (create: skeletons)
- `frontend/components/SummaryCard.tsx`, `VerdictBoard.tsx`, `EvidencePanel.tsx`, `LiveTimeline.tsx`, `StatusChip.tsx`, `PolicyXray.tsx`, `TatClocks.tsx` (modify: styling and markup only)
- `frontend/components/AppHeader.tsx`, `AppFooter.tsx`, `HowItWorks.tsx`, `RecoverableBar.tsx` (create)
- `frontend/tests/*.test.tsx` (modify only where markup changed; keep every existing assertion's intent)

## Design
1. **Typography:** headings in **Plus Jakarta Sans** (600/700), body in **Inter**, both via `next/font/google` (built into Next, no new package) as CSS variables. All rupee amounts and times use `tabular-nums`.
2. **Theme (Tailwind tokens):** primary deep teal `#0f766e` (hover `#115e59`), accent `#0ea5e9`, background `#f8fafc`, cards white with `shadow-sm` and `rounded-2xl`, borders `slate-200`. Status colours stay: valid emerald, contestable amber, needs info sky. Plenty of whitespace; max width `max-w-6xl`.
3. **Landing page (`/`):**
   - Hero: headline "Find out if your insurer cut too much — with the exact clause", one-line sub-text, a primary button "Try a sample case" that scrolls to the cards, and a small trust row ("IRDAI rules · Ombudsman awards · every quote verified").
   - `HowItWorks`: three steps with lucide icons — 1 "Share the settlement letter" (FileText), 2 "Agent checks policy + IRDAI rules" (ShieldCheck), 3 "Get the grievance letter" (Send).
   - Case cards: policy name, title, hospital line, deducted amount, a lucide icon by case theme (BedDouble room rent, HeartPulse non-disclosure, Clock discharge delay, FileWarning documents, Scale control), hover lift.
4. **Verdict board:**
   - `SummaryCard`: large recoverable amount, "of ₹X deducted", and `RecoverableBar` (recoverable share of deducted, animated width) — keep the existing `data-testid="summary-card"` and its text.
   - Rows: an icon per deduction label (room rent, proportionate, non-payable, other), status chip, amounts right-aligned in tabular figures.
   - `EvidencePanel` (side sheet): each verified quote shown highlighted (`bg-amber-50` with a left border) and, for rule citations, the full rule text from `getRule(source_id)` under it in a muted box titled "Full rule"; unverified citations keep the existing "Not yet verified" state.
5. **Live timeline:** vertical stepper (line on the left, dot per step). Icon by tool name in `event.data.tool`: `search_policy`/`search_rules` Search, `verify_quote` BadgeCheck, `calc_*` Calculator, `get_case` FileText, `find_precedents` Gavel, others Sparkles. The newest step has a soft pulsing ring while running; done state shows a check badge. Keep all existing `data-testid`s and the stream logic exactly as is.
6. **App shell:** `AppHeader` with logo (ShieldCheck in teal) + name "Claim Contest" + nav links (Cases → `/#cases`, How it works → `/#how`), sticky with a light blur. `AppFooter` with "Self-help tool, not legal advice · Synthetic sample data · Built with Cline". `loading.tsx` skeletons for `/` and `/case/[id]`. Responsive down to 375 px wide.

## Animation (light, framer-motion only)
- Page sections fade + rise in once (`opacity 0→1`, `y 8→0`, 0.3 s, small stagger for cards and timeline steps).
- Card hover: lift 2 px + shadow.
- `RecoverableBar` animates its width on mount.
- Respect `prefers-reduced-motion` (use framer-motion's `useReducedMotion`; no motion when set).
- No looping animation except the pulse on the active timeline step.

## Bug fix included
- Opening `/case/<id>?tab=clocks` (no `analysis`) must keep the tab after the redirect that starts the analysis: redirect to `/case/<id>?analysis=<id>&tab=<tab>` when a valid tab was requested. Add a test.

## Acceptance tests
1. `cd frontend && npx vitest run` passes (all existing tests, updated only for changed markup, plus the new redirect test).
2. `npx tsc --noEmit`, `npx next lint` and `npx next build` pass.
3. New test: `RecoverableBar` with recoverable 40719.76 of deducted 98969.76 renders a bar whose width style is about 41% (rounded to a whole percent).
4. New test: `EvidencePanel` shows the full rule text under a verified rule citation (mock `getRule`).
5. Redirect test from "Bug fix included".

## Do not
- change `frontend/lib/api.ts` types or any backend/agent code
- change what the components compute (amounts, statuses, stream handling); styling and markup only
- add dependencies (fonts via `next/font/google`; icons from `lucide-react`; motion from `framer-motion` — all already installed)
- add login or accounts
