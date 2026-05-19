from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone

from boss_analysis.consumer import IngestionPipeline
from boss_analysis.storage import InMemoryFactStore, InMemoryRawEventRepository, SQLiteRawEventRepository


def make_record(event_id="evt_pipeline_001", event_type="candidate_list.card_exposed", payload=None):
  if payload is None:
    payload = {
      "candidate": {
        "candidateId": "candidate_001",
        "stableId": "geek_001",
        "stableIdSource": "url.geekId",
        "identityConfidence": "high",
      },
      "exposure": {
        "cardIndex": 0,
      },
    }
  payload_json = payload if isinstance(payload, str) else json.dumps(payload)
  return {
    "event_id": event_id,
    "event_type": event_type,
    "occurred_at": "2026-05-17T09:12:30+08:00",
    "plugin_version": "0.1.0",
    "operator_id": "op_001",
    "operator_account_name": "operator-a",
    "boss_account_name": "operator-a",
    "boss_account_matched": "true",
    "session_id": "sess_001",
    "page_type": "candidate_recommend",
    "page_url": "https://www.zhipin.com/web/chat/recommend",
    "page_title": "candidate recommendations",
    "job_id": "job_001",
    "job_status": "0",
    "source_tab_id": 1,
    "source_window_id": 2,
    "source_tab_url": "https://www.zhipin.com/web/chat/recommend",
    "payload_json": payload_json,
    "context_json": json.dumps({"sessionId": "sess_001"}),
  }


class IngestionPipelineTests(unittest.TestCase):
  def test_valid_record_is_saved_and_projected(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    pipeline = IngestionPipeline(raw_repository, fact_store)

    result = pipeline.ingest_cls_record(
      make_record(),
      received_at=datetime(2026, 5, 17, 1, 13, tzinfo=timezone.utc),
    )

    self.assertEqual(result.parse_status, "parsed")
    self.assertTrue(result.raw_inserted)
    self.assertTrue(result.raw_available)
    self.assertTrue(result.projected)
    self.assertEqual(len(fact_store.candidate_exposures()), 1)
    self.assertIsNotNone(raw_repository.get_raw_event("evt_pipeline_001"))

  def test_duplicate_record_is_idempotent_and_not_projected_twice(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    pipeline = IngestionPipeline(raw_repository, fact_store)

    first = pipeline.ingest_cls_record(make_record())
    duplicate = pipeline.ingest_cls_record(make_record(payload={"candidate": {"candidateId": "other"}}))

    self.assertTrue(first.raw_inserted)
    self.assertFalse(duplicate.raw_inserted)
    self.assertFalse(duplicate.projected)
    self.assertEqual(len(fact_store.candidate_exposures()), 1)

  def test_unknown_event_type_is_saved_but_skipped_by_projector(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    pipeline = IngestionPipeline(raw_repository, fact_store)

    result = pipeline.ingest_cls_record(make_record(event_type="future_module.new_fact", payload={}))

    self.assertTrue(result.raw_inserted)
    self.assertEqual(result.projection.skipped_event_ids, ("evt_pipeline_001",))
    self.assertEqual(fact_store.candidate_exposures(), ())

  def test_missing_event_id_records_parse_error_without_raw_event(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    pipeline = IngestionPipeline(raw_repository, fact_store)

    record = make_record(event_id="")
    result = pipeline.ingest_cls_record(record)

    self.assertEqual(result.parse_status, "failed")
    self.assertFalse(result.raw_inserted)
    self.assertFalse(result.raw_available)
    self.assertEqual(result.parse_error_count, 1)
    self.assertEqual(raw_repository.replay_raw_events(), ())

  def test_invalid_payload_is_saved_and_records_projection_error(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    pipeline = IngestionPipeline(raw_repository, fact_store)

    result = pipeline.ingest_cls_record(make_record(payload="{bad"))

    self.assertEqual(result.parse_status, "partial")
    self.assertTrue(result.raw_inserted)
    self.assertEqual(result.projection.error_event_ids, ("evt_pipeline_001",))
    self.assertEqual(raw_repository.list_errors(event_id="evt_pipeline_001")[-1].error_stage, "fact_project")

  def test_pipeline_works_with_sqlite_repository(self):
    raw_repository = SQLiteRawEventRepository()
    fact_store = InMemoryFactStore()
    pipeline = IngestionPipeline(raw_repository, fact_store)

    result = pipeline.ingest_cls_record(make_record())

    self.assertTrue(result.raw_inserted)
    self.assertEqual(raw_repository.get_raw_event("evt_pipeline_001").event_id, "evt_pipeline_001")
    self.assertEqual(len(fact_store.candidate_exposures()), 1)
    raw_repository.close()


if __name__ == "__main__":
  unittest.main()
