from __future__ import annotations

import json
import unittest
from dataclasses import asdict
from datetime import date, datetime, timezone

from boss_analysis.api import AnalysisQueryService
from boss_analysis.consumer import normalize_cls_event
from boss_analysis.domain import DailyActiveDurationRecord, LogQualitySummaryRecord, MinuteSummaryRecord, OperatorProfile
from boss_analysis.storage import InMemoryFactStore, InMemoryRawEventRepository
from boss_analysis.workers import FactProjector


def fixed_now():
  return datetime(2026, 5, 17, 1, 15, tzinfo=timezone.utc)


def make_record(
  event_id,
  event_type,
  payload,
  *,
  operator_id="op_001",
  job_id="job_001",
  occurred_at="2026-05-17T09:12:00+08:00",
):
  if isinstance(payload, str):
    payload_json = payload
  else:
    payload_json = json.dumps(payload)
  return {
    "event_id": event_id,
    "event_type": event_type,
    "occurred_at": occurred_at,
    "plugin_version": "0.1.0",
    "operator_id": operator_id,
    "operator_account_name": operator_id,
    "boss_account_name": operator_id,
    "boss_account_matched": "true",
    "session_id": f"sess_{operator_id}",
    "page_type": "candidate_recommend",
    "page_url": "https://www.zhipin.com/web/chat/recommend",
    "page_title": "candidate recommendations",
    "job_id": job_id,
    "job_status": "0",
    "source_tab_id": 1,
    "source_window_id": 2,
    "source_tab_url": "https://www.zhipin.com/web/chat/recommend",
    "payload_json": payload_json,
    "context_json": json.dumps({"sessionId": f"sess_{operator_id}"}),
  }


def candidate_payload(stable_id="geek_001"):
  return {
    "candidateId": f"candidate_{stable_id}",
    "stableId": stable_id,
    "stableIdSource": "url.geekId",
    "identityConfidence": "high",
    "profile": {
      "displayName": "candidate-a",
    },
  }


def project(record, raw_repository, fact_store):
  normalized = normalize_cls_event(
    record,
    received_at=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
  )
  raw = raw_repository.save_normalized_event(normalized).record
  FactProjector(fact_store, error_repository=raw_repository).project_record(raw)
  return raw


class AnalysisQueryServiceTests(unittest.TestCase):
  def test_empty_queries_return_stable_zero_structures(self):
    service = AnalysisQueryService(InMemoryFactStore(), clock=fixed_now)

    dashboard = service.dashboard()
    analytics = service.operator_analytics("op_missing")
    health = service.health()

    self.assertEqual(dashboard.active_count, 0)
    self.assertEqual(dashboard.active_operators, ())
    self.assertEqual(analytics.funnel.card_exposed, 0)
    self.assertEqual(analytics.chat.visible_message_count, 0)
    self.assertEqual(health.raw_event_count, 0)

  def test_dashboard_reports_active_operators_by_last_fact_time(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    project(make_record(
      "evt_recent",
      "candidate_greeting.clicked",
      {"candidate": candidate_payload()},
      operator_id="op_recent",
      job_id="job_recent",
      occurred_at="2026-05-17T09:12:00+08:00",
    ), raw_repository, fact_store)
    project(make_record(
      "evt_old",
      "candidate_list.card_exposed",
      {"candidate": candidate_payload("old")},
      operator_id="op_old",
      job_id="job_old",
      occurred_at="2026-05-17T08:40:00+08:00",
    ), raw_repository, fact_store)
    service = AnalysisQueryService(fact_store, raw_repository=raw_repository, clock=fixed_now)

    dashboard = service.dashboard(active_within_minutes=5)

    self.assertEqual(dashboard.active_count, 1)
    self.assertEqual(dashboard.observed_operator_count, 2)
    self.assertEqual(dashboard.active_operators[0].operator_id, "op_recent")
    self.assertEqual(dashboard.active_operators[0].minutes_since_active, 3)
    self.assertEqual(dashboard.active_operators[0].last_action, "candidate_greeting.clicked")
    self.assertEqual(dashboard.active_operators[0].job_id, "job_recent")

  def test_dashboard_uses_raw_events_for_recent_activity(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    unknown = normalize_cls_event(make_record(
      "evt_recent_raw",
      "candidate_chat.report_required",
      {},
      operator_id="op_raw",
      job_id="job_raw",
      occurred_at="2026-05-17T09:14:00+08:00",
    ))
    raw_repository.save_normalized_event(unknown)
    service = AnalysisQueryService(fact_store, raw_repository=raw_repository, clock=fixed_now)

    dashboard = service.dashboard(active_within_minutes=5)

    self.assertEqual(dashboard.active_count, 1)
    self.assertEqual(dashboard.observed_operator_count, 1)
    self.assertEqual(dashboard.active_operators[0].operator_id, "op_raw")
    self.assertEqual(dashboard.active_operators[0].last_action, "candidate_chat.report_required")
    self.assertEqual(dashboard.active_operators[0].job_id, "job_raw")

  def test_operator_funnel_counts_are_not_duplicated_by_reprojection(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    projector = FactProjector(fact_store, error_repository=raw_repository)
    event = normalize_cls_event(make_record(
      "evt_exposure",
      "candidate_list.card_exposed",
      {"candidate": candidate_payload()},
    ))
    record = raw_repository.save_normalized_event(event).record

    projector.project_record(record)
    projector.project_record(record)
    service = AnalysisQueryService(fact_store, raw_repository=raw_repository, clock=fixed_now)

    analytics = service.operator_analytics("op_001")

    self.assertEqual(analytics.funnel.card_exposed, 1)
    self.assertEqual(analytics.funnel.detail_opened, 0)
    self.assertEqual(analytics.job_ids, ("job_001",))

  def test_late_historical_fact_is_in_operator_analytics(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    project(make_record(
      "evt_late",
      "candidate_detail.opened",
      {"candidate": candidate_payload(), "detailUrl": "https://example.invalid/detail"},
      occurred_at="2026-05-10T09:00:00+08:00",
    ), raw_repository, fact_store)
    service = AnalysisQueryService(fact_store, raw_repository=raw_repository, clock=fixed_now)

    analytics = service.operator_analytics("op_001")

    self.assertEqual(analytics.funnel.detail_opened, 1)

  def test_chat_metrics_do_not_expose_sensitive_messages_or_accounts(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    project(make_record("evt_snapshot", "candidate_chat.snapshot_captured", {
      "candidate": candidate_payload(),
      "chat": {
        "messageCount": 2,
        "mayBeIncomplete": True,
        "messages": [
          {"text": "sensitive hello"},
        ],
      },
    }), raw_repository, fact_store)
    project(make_record("evt_wechat", "candidate_chat.wechat_captured", {
      "candidate": candidate_payload(),
      "wechat": {
        "accounts": ["wxid_secret"],
      },
    }), raw_repository, fact_store)
    service = AnalysisQueryService(fact_store, raw_repository=raw_repository, clock=fixed_now)

    analytics = service.operator_analytics("op_001")
    public_payload = str(asdict(analytics))

    self.assertEqual(analytics.chat.visible_message_count, 2)
    self.assertEqual(analytics.chat.may_be_incomplete_count, 1)
    self.assertEqual(analytics.funnel.wechat_captured, 1)
    self.assertNotIn("sensitive hello", public_payload)
    self.assertNotIn("wxid_secret", public_payload)

  def test_wechat_exchange_marker_in_snapshot_counts_as_wechat_captured(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    project(make_record("evt_snapshot_wechat", "candidate_chat.snapshot_captured", {
      "candidate": candidate_payload(),
      "chat": {
        "messageCount": 2,
        "messages": [
          {"text": "候选人的微信号：wxid_secret"},
        ],
      },
    }), raw_repository, fact_store)
    service = AnalysisQueryService(fact_store, raw_repository=raw_repository, clock=fixed_now)

    analytics = service.operator_analytics("op_001")

    self.assertEqual(analytics.funnel.wechat_captured, 1)
    self.assertEqual(analytics.chat.wechat_captured, 1)

  def test_health_counts_parse_projection_and_unknown_event_types(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    unknown = normalize_cls_event(make_record("evt_unknown", "future_module.new_fact", {}))
    raw_repository.save_normalized_event(unknown)
    bad = normalize_cls_event(make_record("evt_bad", "candidate_list.card_exposed", "{bad"))
    bad_record = raw_repository.save_normalized_event(bad).record
    FactProjector(fact_store, error_repository=raw_repository).project_record(bad_record)
    service = AnalysisQueryService(fact_store, raw_repository=raw_repository, clock=fixed_now)

    health = service.health()

    self.assertEqual(health.raw_event_count, 2)
    self.assertEqual(health.unknown_event_type_count, 1)
    self.assertEqual(health.parse_error_count, 1)
    self.assertEqual(health.projection_error_count, 1)

  def test_operator_analytics_prefers_minute_summary_when_available(self):
    service = AnalysisQueryService(
      InMemoryFactStore(),
      minute_summaries=[
        MinuteSummaryRecord(
          metric_name="boss_minute_operator_funnel",
          minute=datetime(2026, 5, 17, 1, 14, tzinfo=timezone.utc),
          operator_id="op_summary",
          job_id="job_summary",
          card_exposed=9,
          detail_opened=2,
          greeting_clicked=1,
          greeting_succeeded=1,
          chat_opened=1,
          chat_snapshots=3,
          wechat_captured=1,
          total_events=17,
        ),
        MinuteSummaryRecord(
          metric_name="boss_minute_operator_funnel",
          minute=datetime(2026, 5, 17, 1, 15, tzinfo=timezone.utc),
          operator_id="op_summary",
          job_id="job_summary",
          card_exposed=4,
          detail_opened=1,
          total_events=5,
        ),
        MinuteSummaryRecord(
          metric_name="boss_minute_chat",
          minute=datetime(2026, 5, 17, 1, 14, tzinfo=timezone.utc),
          operator_id="op_summary",
          job_id="job_summary",
          chat_opened=2,
          chat_snapshots=4,
          wechat_captured=1,
          capture_failed=1,
          chat_events=8,
        ),
      ],
      clock=fixed_now,
    )

    dashboard = service.dashboard(active_within_minutes=5)
    analytics = service.operator_analytics("op_summary")
    health = service.health()

    self.assertEqual(dashboard.active_count, 1)
    self.assertEqual(dashboard.active_operators[0].operator_id, "op_summary")
    self.assertEqual(analytics.funnel.card_exposed, 13)
    self.assertEqual(analytics.funnel.chat_snapshots, 3)
    self.assertEqual(analytics.chat.snapshot_captured, 4)
    self.assertEqual(analytics.chat.capture_failed, 1)
    self.assertEqual(analytics.job_ids, ("job_summary",))
    self.assertEqual(analytics.minute_points[0].minute.isoformat(), "2026-05-17T01:14:00+00:00")
    self.assertEqual(analytics.minute_points[0].card_exposed, 9)
    self.assertEqual(analytics.minute_points[0].chat_snapshots, 4)
    self.assertEqual(analytics.minute_points[0].event_count, 25)
    self.assertEqual(analytics.minute_points[1].minute.isoformat(), "2026-05-17T01:15:00+00:00")
    self.assertEqual(analytics.minute_points[1].card_exposed, 4)
    self.assertEqual(health.summary_record_count, 3)

  def test_operator_analytics_dedupes_overlapping_summary_snapshots(self):
    service = AnalysisQueryService(
      InMemoryFactStore(),
      minute_summaries=[
        MinuteSummaryRecord(
          metric_name="boss_minute_operator_funnel",
          minute=datetime(2026, 5, 17, 1, 14, tzinfo=timezone.utc),
          operator_id="op_summary",
          job_id="job_summary",
          greeting_clicked=7,
          greeting_succeeded=7,
          total_events=14,
          recorded_at=datetime(2026, 5, 17, 1, 16, tzinfo=timezone.utc),
        ),
        MinuteSummaryRecord(
          metric_name="boss_minute_operator_funnel",
          minute=datetime(2026, 5, 17, 1, 14, tzinfo=timezone.utc),
          operator_id="op_summary",
          job_id="job_summary",
          greeting_clicked=7,
          greeting_succeeded=7,
          total_events=14,
          recorded_at=datetime(2026, 5, 17, 1, 17, tzinfo=timezone.utc),
        ),
      ],
      clock=fixed_now,
    )

    analytics = service.operator_analytics("op_summary")

    self.assertEqual(analytics.funnel.greeting_clicked, 7)
    self.assertEqual(analytics.funnel.greeting_succeeded, 7)
    self.assertEqual(len(analytics.minute_points), 1)
    self.assertEqual(analytics.minute_points[0].greeting_clicked, 7)

  def test_operator_analytics_uses_latest_local_day_for_summary_records(self):
    service = AnalysisQueryService(
      InMemoryFactStore(),
      minute_summaries=[
        MinuteSummaryRecord(
          metric_name="boss_minute_operator_funnel",
          minute=datetime(2026, 5, 18, 7, 59, tzinfo=timezone.utc),
          operator_id="op_summary",
          job_id="job_old",
          card_exposed=84,
          detail_opened=134,
          greeting_clicked=22,
          total_events=240,
        ),
        MinuteSummaryRecord(
          metric_name="boss_minute_chat",
          minute=datetime(2026, 5, 18, 8, 3, tzinfo=timezone.utc),
          operator_id="op_summary",
          job_id="job_old",
          chat_opened=78,
          chat_events=78,
        ),
        MinuteSummaryRecord(
          metric_name="boss_minute_operator_funnel",
          minute=datetime(2026, 5, 19, 2, 6, tzinfo=timezone.utc),
          operator_id="op_summary",
          job_id="job_today",
          card_exposed=1,
          detail_opened=2,
          total_events=3,
        ),
      ],
      clock=fixed_now,
    )

    analytics = service.operator_analytics("op_summary")

    self.assertIsNotNone(analytics.daily_active_duration)
    self.assertEqual(analytics.daily_active_duration.active_date, date(2026, 5, 19))
    self.assertEqual(analytics.daily_active_duration.active_minutes, 1)
    self.assertEqual(analytics.funnel.card_exposed, 1)
    self.assertEqual(analytics.funnel.detail_opened, 2)
    self.assertEqual(analytics.funnel.greeting_clicked, 0)
    self.assertEqual(analytics.chat.chat_opened, 0)
    self.assertEqual(analytics.job_ids, ("job_today",))
    self.assertEqual(len(analytics.minute_points), 1)
    self.assertEqual(analytics.minute_points[0].minute.isoformat(), "2026-05-19T02:06:00+00:00")

  def test_summary_health_reports_missing_operator_rows(self):
    service = AnalysisQueryService(
      InMemoryFactStore(),
      minute_summaries=[
        MinuteSummaryRecord(
          metric_name="boss_minute_operator_funnel",
          minute=datetime(2026, 5, 17, 1, 14, tzinfo=timezone.utc),
          raw_operator_id="<missing>",
          card_exposed=9,
        ),
      ],
      clock=fixed_now,
    )

    dashboard = service.dashboard(active_within_minutes=5)
    health = service.health()

    self.assertEqual(dashboard.active_count, 0)
    self.assertEqual(health.summary_record_count, 1)
    self.assertEqual(health.summary_missing_operator_count, 1)
    self.assertEqual(health.summary_latest_minute.isoformat(), "2026-05-17T01:14:00+00:00")

  def test_health_rolls_up_log_quality_by_plugin_version_and_event_type(self):
    service = AnalysisQueryService(
      InMemoryFactStore(),
      log_quality_summaries=[
        LogQualitySummaryRecord(
          metric_name="boss_10min_log_quality",
          window_start=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
          plugin_version="0.1.1",
          event_type="candidate_list.card_exposed",
          operator_id="op_quality",
          raw_event_count=10,
          checked_event_count=10,
          card_required_field_missing_count=3,
        ),
        LogQualitySummaryRecord(
          metric_name="boss_10min_log_quality",
          window_start=datetime(2026, 5, 17, 1, 10, tzinfo=timezone.utc),
          plugin_version="0.1.1",
          event_type="candidate_chat.snapshot_captured",
          operator_id="op_quality",
          raw_event_count=5,
          checked_event_count=5,
          chat_message_quality_issue_count=1,
          chat_message_fingerprint_missing_count=1,
        ),
      ],
      clock=fixed_now,
    )

    health = service.health()

    self.assertEqual(health.log_quality_status, "critical")
    self.assertEqual(health.log_quality_record_count, 2)
    self.assertEqual(health.log_quality_checked_event_count, 15)
    self.assertEqual(health.log_quality_finding_count, 5)
    self.assertEqual(health.log_quality_latest_window_start.isoformat(), "2026-05-17T01:10:00+00:00")
    self.assertEqual(len(health.log_quality_version_summaries), 1)
    self.assertEqual(health.log_quality_version_summaries[0].plugin_version, "0.1.1")
    self.assertEqual(health.log_quality_version_summaries[0].finding_count, 5)
    self.assertEqual(health.log_quality_event_summaries[0].event_type, "candidate_list.card_exposed")
    self.assertEqual(health.log_quality_event_summaries[0].top_issues[0].key, "card_required_field_missing_count")

  def test_health_marks_log_quality_missing_operator_as_critical(self):
    service = AnalysisQueryService(
      InMemoryFactStore(),
      log_quality_summaries=[
        LogQualitySummaryRecord(
          metric_name="boss_10min_log_quality",
          window_start=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
          plugin_version="0.1.1",
          event_type="candidate_detail.opened",
          raw_operator_id="<missing>",
          raw_event_count=20,
          checked_event_count=20,
          missing_operator_count=1,
        ),
      ],
      clock=fixed_now,
    )

    health = service.health()

    self.assertEqual(health.status, "critical")
    self.assertEqual(health.log_quality_status, "critical")
    self.assertEqual(health.log_quality_missing_operator_count, 1)

  def test_log_quality_query_filters_by_operator_and_plugin_version(self):
    service = AnalysisQueryService(
      InMemoryFactStore(),
      log_quality_summaries=[
        LogQualitySummaryRecord(
          metric_name="boss_10min_log_quality",
          window_start=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
          plugin_version="0.1.1",
          event_type="candidate_detail.opened",
          operator_id="op_quality",
          raw_event_count=12,
          checked_event_count=12,
          detail_card_link_hint_missing_count=3,
        ),
        LogQualitySummaryRecord(
          metric_name="boss_10min_log_quality",
          window_start=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
          plugin_version="0.1.2",
          event_type="candidate_detail.opened",
          operator_id="op_quality",
          raw_event_count=9,
          checked_event_count=9,
          detail_card_link_hint_missing_count=1,
        ),
        LogQualitySummaryRecord(
          metric_name="boss_10min_log_quality",
          window_start=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
          plugin_version="0.1.1",
          event_type="candidate_chat.snapshot_captured",
          operator_id="op_other",
          raw_event_count=8,
          checked_event_count=8,
          chat_message_quality_issue_count=2,
        ),
      ],
      clock=fixed_now,
    )

    quality = service.log_quality(operator_id="op_quality", plugin_version="0.1.1")

    self.assertEqual(quality.operator_id, "op_quality")
    self.assertEqual(quality.plugin_version, "0.1.1")
    self.assertEqual(quality.source_record_count, 3)
    self.assertEqual(quality.record_count, 1)
    self.assertEqual(quality.checked_event_count, 12)
    self.assertEqual(quality.finding_count, 3)
    self.assertEqual(quality.version_summaries[0].plugin_version, "0.1.1")
    self.assertEqual(quality.event_summaries[0].event_type, "candidate_detail.opened")

  def test_daily_active_duration_is_exposed_and_deduplicated(self):
    service = AnalysisQueryService(
      InMemoryFactStore(),
      daily_active_durations=[
        DailyActiveDurationRecord(
          metric_name="boss_daily_operator_active_duration",
          active_date=date(2026, 5, 17),
          operator_id="op_daily",
          active_minutes=4,
          active_seconds=240,
          first_active_minute=datetime(2026, 5, 17, 1, 8, tzinfo=timezone.utc),
          last_active_minute=datetime(2026, 5, 17, 1, 10, tzinfo=timezone.utc),
          source_minute_count=4,
          source_row_count=4,
        ),
        DailyActiveDurationRecord(
          metric_name="boss_daily_operator_active_duration",
          active_date=date(2026, 5, 17),
          operator_id="op_daily",
          active_minutes=7,
          active_seconds=420,
          first_active_minute=datetime(2026, 5, 17, 1, 8, tzinfo=timezone.utc),
          last_active_minute=datetime(2026, 5, 17, 1, 14, tzinfo=timezone.utc),
          source_minute_count=7,
          source_row_count=9,
        ),
      ],
      clock=fixed_now,
    )

    dashboard = service.dashboard(active_within_minutes=5)
    analytics = service.operator_analytics("op_daily")
    health = service.health()

    self.assertEqual(dashboard.active_count, 1)
    self.assertEqual(dashboard.observed_operator_count, 1)
    self.assertEqual(dashboard.active_operators[0].operator_id, "op_daily")
    self.assertEqual(dashboard.active_operators[0].last_action, "boss_daily_operator_active_duration")
    self.assertEqual(len(dashboard.daily_active_durations), 1)
    self.assertEqual(dashboard.daily_active_durations[0].active_minutes, 7)
    self.assertEqual(analytics.daily_active_duration.active_minutes, 7)
    self.assertEqual(health.daily_summary_record_count, 2)
    self.assertEqual(health.daily_summary_latest_date.isoformat(), "2026-05-17")

  def test_daily_active_duration_falls_back_to_minute_summary_rollup(self):
    service = AnalysisQueryService(
      InMemoryFactStore(),
      minute_summaries=[
        MinuteSummaryRecord(
          metric_name="boss_minute_operator_funnel",
          minute=datetime(2026, 5, 17, 1, 14, tzinfo=timezone.utc),
          operator_id="op_summary",
          card_exposed=3,
          total_events=3,
        ),
        MinuteSummaryRecord(
          metric_name="boss_minute_chat",
          minute=datetime(2026, 5, 17, 1, 14, tzinfo=timezone.utc),
          operator_id="op_summary",
          chat_opened=1,
          chat_events=1,
        ),
        MinuteSummaryRecord(
          metric_name="boss_minute_operator_funnel",
          minute=datetime(2026, 5, 17, 1, 15, tzinfo=timezone.utc),
          operator_id="op_summary",
          detail_opened=1,
          total_events=1,
        ),
      ],
      clock=fixed_now,
    )

    dashboard = service.dashboard(active_within_minutes=5)
    analytics = service.operator_analytics("op_summary")

    self.assertEqual(len(dashboard.daily_active_durations), 1)
    self.assertEqual(dashboard.daily_active_durations[0].active_minutes, 2)
    self.assertEqual(dashboard.daily_active_durations[0].source_row_count, 3)
    self.assertEqual(analytics.daily_active_duration.active_minutes, 2)

  def test_dashboard_applies_configured_operator_display_names(self):
    raw_repository = InMemoryRawEventRepository()
    fact_store = InMemoryFactStore()
    unknown = normalize_cls_event(make_record(
      "evt_recent_raw",
      "candidate_chat.report_required",
      {},
      operator_id="op_raw",
      job_id="job_raw",
      occurred_at="2026-05-17T09:14:00+08:00",
    ))
    raw_repository.save_normalized_event(unknown)
    service = AnalysisQueryService(
      fact_store,
      raw_repository=raw_repository,
      operator_profiles=[
        OperatorProfile(
          operator_id="op_raw",
          display_name="Operator Raw",
          account_name="Account Raw",
        )
      ],
      clock=fixed_now,
    )

    dashboard = service.dashboard(active_within_minutes=5)

    self.assertEqual(dashboard.configured_operators[0].display_name, "Operator Raw")
    self.assertEqual(dashboard.active_operators[0].display_name, "Operator Raw")
    self.assertEqual(dashboard.active_operators[0].account_name, "Account Raw")


if __name__ == "__main__":
  unittest.main()
