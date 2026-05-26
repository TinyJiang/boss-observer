"""Minute summary records produced by CLS scheduled SQL."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime


@dataclass(frozen=True)
class MinuteSummaryRecord:
  """One minute-level aggregate row from a CLS summary topic."""

  metric_name: str
  minute: datetime
  operator_id: str | None = None
  job_id: str | None = None
  job_name: str | None = None
  plugin_version: str | None = None
  raw_operator_id: str | None = None
  card_exposed: int = 0
  detail_opened: int = 0
  greeting_clicked: int = 0
  greeting_succeeded: int = 0
  greeting_failed: int = 0
  chat_opened: int = 0
  chat_snapshots: int = 0
  wechat_captured: int = 0
  report_required: int = 0
  capture_failed: int = 0
  visible_message_count: int = 0
  may_be_incomplete_count: int = 0
  total_events: int = 0
  chat_events: int = 0
  recorded_at: datetime | None = None

  @property
  def event_count(self) -> int:
    explicit = max(self.total_events, self.chat_events)
    if explicit > 0:
      return explicit
    return sum([
      self.card_exposed,
      self.detail_opened,
      self.greeting_clicked,
      self.greeting_succeeded,
      self.greeting_failed,
      self.chat_opened,
      self.chat_snapshots,
      self.wechat_captured,
      self.report_required,
      self.capture_failed,
    ])


@dataclass(frozen=True)
class DailyActiveDurationRecord:
  """One daily operator active-duration snapshot from CLS scheduled SQL."""

  metric_name: str
  active_date: date
  operator_id: str
  active_minutes: int
  active_seconds: int
  first_active_minute: datetime | None = None
  last_active_minute: datetime | None = None
  source_minute_count: int = 0
  source_row_count: int = 0
  recorded_at: datetime | None = None


@dataclass(frozen=True)
class DailyBasicStatsRecord:
  """One daily operator basic-stat snapshot from the CLS log topic."""

  metric_name: str
  active_date: date
  operator_id: str
  operator_account_name: str | None = None
  boss_account_name: str | None = None
  boss_account_matched: str | None = None
  first_active_minute: datetime | None = None
  last_active_minute: datetime | None = None
  active_minutes: int = 0
  active_seconds: int = 0
  observed_minutes: int = 0
  session_count: int = 0
  touched_job_count: int = 0
  plugin_started: int = 0
  boss_page_entered: int = 0
  boss_page_left: int = 0
  page_changed: int = 0
  plugin_exception: int = 0
  job_context_detected: int = 0
  job_context_changed: int = 0
  filter_panel_opened: int = 0
  filter_applied: int = 0
  card_exposed: int = 0
  detail_opened: int = 0
  detail_closed: int = 0
  greeting_clicked: int = 0
  greeting_succeeded: int = 0
  greeting_failed: int = 0
  chat_opened: int = 0
  snapshot_captured: int = 0
  wechat_captured: int = 0
  capture_failed: int = 0
  card_unique_candidates: int = 0
  detail_unique_candidates: int = 0
  greeting_unique_candidates: int = 0
  chat_unique_candidates: int = 0
  wechat_unique_candidates: int = 0
  visible_message_count: int = 0
  may_be_incomplete_count: int = 0
  first_round_candidate_initiated_count: int = 0
  first_round_boss_replied_count: int = 0
  first_round_boss_reply_elapsed_median_ms: int = 0
  first_round_boss_reply_elapsed_avg_ms: int = 0
  chat_conversation_count: int = 0
  boss_ended_conversation_count: int = 0
  boss_reply_count: int = 0
  boss_reply_elapsed_median_ms: int = 0
  boss_reply_elapsed_avg_ms: int = 0
  detail_duration_ms: int = 0
  greeting_result_elapsed_ms: int = 0
  total_events: int = 0
  source_row_count: int = 0
  recorded_at: datetime | None = None
  has_values: bool = True
  value_status: str = "ok"


@dataclass(frozen=True)
class LogQualitySummaryRecord:
  """One 10-minute log-quality aggregate row from CLS scheduled SQL."""

  metric_name: str
  window_start: datetime
  window_minutes: int = 10
  plugin_version: str | None = None
  event_type: str | None = None
  operator_id: str | None = None
  raw_operator_id: str | None = None
  page_type: str | None = None
  job_id: str | None = None
  raw_event_count: int = 0
  checked_event_count: int = 0
  missing_event_id_count: int = 0
  missing_operator_count: int = 0
  missing_plugin_version_count: int = 0
  missing_session_count: int = 0
  missing_context_count: int = 0
  payload_missing_count: int = 0
  card_required_field_missing_count: int = 0
  card_profile_core_missing_count: int = 0
  card_identity_low_confidence_count: int = 0
  detail_required_field_missing_count: int = 0
  detail_card_link_hint_missing_count: int = 0
  detail_close_opened_link_missing_count: int = 0
  greeting_required_field_missing_count: int = 0
  greeting_source_link_hint_missing_count: int = 0
  greeting_result_click_link_missing_count: int = 0
  chat_candidate_missing_count: int = 0
  chat_candidate_low_confidence_count: int = 0
  chat_conversation_key_missing_count: int = 0
  chat_message_quality_issue_count: int = 0
  chat_message_count_missing_count: int = 0
  chat_message_fingerprint_missing_count: int = 0
  chat_snapshot_completeness_missing_count: int = 0
  sensitive_leak_signal_count: int = 0
  source_row_count: int = 0
  recorded_at: datetime | None = None
