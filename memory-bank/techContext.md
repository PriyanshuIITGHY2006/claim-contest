# Tech context

- **Stack decision (kickoff):** Python is needed for PDF parsing and calculators, so the stack is FastAPI backend + Node agent service (Cline SDK needs Node ≥ 22) + Next.js frontend. Layout: `backend/`, `agent/`, `frontend/`, `data/`.
- **Backend:** Python 3.11+, FastAPI, uvicorn, pydantic v2, pydantic-settings, PyMuPDF (column-aware text via blocks), PyYAML, rapidfuzz; tests with pytest + httpx `TestClient`.
- **Agent:** Node 22, TypeScript strict, `@cline/sdk` (pinned exact version, see `docs/CLINE_SDK.md`, `"type": "module"`, `skipLibCheck`), `zod`, `fastify` for HTTP/SSE; tests with vitest (no model calls in tests).
- **Frontend:** Next.js App Router, TypeScript strict, Tailwind, shadcn/ui components, `lucide-react` icons, `framer-motion` for the live timeline; tests with vitest + Testing Library.
- **How to run backend:** `cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000`
- **How to run agent:** `cd agent && npm install && npm run dev` (port 8100)
- **How to run frontend:** `cd frontend && npm install && npm run dev` (port 3000)
- **How to run tests:** `cd backend && pytest -q` · `cd agent && npx vitest run` · `cd frontend && npx vitest run`
- **Environment variables:** see `.env.example` (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `BACKEND_URL`, `AGENT_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_AGENT_URL`, `DATA_DIR`).
- **Data:** `data/` holds the source PDFs, `data/rules/rules.yaml`, `data/policies/anchors.yaml`, `data/cases/*.json` (synthetic), `data/baseline/` (recorded chatbot answers), `data/eval/` (labelled awards).
