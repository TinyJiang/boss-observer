"""Ingestion pipeline result models."""

from __future__ import annotations

from dataclasses import dataclass

from boss_analysis.domain.events import ParseStatus
from boss_analysis.domain.facts import FactProjectionResult


@dataclass(frozen=True)
class IngestionResult:
  """Outcome of processing one incoming CLS record."""

  event_id: str | None
  event_type: str | None
  parse_status: ParseStatus
  raw_inserted: bool
  raw_available: bool
  parse_error_count: int
  projection: FactProjectionResult

  @property
  def projected(self) -> bool:
    return bool(self.projection.inserted_fact_ids or self.projection.updated_fact_ids)
