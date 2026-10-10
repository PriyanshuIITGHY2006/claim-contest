# Stack (change only if the problem statement requires it)

Next.js (App Router, TypeScript, Tailwind) · FastAPI (Python 3.11+) or Next.js API routes for small apps · SQLite (demo) or Supabase/Postgres · pytest + vitest.

The Cline SDK runs only on Node ≥ 22. If the product has an agent feature, the backend is Next.js route handlers (no FastAPI) unless the problem statement needs Python; then the agent runs in a small Node service that FastAPI calls. Decide this at kickoff and record it in `memory-bank/techContext.md`.

Layout: `backend/` (app/, tests/) · `frontend/` (app/, components/, lib/, tests/) · `tasks/` · `memory-bank/`.

API responses are typed on both sides (pydantic models ↔ TS types). Shared contracts are defined in `memory-bank/systemPatterns.md`.
