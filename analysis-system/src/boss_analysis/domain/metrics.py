"""Query and aggregation result models."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from boss_analysis.domain.operators import OperatorProfile
from boss_analysis.domain.summary import DailyActiveDurationRecord, DailyBasicStatsRecord


@dataclass(frozen=True)
class ActiveOperatorSummary:
  operator_id: str
  last_active_at: datetime
  minutes_since_active: int
  last_action: str
  job_id: str | None
  job_name: str | None = None
  display_name: str | None = None
  account_name: str | None = None


@dataclass(frozen=True)
class DashboardSummary:
  active_count: int
  active_operators: tuple[ActiveOperatorSummary, ...]
  observed_operator_count: int
  generated_at: datetime
  configured_operators: tuple[OperatorProfile, ...] = ()
  daily_active_durations: tuple[DailyActiveDurationRecord, ...] = ()


@dataclass(frozen=True)
class FunnelSummary:
  card_exposed: int = 0
  detail_opened: int = 0
  greeting_clicked: int = 0
  greeting_succeeded: int = 0
  greeting_failed: int = 0
  chat_opened: int = 0
  chat_snapshots: int = 0
  wechat_captured: int = 0


@dataclass(frozen=True)
class ChatSummary:
  chat_opened: int = 0
  snapshot_captured: int = 0
  wechat_captured: int = 0
  capture_failed: int = 0
  visible_message_count: int = 0
  may_be_incomplete_count: int = 0


@dataclass(frozen=True)
class OperatorMinutePoint:
  minute: datetime
  card_exposed: int = 0
  detail_opened: int = 0
  greeting_clicked: int = 0
  greeting_succeeded: int = 0
  chat_opened: int = 0
  chat_snapshots: int = 0
  wechat_captured: int = 0
  capture_failed: int = 0
  event_count: int = 0


@dataclass(frozen=True)
class OperatorAnalytics:
  operator_id: str
  funnel: FunnelSummary
  chat: ChatSummary
  job_ids: tuple[str, ...]
  minute_points: tuple[OperatorMinutePoint, ...] = ()
  daily_active_duration: DailyActiveDurationRecord | None = None
  plugin_version: str | None = None
  plugin_version_observed_at: datetime | None = None


@dataclass(frozen=True)
class LogQualityIssueCounter:
  key: str
  label: str
  count: int


@dataclass(frozen=True)
class LogQualityVersionSummary:
  plugin_version: str
  status: str
  raw_event_count: int
  checked_event_count: int
  finding_count: int
  finding_rate: float
  affected_event_type_count: int
  latest_window_start: datetime | None = None
  top_issues: tuple[LogQualityIssueCounter, ...] = ()


@dataclass(frozen=True)
class LogQualityEventSummary:
  plugin_version: str
  event_type: str
  status: str
  raw_event_count: int
  checked_event_count: int
  finding_count: int
  finding_rate: float
  latest_window_start: datetime | None = None
  top_issues: tuple[LogQualityIssueCounter, ...] = ()


@dataclass(frozen=True)
class LogQualityQueryResult:
  status: str
  operator_id: str | None
  plugin_version: str | None
  source_record_count: int
  record_count: int
  latest_window_start: datetime | None
  window_minutes: int
  raw_event_count: int
  checked_event_count: int
  finding_count: int
  finding_rate: float
  missing_operator_count: int
  sensitive_leak_signal_count: int
  version_summaries: tuple[LogQualityVersionSummary, ...] = ()
  event_summaries: tuple[LogQualityEventSummary, ...] = ()


@dataclass(frozen=True)
class HistoryQueryResult:
  status: str
  operator_id: str | None
  active_date: date | None
  source_record_count: int
  record_count: int
  latest_active_date: date | None = None
  latest_recorded_at: datetime | None = None
  records: tuple[DailyBasicStatsRecord, ...] = ()


@dataclass(frozen=True)
class HealthSummary:
  status: str = "unknown"
  raw_event_count: int = 0
  parse_error_count: int = 0
  projection_error_count: int = 0
  unknown_event_type_count: int = 0
  summary_record_count: int = 0
  summary_missing_operator_count: int = 0
  summary_latest_minute: datetime | None = None
  daily_summary_record_count: int = 0
  daily_summary_latest_date: date | None = None
  log_quality_status: str = "unknown"
  log_quality_record_count: int = 0
  log_quality_latest_window_start: datetime | None = None
  log_quality_window_minutes: int = 10
  log_quality_raw_event_count: int = 0
  log_quality_checked_event_count: int = 0
  log_quality_finding_count: int = 0
  log_quality_finding_rate: float = 0.0
  log_quality_missing_operator_count: int = 0
  log_quality_sensitive_leak_signal_count: int = 0
  log_quality_version_summaries: tuple[LogQualityVersionSummary, ...] = ()
  log_quality_event_summaries: tuple[LogQualityEventSummary, ...] = ()
