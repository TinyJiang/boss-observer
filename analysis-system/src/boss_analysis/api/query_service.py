"""Read-only query service over projected facts."""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from boss_analysis.domain import (
  ActiveOperatorSummary,
  ChatSummary,
  DailyActiveDurationRecord,
  DashboardSummary,
  FunnelSummary,
  HealthSummary,
  LogQualityEventSummary,
  LogQualityIssueCounter,
  LogQualityQueryResult,
  LogQualitySummaryRecord,
  LogQualityVersionSummary,
  MinuteSummaryRecord,
  OperatorAnalytics,
  OperatorMinutePoint,
  OperatorProfile,
  RawEventRepository,
)
from boss_analysis.storage import InMemoryFactStore
from boss_analysis.workers.fact_projector import SUPPORTED_EVENT_TYPES


class AnalysisQueryService:
  """Provides stable query results before an HTTP API is introduced."""

  def __init__(
    self,
    fact_store: InMemoryFactStore,
    *,
    raw_repository: RawEventRepository | None = None,
    minute_summaries: tuple[MinuteSummaryRecord, ...] | list[MinuteSummaryRecord] | None = None,
    daily_active_durations: tuple[DailyActiveDurationRecord, ...] | list[DailyActiveDurationRecord] | None = None,
    log_quality_summaries: tuple[LogQualitySummaryRecord, ...] | list[LogQualitySummaryRecord] | None = None,
    operator_profiles: tuple[OperatorProfile, ...] | list[OperatorProfile] | None = None,
    clock=None,
  ) -> None:
    self._fact_store = fact_store
    self._raw_repository = raw_repository
    self._minute_summaries = tuple(minute_summaries or ())
    self._daily_active_durations = tuple(daily_active_durations or ())
    self._log_quality_summaries = tuple(log_quality_summaries or ())
    self._operator_profiles = tuple(operator_profiles or ())
    self._profiles_by_id = {profile.operator_id: profile for profile in self._operator_profiles}
    self._clock = clock or _utc_now

  def dashboard(self, *, active_within_minutes: int = 15) -> DashboardSummary:
    now = self._clock()
    latest_by_operator: dict[str, tuple[datetime, str, str | None]] = {}
    observed_operators: set[str] = set()
    daily_durations = self._latest_daily_active_durations()

    for occurred_at, operator_id, action, job_id in self._iter_operator_activity():
      if operator_id is None:
        continue
      observed_operators.add(operator_id)
      if occurred_at is None:
        continue
      existing = latest_by_operator.get(operator_id)
      if existing is None or occurred_at > existing[0]:
        latest_by_operator[operator_id] = (occurred_at, action, job_id)

    active: list[ActiveOperatorSummary] = []
    for operator_id, (last_active_at, action, job_id) in latest_by_operator.items():
      minutes_since = max(0, int((now - last_active_at).total_seconds() // 60))
      if minutes_since <= active_within_minutes:
        profile = self._profiles_by_id.get(operator_id)
        active.append(ActiveOperatorSummary(
          operator_id=operator_id,
          last_active_at=last_active_at,
          minutes_since_active=minutes_since,
          last_action=action,
          job_id=job_id,
          display_name=profile.display_name if profile is not None else None,
          account_name=profile.account_name if profile is not None else None,
        ))

    active.sort(key=lambda item: (item.minutes_since_active, item.operator_id))
    return DashboardSummary(
      active_count=len(active),
      active_operators=tuple(active),
      observed_operator_count=len(observed_operators),
      generated_at=now,
      configured_operators=tuple(
        profile for profile in self._operator_profiles
        if profile.enabled
      ),
      daily_active_durations=daily_durations,
    )

  def operator_analytics(self, operator_id: str) -> OperatorAnalytics:
    daily_duration = self._daily_active_duration_for_operator(operator_id)
    summary_records = [
      record for record in self._minute_summaries
      if record.operator_id == operator_id
    ]
    if summary_records:
      target_date = (
        daily_duration.active_date
        if daily_duration is not None
        else _latest_local_summary_date(self._minute_summaries)
      )
      summary_records = [
        record for record in summary_records
        if _local_minute_bucket(record.minute).date() == target_date
      ]
    if summary_records:
      return _operator_analytics_from_summaries(operator_id, summary_records, daily_duration=daily_duration)

    exposures = [
      fact for fact in self._fact_store.candidate_exposures()
      if fact.operator_id == operator_id
    ]
    details = [
      fact for fact in self._fact_store.detail_sessions()
      if fact.operator_id == operator_id
    ]
    greetings = [
      fact for fact in self._fact_store.greetings()
      if fact.operator_id == operator_id
    ]
    chats = [
      fact for fact in self._fact_store.chats()
      if fact.operator_id == operator_id
    ]

    funnel = FunnelSummary(
      card_exposed=len(exposures),
      detail_opened=sum(1 for fact in details if fact.opened_at is not None),
      greeting_clicked=sum(1 for fact in greetings if fact.status == "clicked"),
      greeting_succeeded=sum(1 for fact in greetings if fact.status == "succeeded"),
      greeting_failed=sum(1 for fact in greetings if fact.status == "failed"),
      chat_opened=sum(1 for fact in chats if fact.kind == "opened"),
      chat_snapshots=sum(1 for fact in chats if fact.kind == "snapshot_captured"),
      wechat_captured=sum(1 for fact in chats if fact.kind == "wechat_captured"),
    )
    chat = ChatSummary(
      chat_opened=funnel.chat_opened,
      snapshot_captured=funnel.chat_snapshots,
      wechat_captured=funnel.wechat_captured,
      capture_failed=sum(1 for fact in chats if fact.kind == "capture_failed"),
      visible_message_count=sum(fact.message_count or 0 for fact in chats),
      may_be_incomplete_count=sum(1 for fact in chats if fact.may_be_incomplete),
    )
    job_ids = sorted({
      job_id
      for job_id in _all_job_ids(exposures, details, greetings, chats)
      if job_id is not None
    })
    return OperatorAnalytics(
      operator_id=operator_id,
      funnel=funnel,
      chat=chat,
      job_ids=tuple(job_ids),
      daily_active_duration=daily_duration,
    )

  def health(self) -> HealthSummary:
    log_quality_values = _log_quality_health_values(self._log_quality_summaries)
    if self._raw_repository is None:
      return _build_health_summary(
        summary_record_count=len(self._minute_summaries),
        summary_missing_operator_count=self._summary_missing_operator_count(),
        summary_latest_minute=self._summary_latest_minute(),
        daily_summary_record_count=len(self._daily_active_durations),
        daily_summary_latest_date=self._daily_summary_latest_date(),
        **log_quality_values,
      )

    raw_events = self._raw_repository.replay_raw_events()
    errors = self._raw_repository.list_errors()
    parse_error_count = sum(1 for error in errors if error.error_stage == "normalize")
    projection_error_count = sum(1 for error in errors if error.error_stage == "fact_project")
    unknown_event_type_count = sum(
      1
      for record in raw_events
      if record.event_type is not None and record.event_type not in SUPPORTED_EVENT_TYPES
    )
    return _build_health_summary(
      raw_event_count=len(raw_events),
      parse_error_count=parse_error_count,
      projection_error_count=projection_error_count,
      unknown_event_type_count=unknown_event_type_count,
      summary_record_count=len(self._minute_summaries),
      summary_missing_operator_count=self._summary_missing_operator_count(),
      summary_latest_minute=self._summary_latest_minute(),
      daily_summary_record_count=len(self._daily_active_durations),
      daily_summary_latest_date=self._daily_summary_latest_date(),
      **log_quality_values,
    )

  def log_quality(
    self,
    *,
    operator_id: str | None = None,
    plugin_version: str | None = None,
  ) -> LogQualityQueryResult:
    normalized_operator_id = _clean_filter_value(operator_id)
    normalized_plugin_version = _clean_filter_value(plugin_version)
    records = _filter_log_quality_records(
      self._log_quality_summaries,
      operator_id=normalized_operator_id,
      plugin_version=normalized_plugin_version,
    )
    values = _log_quality_health_values(records)
    return LogQualityQueryResult(
      status=str(values["log_quality_status"]),
      operator_id=normalized_operator_id,
      plugin_version=normalized_plugin_version,
      source_record_count=len(self._log_quality_summaries),
      record_count=int(values["log_quality_record_count"]),
      latest_window_start=values["log_quality_latest_window_start"],
      window_minutes=int(values["log_quality_window_minutes"]),
      raw_event_count=int(values["log_quality_raw_event_count"]),
      checked_event_count=int(values["log_quality_checked_event_count"]),
      finding_count=int(values["log_quality_finding_count"]),
      finding_rate=float(values["log_quality_finding_rate"]),
      missing_operator_count=int(values["log_quality_missing_operator_count"]),
      sensitive_leak_signal_count=int(values["log_quality_sensitive_leak_signal_count"]),
      version_summaries=values["log_quality_version_summaries"],
      event_summaries=values["log_quality_event_summaries"],
    )

  def _iter_operator_activity(self):
    for record in self._latest_daily_active_durations():
      if record.last_active_minute is not None and record.active_minutes > 0:
        yield record.last_active_minute, record.operator_id, record.metric_name, None
    for record in self._minute_summaries:
      if record.operator_id is not None and record.event_count > 0:
        yield record.minute, record.operator_id, record.metric_name, record.job_id
    if self._raw_repository is not None:
      for record in self._raw_repository.replay_raw_events():
        if record.operator_id is not None:
          yield record.occurred_at, record.operator_id, record.event_type or "unknown_event", record.job_id
    for fact in self._fact_store.candidate_exposures():
      yield fact.occurred_at, fact.operator_id, "candidate_list.card_exposed", fact.job_id
    for fact in self._fact_store.detail_sessions():
      if fact.opened_at is not None:
        yield fact.opened_at, fact.operator_id, "candidate_detail.opened", fact.job_id
      if fact.closed_at is not None:
        yield fact.closed_at, fact.operator_id, "candidate_detail.closed", fact.job_id
    for fact in self._fact_store.greetings():
      yield fact.occurred_at, fact.operator_id, f"candidate_greeting.{fact.status}", fact.job_id
    for fact in self._fact_store.chats():
      yield fact.occurred_at, fact.operator_id, f"candidate_chat.{fact.kind}", fact.job_id

  def _summary_missing_operator_count(self) -> int:
    return sum(
      1
      for record in self._minute_summaries
      if record.raw_operator_id is not None and record.operator_id is None
    )

  def _summary_latest_minute(self) -> datetime | None:
    return max(
      (record.minute for record in self._minute_summaries),
      default=None,
    )

  def _daily_summary_latest_date(self) -> date | None:
    return max(
      (record.active_date for record in self._daily_active_durations),
      default=None,
    )

  def _daily_active_duration_for_operator(self, operator_id: str) -> DailyActiveDurationRecord | None:
    return next(
      (
        record for record in self._latest_daily_active_durations()
        if record.operator_id == operator_id
      ),
      None,
    )

  def _latest_daily_active_durations(self) -> tuple[DailyActiveDurationRecord, ...]:
    if self._daily_active_durations:
      return _latest_daily_records(self._daily_active_durations)
    return _derive_latest_daily_records_from_minutes(self._minute_summaries)


def _all_job_ids(*groups):
  for group in groups:
    for fact in group:
      yield fact.job_id


def _utc_now() -> datetime:
  return datetime.now(timezone.utc)


LOG_QUALITY_ISSUE_COUNTERS: tuple[tuple[str, str], ...] = (
  ("missing_event_id_count", "缺事件 ID"),
  ("missing_operator_count", "缺操作员"),
  ("missing_plugin_version_count", "缺插件版本"),
  ("missing_session_count", "缺会话"),
  ("missing_context_count", "缺上下文"),
  ("payload_missing_count", "缺 payload"),
  ("card_required_field_missing_count", "卡片关键字段缺失"),
  ("card_profile_core_missing_count", "卡片核心资料缺失"),
  ("card_identity_low_confidence_count", "卡片身份低置信"),
  ("detail_required_field_missing_count", "详情关键字段缺失"),
  ("detail_card_link_hint_missing_count", "详情缺曝光回连线索"),
  ("detail_close_opened_link_missing_count", "详情关闭缺打开事件"),
  ("greeting_required_field_missing_count", "招呼关键字段缺失"),
  ("greeting_source_link_hint_missing_count", "招呼缺来源回连线索"),
  ("greeting_result_click_link_missing_count", "招呼结果缺点击事件"),
  ("chat_candidate_missing_count", "聊天缺候选人身份"),
  ("chat_candidate_low_confidence_count", "聊天候选人低置信"),
  ("chat_conversation_key_missing_count", "聊天缺会话键"),
  ("chat_message_quality_issue_count", "聊天消息结构异常"),
  ("chat_message_count_missing_count", "聊天消息数缺失"),
  ("chat_message_fingerprint_missing_count", "聊天消息指纹缺失"),
  ("chat_snapshot_completeness_missing_count", "聊天快照完整性缺失"),
  ("sensitive_leak_signal_count", "敏感文本泄露信号"),
)

CRITICAL_LOG_QUALITY_COUNTERS = {
  "missing_event_id_count",
  "missing_operator_count",
  "sensitive_leak_signal_count",
}


def _build_health_summary(**values) -> HealthSummary:
  status = _overall_health_status(values)
  return HealthSummary(status=status, **values)


def _overall_health_status(values: dict[str, object]) -> str:
  log_quality_status = values.get("log_quality_status")
  if log_quality_status == "critical":
    return "critical"
  if int(values.get("summary_missing_operator_count") or 0) > 0:
    return "critical"
  warning_count = (
    int(values.get("parse_error_count") or 0)
    + int(values.get("projection_error_count") or 0)
    + int(values.get("unknown_event_type_count") or 0)
  )
  if log_quality_status == "warning" or warning_count > 0:
    return "warning"
  observed_count = (
    int(values.get("raw_event_count") or 0)
    + int(values.get("summary_record_count") or 0)
    + int(values.get("daily_summary_record_count") or 0)
    + int(values.get("log_quality_record_count") or 0)
  )
  if observed_count == 0:
    return "unknown"
  if log_quality_status == "unknown":
    return "unknown"
  return "ok"


def _log_quality_health_values(records: tuple[LogQualitySummaryRecord, ...]) -> dict[str, object]:
  if not records:
    return {
      "log_quality_status": "unknown",
      "log_quality_record_count": 0,
      "log_quality_latest_window_start": None,
      "log_quality_window_minutes": 10,
      "log_quality_raw_event_count": 0,
      "log_quality_checked_event_count": 0,
      "log_quality_finding_count": 0,
      "log_quality_finding_rate": 0.0,
      "log_quality_missing_operator_count": 0,
      "log_quality_sensitive_leak_signal_count": 0,
      "log_quality_version_summaries": (),
      "log_quality_event_summaries": (),
    }

  raw_event_count = sum(record.raw_event_count for record in records)
  checked_event_count = sum(_checked_event_count(record) for record in records)
  finding_count = sum(_log_quality_issue_count(record) for record in records)
  critical_finding_count = sum(_log_quality_critical_issue_count(record) for record in records)
  latest_window_start = max((record.window_start for record in records), default=None)
  window_minutes = max((record.window_minutes for record in records), default=10)
  event_summaries = _log_quality_event_summaries(records)
  version_summaries = _log_quality_version_summaries(records)
  return {
    "log_quality_status": _quality_status(checked_event_count, finding_count, critical_finding_count),
    "log_quality_record_count": len(records),
    "log_quality_latest_window_start": latest_window_start,
    "log_quality_window_minutes": window_minutes,
    "log_quality_raw_event_count": raw_event_count,
    "log_quality_checked_event_count": checked_event_count,
    "log_quality_finding_count": finding_count,
    "log_quality_finding_rate": _rate(finding_count, checked_event_count),
    "log_quality_missing_operator_count": sum(record.missing_operator_count for record in records),
    "log_quality_sensitive_leak_signal_count": sum(record.sensitive_leak_signal_count for record in records),
    "log_quality_version_summaries": version_summaries,
    "log_quality_event_summaries": event_summaries,
  }


def _filter_log_quality_records(
  records: tuple[LogQualitySummaryRecord, ...],
  *,
  operator_id: str | None,
  plugin_version: str | None,
) -> tuple[LogQualitySummaryRecord, ...]:
  if operator_id is None and plugin_version is None:
    return records
  return tuple(
    record for record in records
    if (
      operator_id is None
      or record.operator_id == operator_id
      or record.raw_operator_id == operator_id
    )
    and (
      plugin_version is None
      or record.plugin_version == plugin_version
    )
  )


def _log_quality_version_summaries(
  records: tuple[LogQualitySummaryRecord, ...],
) -> tuple[LogQualityVersionSummary, ...]:
  grouped: dict[str, list[LogQualitySummaryRecord]] = {}
  for record in records:
    grouped.setdefault(_display_dimension(record.plugin_version), []).append(record)
  summaries = [
    _build_log_quality_version_summary(plugin_version, group)
    for plugin_version, group in grouped.items()
  ]
  return tuple(sorted(
    summaries,
    key=lambda item: (_status_rank(item.status), -item.finding_count, item.plugin_version),
  ))


def _build_log_quality_version_summary(
  plugin_version: str,
  records: list[LogQualitySummaryRecord],
) -> LogQualityVersionSummary:
  raw_event_count = sum(record.raw_event_count for record in records)
  checked_event_count = sum(_checked_event_count(record) for record in records)
  finding_count = sum(_log_quality_issue_count(record) for record in records)
  critical_finding_count = sum(_log_quality_critical_issue_count(record) for record in records)
  return LogQualityVersionSummary(
    plugin_version=plugin_version,
    status=_quality_status(checked_event_count, finding_count, critical_finding_count),
    raw_event_count=raw_event_count,
    checked_event_count=checked_event_count,
    finding_count=finding_count,
    finding_rate=_rate(finding_count, checked_event_count),
    affected_event_type_count=len({_display_dimension(record.event_type) for record in records}),
    latest_window_start=max((record.window_start for record in records), default=None),
    top_issues=_top_issue_counters(records, limit=5),
  )


def _log_quality_event_summaries(
  records: tuple[LogQualitySummaryRecord, ...],
) -> tuple[LogQualityEventSummary, ...]:
  grouped: dict[tuple[str, str], list[LogQualitySummaryRecord]] = {}
  for record in records:
    key = (_display_dimension(record.plugin_version), _display_dimension(record.event_type))
    grouped.setdefault(key, []).append(record)

  summaries: list[LogQualityEventSummary] = []
  for (plugin_version, event_type), group in grouped.items():
    checked_event_count = sum(_checked_event_count(record) for record in group)
    finding_count = sum(_log_quality_issue_count(record) for record in group)
    if checked_event_count == 0 and finding_count == 0:
      continue
    critical_finding_count = sum(_log_quality_critical_issue_count(record) for record in group)
    summaries.append(LogQualityEventSummary(
      plugin_version=plugin_version,
      event_type=event_type,
      status=_quality_status(checked_event_count, finding_count, critical_finding_count),
      raw_event_count=sum(record.raw_event_count for record in group),
      checked_event_count=checked_event_count,
      finding_count=finding_count,
      finding_rate=_rate(finding_count, checked_event_count),
      latest_window_start=max((record.window_start for record in group), default=None),
      top_issues=_top_issue_counters(group, limit=4),
    ))

  return tuple(sorted(
    summaries,
    key=lambda item: (_status_rank(item.status), -item.finding_count, item.plugin_version, item.event_type),
  )[:12])


def _top_issue_counters(
  records: list[LogQualitySummaryRecord],
  *,
  limit: int,
) -> tuple[LogQualityIssueCounter, ...]:
  counters: list[LogQualityIssueCounter] = []
  for key, label in LOG_QUALITY_ISSUE_COUNTERS:
    count = sum(int(getattr(record, key)) for record in records)
    if count > 0:
      counters.append(LogQualityIssueCounter(key=key, label=label, count=count))
  return tuple(sorted(counters, key=lambda item: (-item.count, item.key))[:limit])


def _log_quality_issue_count(record: LogQualitySummaryRecord) -> int:
  return sum(int(getattr(record, key)) for key, _ in LOG_QUALITY_ISSUE_COUNTERS)


def _log_quality_critical_issue_count(record: LogQualitySummaryRecord) -> int:
  return sum(int(getattr(record, key)) for key in CRITICAL_LOG_QUALITY_COUNTERS)


def _checked_event_count(record: LogQualitySummaryRecord) -> int:
  return record.checked_event_count or record.raw_event_count


def _quality_status(checked_event_count: int, finding_count: int, critical_finding_count: int) -> str:
  if checked_event_count <= 0:
    return "unknown"
  if critical_finding_count > 0:
    return "critical"
  if _rate(finding_count, checked_event_count) >= 0.2:
    return "critical"
  if finding_count > 0:
    return "warning"
  return "ok"


def _rate(numerator: int, denominator: int) -> float:
  if denominator <= 0:
    return 0.0
  return round(numerator / denominator, 4)


def _display_dimension(value: str | None) -> str:
  return value if value else "<missing>"


def _clean_filter_value(value: str | None) -> str | None:
  if value is None:
    return None
  stripped = value.strip()
  if not stripped or stripped in {"*", "all", "__all__"}:
    return None
  return stripped


def _status_rank(status: str) -> int:
  return {
    "critical": 0,
    "warning": 1,
    "unknown": 2,
    "ok": 3,
  }.get(status, 4)


def _operator_analytics_from_summaries(
  operator_id: str,
  records: list[MinuteSummaryRecord],
  *,
  daily_duration: DailyActiveDurationRecord | None = None,
) -> OperatorAnalytics:
  funnel_records = [
    record for record in records
    if record.metric_name == "boss_minute_operator_funnel"
  ]
  chat_records = [
    record for record in records
    if record.metric_name == "boss_minute_chat"
  ]
  funnel_source = funnel_records or records
  chat_source = chat_records or records

  funnel = FunnelSummary(
    card_exposed=sum(record.card_exposed for record in funnel_source),
    detail_opened=sum(record.detail_opened for record in funnel_source),
    greeting_clicked=sum(record.greeting_clicked for record in funnel_source),
    greeting_succeeded=sum(record.greeting_succeeded for record in funnel_source),
    greeting_failed=sum(record.greeting_failed for record in funnel_source),
    chat_opened=sum(record.chat_opened for record in funnel_source),
    chat_snapshots=sum(record.chat_snapshots for record in funnel_source),
    wechat_captured=sum(record.wechat_captured for record in funnel_source),
  )
  chat = ChatSummary(
    chat_opened=sum(record.chat_opened for record in chat_source),
    snapshot_captured=sum(record.chat_snapshots for record in chat_source),
    wechat_captured=sum(record.wechat_captured for record in chat_source),
    capture_failed=sum(record.capture_failed for record in chat_source),
    visible_message_count=sum(record.visible_message_count for record in chat_source),
    may_be_incomplete_count=sum(record.may_be_incomplete_count for record in chat_source),
  )
  job_ids = sorted({
    record.job_id
    for record in records
    if record.job_id is not None
  })
  return OperatorAnalytics(
    operator_id=operator_id,
    funnel=funnel,
    chat=chat,
    job_ids=tuple(job_ids),
    minute_points=_minute_points_from_summaries(records),
    daily_active_duration=daily_duration,
  )


def _daily_record_is_newer(
  candidate: DailyActiveDurationRecord,
  existing: DailyActiveDurationRecord,
) -> bool:
  if candidate.recorded_at is not None and existing.recorded_at is not None:
    return candidate.recorded_at > existing.recorded_at
  if candidate.recorded_at is not None:
    return True
  if existing.recorded_at is not None:
    return False
  if candidate.last_active_minute is not None and existing.last_active_minute is not None:
    if candidate.last_active_minute != existing.last_active_minute:
      return candidate.last_active_minute > existing.last_active_minute
  if candidate.last_active_minute is not None and existing.last_active_minute is None:
    return True
  if existing.last_active_minute is not None and candidate.last_active_minute is None:
    return False
  return candidate.active_minutes > existing.active_minutes


def _latest_daily_records(
  records: tuple[DailyActiveDurationRecord, ...],
) -> tuple[DailyActiveDurationRecord, ...]:
  latest_date = max(
    (record.active_date for record in records),
    default=None,
  )
  if latest_date is None:
    return ()
  by_operator: dict[str, DailyActiveDurationRecord] = {}
  for record in records:
    if record.active_date != latest_date:
      continue
    existing = by_operator.get(record.operator_id)
    if existing is None or _daily_record_is_newer(record, existing):
      by_operator[record.operator_id] = record
  return tuple(
    by_operator[operator_id]
    for operator_id in sorted(by_operator)
  )


def _derive_latest_daily_records_from_minutes(
  records: tuple[MinuteSummaryRecord, ...],
) -> tuple[DailyActiveDurationRecord, ...]:
  buckets: dict[tuple[date, str, datetime], int] = {}
  for record in records:
    if record.operator_id is None or record.event_count <= 0:
      continue
    minute_bucket = _local_minute_bucket(record.minute)
    buckets[(minute_bucket.date(), record.operator_id, minute_bucket)] = (
      buckets.get((minute_bucket.date(), record.operator_id, minute_bucket), 0) + 1
    )
  if not buckets:
    return ()

  latest_date = max(key[0] for key in buckets)
  by_operator: dict[str, dict[str, object]] = {}
  for (active_date, operator_id, minute_bucket), source_rows in buckets.items():
    if active_date != latest_date:
      continue
    values = by_operator.setdefault(operator_id, {
      "minutes": [],
      "source_row_count": 0,
    })
    values["minutes"].append(minute_bucket)
    values["source_row_count"] += source_rows

  derived: list[DailyActiveDurationRecord] = []
  for operator_id, values in by_operator.items():
    minutes = sorted(values["minutes"])
    active_minutes = len(minutes)
    derived.append(DailyActiveDurationRecord(
      metric_name="boss_daily_operator_active_duration",
      active_date=latest_date,
      operator_id=operator_id,
      active_minutes=active_minutes,
      active_seconds=active_minutes * 60,
      first_active_minute=minutes[0] if minutes else None,
      last_active_minute=minutes[-1] if minutes else None,
      source_minute_count=active_minutes,
      source_row_count=int(values["source_row_count"]),
    ))
  return tuple(sorted(derived, key=lambda record: record.operator_id))


def _latest_local_summary_date(records: tuple[MinuteSummaryRecord, ...]) -> date | None:
  return max(
    (_local_minute_bucket(record.minute).date() for record in records if record.operator_id is not None),
    default=None,
  )


def _local_minute_bucket(value: datetime) -> datetime:
  if value.tzinfo is None:
    value = value.replace(tzinfo=timezone.utc)
  try:
    local_tz = ZoneInfo("Asia/Shanghai")
  except ZoneInfoNotFoundError:
    local_tz = timezone.utc
  local = value.astimezone(local_tz)
  return local.replace(second=0, microsecond=0)


def _minute_points_from_summaries(
  records: list[MinuteSummaryRecord],
) -> tuple[OperatorMinutePoint, ...]:
  by_minute: dict[datetime, dict[str, int]] = {}
  has_chat_records = any(
    record.metric_name == "boss_minute_chat"
    for record in records
  )
  for record in records:
    values = by_minute.setdefault(record.minute, {
      "card_exposed": 0,
      "detail_opened": 0,
      "greeting_clicked": 0,
      "greeting_succeeded": 0,
      "chat_opened": 0,
      "chat_snapshots": 0,
      "wechat_captured": 0,
      "capture_failed": 0,
      "event_count": 0,
    })
    if record.metric_name == "boss_minute_chat":
      values["chat_opened"] += record.chat_opened
      values["chat_snapshots"] += record.chat_snapshots
      values["wechat_captured"] += record.wechat_captured
      values["capture_failed"] += record.capture_failed
    else:
      values["card_exposed"] += record.card_exposed
      values["detail_opened"] += record.detail_opened
      values["greeting_clicked"] += record.greeting_clicked
      values["greeting_succeeded"] += record.greeting_succeeded
      if not has_chat_records:
        values["chat_opened"] += record.chat_opened
        values["chat_snapshots"] += record.chat_snapshots
        values["wechat_captured"] += record.wechat_captured
        values["capture_failed"] += record.capture_failed
    values["event_count"] += record.event_count

  return tuple(
    OperatorMinutePoint(minute=minute, **by_minute[minute])
    for minute in sorted(by_minute)
  )
