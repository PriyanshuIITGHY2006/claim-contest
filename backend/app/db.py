"""SQLite persistence helpers (stdlib ``sqlite3``, no ORM).

One connection is opened per request. The schema is created idempotently on
every connection so the tests can point ``settings.database_path`` at a
throwaway file without any startup ordering.
"""

from __future__ import annotations

import sqlite3

from app.settings import settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS analyses (
    analysis_id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    status TEXT NOT NULL,
    total_recoverable REAL NOT NULL,
    started_at TEXT,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS verdicts (
    analysis_id TEXT NOT NULL REFERENCES analyses(analysis_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    deduction_id TEXT NOT NULL,
    status TEXT NOT NULL,
    recoverable_amount REAL NOT NULL,
    reasoning TEXT NOT NULL,
    citations TEXT NOT NULL,
    calculation TEXT,
    confidence REAL NOT NULL,
    regulation_override TEXT,
    PRIMARY KEY (analysis_id, deduction_id)
);

CREATE TABLE IF NOT EXISTS flags (
    id INTEGER PRIMARY KEY,
    analysis_id TEXT NOT NULL REFERENCES analyses(analysis_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    detail TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
    draft_id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL REFERENCES analyses(analysis_id),
    tier INTEGER NOT NULL,
    language TEXT NOT NULL,
    letter_markdown TEXT NOT NULL,
    local_summary TEXT NOT NULL,
    human_approved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cases (
    case_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    """Open a fresh connection with foreign keys on and the schema ensured."""
    conn = sqlite3.connect(str(settings.database_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(_SCHEMA)
    return conn


def init_db() -> None:
    """Create the schema at startup (idempotent)."""
    conn = connect()
    conn.close()