"""Application settings.

Environment variables are read once, here, at import time. ``DATA_DIR`` may be
overridden via the environment; otherwise it resolves to ``<repo>/data`` so the
tests pass from any working directory.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/settings.py -> parents[2] is the repository root.
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = REPO_ROOT / "data"


class Settings(BaseSettings):
    """Runtime configuration sourced from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    data_dir: Path = DEFAULT_DATA_DIR
    cors_origins: list[str] = ["http://localhost:3000"]
    database_url: str = "sqlite:///backend/app.db"

    @field_validator("data_dir")
    @classmethod
    def _resolve_data_dir(cls, value: Path) -> Path:
        return value.expanduser().resolve()

    @property
    def cases_dir(self) -> Path:
        """Directory holding the synthetic sample cases (``data/cases``)."""
        return self.data_dir / "cases"

    @property
    def database_path(self) -> Path:
        """SQLite file path derived from ``DATABASE_URL`` (``sqlite:///<path>``).

        A relative path resolves against the repository root (like ``DATA_DIR``);
        the default is ``<repo>/backend/app.db``.
        """
        prefix = "sqlite:///"
        if not self.database_url.startswith(prefix):
            raise ValueError(
                f"unsupported DATABASE_URL {self.database_url!r}; expected sqlite:///<path>"
            )
        path = Path(self.database_url[len(prefix):])
        if not path.is_absolute():
            path = REPO_ROOT / path
        return path.expanduser().resolve()


settings = Settings()
