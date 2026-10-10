# TASK-01: Backend skeleton and sample cases

## Goal
FastAPI app with settings, shared pydantic models and the sample-case endpoints, so every other backend task has a base to build on.

## Files to touch
- `backend/requirements.txt` (create)
- `backend/app/__init__.py`, `backend/app/main.py`, `backend/app/settings.py` (create)
- `backend/app/models/schemas.py` (create): all models from "Data model" in `memory-bank/systemPatterns.md`
- `backend/app/services/cases.py`, `backend/app/routes/cases.py` (create)
- `backend/tests/test_cases.py` (create)

## Interface
- `GET /health` → `{"status":"ok"}`
- `GET /cases` → list of `{id, title, summary}` from `data/cases/*.json` (summary = first deduction label + total deducted)
- `GET /cases/{case_id}` → `Case`; 404 for unknown id
- Settings: `DATA_DIR` (default `../data`), CORS allows `http://localhost:3000`

## Acceptance tests (write these first)
1. `GET /health` returns 200 and `{"status":"ok"}`.
2. `GET /cases` returns 5 items with ids `case_a`…`case_e`.
3. `GET /cases/case_a` validates as `Case`; `bill.total` equals the sum of line amounts; `settlement.total_deducted` equals the sum of deductions (98969.76).
4. `GET /cases/nope` returns 404.

## Do not
- touch files not listed above
- add dependencies other than those listed here
- change interfaces in `memory-bank/systemPatterns.md` without updating it first
- Allowed dependencies: fastapi, uvicorn[standard], pydantic, pydantic-settings, pyyaml, httpx, pytest

## Notes
- Case JSON shape: `data/cases/README.md`; model shapes (including `Patient`, `Admission`, `ExpectedVerdict`) in `memory-bank/systemPatterns.md` → Data model. `timeline` may be an empty list.
- Keep routes thin; loading logic in `services/cases.py`.
- Resolve `DATA_DIR` relative to the repo (e.g. `Path(__file__).resolve().parents[2] / "data"`) when the env var is not set, so tests pass from any working directory.
- Money: compare totals in tests with `pytest.approx(..., abs=0.01)`.
- Local Python is 3.14: in `requirements.txt` use `pydantic>=2.12` and `fastapi>=0.118` (older pydantic-core has no 3.14 wheels). Use a virtualenv: `python3 -m venv backend/.venv`.
- Run tests: `cd backend && .venv/bin/pytest -q`.
