---
paths:
  - "backend/**"
  - "**/*.py"
---
# Backend rules (active only when backend files are in context)
- Routes stay thin; logic lives in `app/services/`, data shapes in `app/models/` (pydantic).
- Every endpoint has a pytest test using FastAPI's `TestClient`.
- Style: ruff defaults, snake_case, type hints everywhere.
- Config comes from environment variables via one settings module.
- Run tests with: `cd backend && pytest -q`
