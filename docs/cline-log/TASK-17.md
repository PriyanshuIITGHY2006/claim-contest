# TASK-17 log - UI polish

Branch: `task-17-ui-polish` · Owner: Sumedha

## What was built
- **Type and theme:** Plus Jakarta Sans (`--font-heading`, 600/700) and Inter (`--font-inter`) via `next/font/google`, wired into `tailwind.config.ts` (`font-heading`, `font-sans`). Teal primary `#0f766e` (hover `#115e59`) as the shadcn `--primary` and as `brand` colours, `--radius` 1rem, `rounded-2xl` cards, `tabular-nums` on amounts, smooth scroll (off under reduced motion). `h1`-`h3` use the heading font.
- **Shell:** `AppHeader` (sticky, blurred, "Cases" / "How it works" anchors), `AppFooter`, `app/loading.tsx` and `app/case/[id]/loading.tsx` skeletons.
- **Landing:** hero with "Try a sample case", trust row, `HowItWorks` (3 steps), case cards with a theme icon (keyword match, "control" first): A BedDouble, B HeartPulse, C Scale, D Clock, E FileWarning. Confirmed live.
- **Case page:** pill-style tabs (still `<Link>`s, same labels and hrefs); the redirect that starts an analysis now keeps a valid `?tab=`.
- **Verdict board:** `SummaryCard` keeps its one-sentence `<p>` and gains a large figure and `RecoverableBar` (client; inline `width: NN%`, clamped 0-100, guarded for a 0 deduction; `scaleX` mount animation, off under reduced motion). Rows have icons; `StatusChip` has icons. Below `sm` the table becomes stacked rows (label + recoverable amount, chip and "Deducted" underneath) so 375px does not overflow.
- **EvidencePanel:** a verified quote is `bg-amber-50 border-l-4 border-amber-400`; a verified **rule** citation calls `getRule(source_id)` and shows a `data-testid="full-rule"` "Full rule" box. A failed fetch shows nothing. Unverified and policy citations do not fetch.
- **LiveTimeline:** markup only. Vertical stepper, icon by `data.tool`, pulsing ring on the latest step while running, green completion bar. The stream `useEffect` is untouched.
- **PolicyXray / TatClocks:** card styling, icon tiles, heading-font figures.
- `components/Reveal.tsx` (client, framer-motion, `useReducedMotion`) fades in landing blocks while `page.tsx` stays a server component.

## Tests (written first, seen failing, then passing)
- `tests/RecoverableBar.test.tsx` (5): 40,719.76 of 98,969.76 gives `41%`; clamped to `100%`; `0%` when nothing recoverable; `0%` (not NaN) when nothing deducted; progressbar aria values.
- `tests/EvidencePanel.test.tsx` (6): "Full rule" box for a verified rule citation; highlighted quote still shown; no fetch for unverified or policy citations; no box and quote kept when the fetch rejects; switching citation shows the new rule's text.
- `tests/CasePage.test.tsx` (+2): `{tab:"clocks"}` redirects to `...?analysis=an_new&tab=clocks`; `{tab:"bogus"}` drops the tab. The existing plain-redirect test is unchanged.
- Frontend 66/66 (was 53 after TASK-11 review fixes). `tsc --noEmit`, `next lint`, `next build` clean (build needs network for Google Fonts).
- No existing test or `data-testid` was changed or removed. No `timeline-event-` prefix was added anywhere else.

## Live check (backend :8000, agent :8100, frontend :3000, headless Chrome over DevTools)
- `/` and `/case/case_a` (Analysis, X-ray, Clocks) at 1280px and 375px; case D Clocks at both widths. No horizontal overflow at either width after the fix below.
- Case A: redirect to `?analysis=<id>`, 9 timeline events, done bar, "₹40,719.76 of ₹98,969.76", bar width `41%`, 4 rows, evidence panel opens.
- Fonts computed as Inter (body) and Plus Jakarta Sans (headings); header is `position: sticky`.
- One fix round: at 375px the table was wider than the viewport (header and rows clipped). Fixed with the stacked-row layout; also left-aligned the evidence sheet title and put the case meta on separate lines on mobile. Re-checked, clean.
- Screenshots: `docs/screenshots/17-landing.png`, `17-verdict-evidence-panel.png`, `17-live-timeline.png`.

## Decisions and deviations
- Files outside the task list (approved in plan): `components/Reveal.tsx`, `tests/RecoverableBar.test.tsx`, `tests/EvidencePanel.test.tsx`, `tests/CasePage.test.tsx`. `lib/api.ts` not touched (`getRule` came with TASK-11).
- `components/ui/card.tsx` was left alone; card rounding and borders are applied by the callers instead.
- Capture used a throwaway DevTools script kept in `%TEMP%`, not committed.

## Open issues
- The "Full rule" box does not show live yet: the scripted agent verifies nothing, so the evidence screenshot shows "Not yet verified". Covered by its own tests. Retake `17-verdict-evidence-panel.png` after TASK-08 lands.
- The browser calls `GET /rules/:id` on the backend directly; fine locally, but the backend's CORS allow-list must include the frontend origin when deployed.
- The live timeline screenshot has no tool icons for the same reason (no `data.tool` in scripted events); the icon mapping is by tool name and falls back to a sparkle.

## Review fixes
- None. Review re-ran vitest (66/66), `tsc --noEmit`, `next lint` and `next build` (all clean), read every changed file (no change to amounts, statuses or stream handling; redirect keeps only a known tab), and checked the backend CORS preflight from `http://localhost:3000` for the client-side `getRule` call (200).
- Live agent now runs (TASK-08), so the "Full rule" box and tool icons can be captured for the screenshots.
