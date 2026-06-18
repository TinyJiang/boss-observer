"""Data structures for BOSS official result rows."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any, Protocol


@dataclass(frozen=True)
class OfficialResultRow:
  """One mapped official result row ready for the Feishu result tables."""

  fields: dict[str, Any]
  business_key: str
  missing_source_fields: tuple[str, ...] = ()
  extra_source_fields: Mapping[str, Any] | None = None

  def __post_init__(self) -> None:
    if self.extra_source_fields is None:
      object.__setattr__(self, "extra_source_fields", {})


@dataclass(frozen=True)
class OfficialResultsBatch:
  """The official result rows for one active date."""

  target_date: date
  operator_rows: tuple[OfficialResultRow, ...] = ()
  job_rows: tuple[OfficialResultRow, ...] = ()
  source_deadline: str | None = None
  source_warnings: tuple[str, ...] = ()


class OfficialResultsSource(Protocol):
  """Fetch official result rows from a replaceable source."""

  def fetch(self, target_date: date) -> OfficialResultsBatch:
    """Return mapped official result rows for ``target_date``."""
