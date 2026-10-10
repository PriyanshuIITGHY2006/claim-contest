---
paths:
  - "frontend/**"
  - "**/*.ts"
  - "**/*.tsx"
---
# Frontend rules (active only when frontend files are in context)
- TypeScript strict; components in PascalCase under `components/`.
- All backend calls go through `lib/api.ts`; types mirror the backend models.
- Server components by default; add `"use client"` only when state or effects are needed.
- Tailwind for styling; no new UI libraries without approval in the task file.
- Run tests with: `cd frontend && npx vitest run`
