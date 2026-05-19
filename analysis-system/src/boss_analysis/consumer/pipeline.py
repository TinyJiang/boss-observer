"""Ingestion pipeline for one flattened CLS record."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from boss_analysis.consumer.normalizer import normalize_cls_event
from boss_analysis.domain import FactProjectionResult, IngestionResult, RawEventRepository
from boss_analysis.storage import InMemoryFactStore
from boss_analysis.workers import FactProjector


class IngestionPipeline:
  """Normalize, persist, and project one incoming CLS record."""

  def __init__(
    self,
    raw_repository: RawEventRepository,
    fact_store: InMemoryFactStore,
  ) -> None:
    self._raw_repository = raw_repository
    self._fact_store = fact_store

  def ingest_cls_record(
    self,
    raw_record: Mapping[str, Any],
    *,
    received_at: datetime | None = None,
  ) -> IngestionResult:
    event = normalize_cls_event(raw_record, received_at=received_at)
    save_result = self._raw_repository.save_normalized_event(event)
    projection = FactProjectionResult()

    if save_result.record is not None and save_result.inserted and event.parse_status != "failed":
      projection = FactProjector(
        self._fact_store,
        error_repository=self._raw_repository,
      ).project_record(save_result.record)

    return IngestionResult(
      event_id=event.event_id,
      event_type=event.event_type,
      parse_status=event.parse_status,
      raw_inserted=save_result.inserted,
      raw_available=save_result.record is not None,
      parse_error_count=len(save_result.errors_recorded),
      projection=projection,
    )
