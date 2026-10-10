"""Shared pytest fixtures.

Every test runs against its own throwaway SQLite file, so no test can read or
create ``backend/app.db`` (``/cases`` now merges uploaded cases from SQLite).
"""

from __future__ import annotations

import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

# The pytest console script does not add the CWD to sys.path, so make the
# ``app`` package importable when running from backend/.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.settings import settings  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated_database(tmp_path: Path) -> Iterator[None]:
    """Point the app at a temporary SQLite file; restore the original after."""
    original = settings.database_url
    settings.database_url = f"sqlite:///{tmp_path / 'test.db'}"
    yield
    settings.database_url = original
