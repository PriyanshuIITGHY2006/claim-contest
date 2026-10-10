# TASK-10: Frontend shell, start screen and verdict board

## Goal
The app shell and the hero screen: pick a case, see the verdict board (works against the scripted agent from TASK-06).

## Files to touch
- `frontend/` Next.js app (create with App Router, TypeScript strict, Tailwind)
- `frontend/lib/api.ts` (create): typed calls to backend and agent; types mirror systemPatterns
- `frontend/lib/format.ts` (create): Indian rupee formatting
- `frontend/app/page.tsx` (create): start screen with the five sample cases as cards
- `frontend/app/case/[id]/page.tsx` (create): verdict board
- `frontend/components/VerdictBoard.tsx`, `SummaryCard.tsx`, `StatusChip.tsx`, `EvidencePanel.tsx` (create)
- `frontend/tests/format.test.ts`, `frontend/tests/VerdictBoard.test.tsx` (create)

## Interface
- Visual design: follow `docs/ARCHITECTURE.md` section 5 (light fintech theme, Inter, status colours, ₹ formatting, verified-quote chips).
- Summary card: "Rs X of Rs Y deducted looks recoverable", synthetic-data badge.
- One row per deduction: label, amount deducted, status chip (valid green / contestable amber / needs info blue), recoverable amount.
- Clicking a row opens `EvidencePanel`: bill lines, citations (quote, source, ✓ verified), calculation steps, regulation override badge, precedents.

## Acceptance tests
1. `formatINR(110000)` → "₹1,10,000"; `formatINR(40719.76)` → "₹40,719.76".
2. VerdictBoard renders one row per verdict with the correct chip text.
3. Summary shows the sum of `recoverable_amount`.
4. Clicking a row shows its citations with a verified tick.
5. A citation with `verified: false` and an empty `quote` shows its source id and a neutral "not yet verified" label: no tick and no empty quote block.

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- Allowed dependencies: next, react, react-dom, tailwindcss, shadcn/ui components (copied via CLI), lucide-react, framer-motion, vitest, @testing-library/react, jsdom

## Notes
- Until TASK-08 lands, the scripted agent (TASK-06) sends every citation as `{ quote: "", verified: false }`, with only `source_type` and `source_id` filled. Build the evidence panel for both states and give test 4 a fixture with `verified: true` and a real quote.
- Run the agent for development with `cd agent && npm run dev` (port 8100). It reads `../.env`.
