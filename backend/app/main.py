"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.routes.analyses import router as analyses_router
from app.routes.calc import router as calc_router
from app.routes.cases import router as cases_router
from app.routes.checks import router as checks_router
from app.routes.documents import router as documents_router
from app.routes.eval import router as eval_router
from app.routes.letters import router as letters_router
from app.routes.precedents import router as precedents_router
from app.routes.rules import router as rules_router
from app.routes.upload import router as upload_router
from app.settings import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Create the database schema before serving requests."""
    db.init_db()
    yield


app = FastAPI(title="Health Claim Analyser API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cases_router)
app.include_router(upload_router)
app.include_router(documents_router)
app.include_router(precedents_router)
app.include_router(rules_router)
app.include_router(calc_router)
app.include_router(checks_router)
app.include_router(analyses_router)
app.include_router(eval_router)
app.include_router(letters_router)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe."""
    return {"status": "ok"}
