"""Daily operator analysis packet builders.

Responsibilities:
- prepare local volatility metrics as observations only
- collect stable evidence items for model analysis
- keep attribution, confidence, and recommendations under model output
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, is_dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from boss_analysis.domain.operators import OperatorProfile


class DailyAnalysisResultNotFound(FileNotFoundError):
  """Raised when an offline daily analysis result does not exist."""


@dataclass(frozen=True)
class VolatilityMetric:
  evidence_id: str
  metric_key: str
  metric_label: str
  baseline_key: str
  baseline_label: str
  current_value: float
  baseline_value: float
  delta: float
  percent_change: float | None
  direction: str
  sample_size: int
  note: str | None = None
  evidence_refs: tuple[str, ...] = ()

  def as_dict(self) -> dict[str, Any]:
    return _jsonable(self)


@dataclass(frozen=True)
class EvidenceItem:
  evidence_id: str
  category: str
  title: str
  source: str
  values: dict[str, Any]
  operator_id: str | None = None
  job_key: str | None = None
  recorded_at: datetime | None = None

  def as_dict(self) -> dict[str, Any]:
    return _jsonable(self)


@dataclass(frozen=True)
class EvidenceBundle:
  operator_results: tuple[EvidenceItem, ...] = ()
  job_results: tuple[EvidenceItem, ...] = ()
  behavior_summaries: tuple[EvidenceItem, ...] = ()
  job_actions: tuple[EvidenceItem, ...] = ()

  def as_dict(self) -> dict[str, Any]:
    return _jsonable(self)


@dataclass(frozen=True)
class DataQuality:
  missing_fields: tuple[str, ...] = ()
  unmatched_jobs: tuple[str, ...] = ()
  low_sample_warnings: tuple[str, ...] = ()

  def as_dict(self) -> dict[str, Any]:
    return _jsonable(self)


@dataclass(frozen=True)
class ModelAttribution:
  rank: int
  cause: str
  confidence: str
  reasoning: str
  evidence_refs: tuple[str, ...] = ()
  data_gaps: tuple[str, ...] = ()
  recommended_actions: tuple[str, ...] = ()

  def as_dict(self) -> dict[str, Any]:
    return _jsonable(self)


@dataclass(frozen=True)
class ModelAnalysis:
  summary: str
  generated_at: datetime
  analyzer: str = "mock_codex_analysis"
  attributions: tuple[ModelAttribution, ...] = ()
  questions_for_next_collection: tuple[str, ...] = ()

  def as_dict(self) -> dict[str, Any]:
    return _jsonable(self)


@dataclass(frozen=True)
class DailyAnalysisPayload:
  status: str
  analysis_date: date
  generated_at: datetime
  scope: dict[str, Any]
  sync_state: dict[str, Any]
  volatility_metrics: tuple[VolatilityMetric, ...]
  evidence_bundle: EvidenceBundle
  model_analysis: ModelAnalysis
  data_quality: DataQuality
  errors: tuple[str, ...] = ()

  def as_dict(self) -> dict[str, Any]:
    return _jsonable(self)


def load_daily_analysis_result(
  *,
  analysis_date: date,
  operator_id: str | None = None,
  result_file: str | Path | None = None,
  results_dir: str | Path | None = None,
) -> dict[str, Any]:
  """Read a precomputed daily-analysis result from disk."""

  candidates = _daily_analysis_result_candidates(
    analysis_date=analysis_date,
    operator_id=operator_id,
    result_file=result_file,
    results_dir=results_dir,
  )
  for path in candidates:
    if not path.exists():
      continue
    payload = _read_daily_analysis_result_file(path)
    _validate_daily_analysis_result(
      payload,
      analysis_date=analysis_date,
      operator_id=operator_id,
      path=path,
    )
    return payload
  searched = ", ".join(str(path) for path in candidates) or "<no path configured>"
  raise DailyAnalysisResultNotFound(
    f"Daily analysis result not found for {analysis_date.isoformat()}"
    f"{f' operator {operator_id}' if operator_id else ''}. Searched: {searched}"
  )


def _daily_analysis_result_candidates(
  *,
  analysis_date: date,
  operator_id: str | None,
  result_file: str | Path | None,
  results_dir: str | Path | None,
) -> tuple[Path, ...]:
  candidates: list[Path] = []
  if result_file is not None:
    candidates.append(Path(result_file))
  if results_dir is not None:
    base = Path(results_dir)
    date_text = analysis_date.isoformat()
    if operator_id:
      encoded_operator_id = quote(operator_id, safe="")
      candidates.extend((
        base / date_text / f"{encoded_operator_id}.json",
        base / f"{date_text}__{encoded_operator_id}.json",
      ))
    else:
      candidates.extend((
        base / f"{date_text}.json",
        base / date_text / "all.json",
        base / f"{date_text}__all.json",
      ))
  return tuple(dict.fromkeys(candidates))


def _read_daily_analysis_result_file(path: Path) -> dict[str, Any]:
  try:
    payload = json.loads(path.read_text(encoding="utf-8"))
  except json.JSONDecodeError as error:
    raise ValueError(f"Daily analysis result is not valid JSON: {path}") from error
  if not isinstance(payload, dict):
    raise ValueError(f"Daily analysis result must be a JSON object: {path}")
  return payload


def _validate_daily_analysis_result(
  payload: dict[str, Any],
  *,
  analysis_date: date,
  operator_id: str | None,
  path: Path,
) -> None:
  expected_date = analysis_date.isoformat()
  if payload.get("analysis_date") != expected_date:
    raise ValueError(
      f"Daily analysis result date mismatch in {path}: "
      f"expected {expected_date}, got {payload.get('analysis_date')!r}"
    )
  if operator_id:
    scope = payload.get("scope")
    result_operator_id = scope.get("operator_id") if isinstance(scope, dict) else None
    if result_operator_id != operator_id:
      raise ValueError(
        f"Daily analysis result operator mismatch in {path}: "
        f"expected {operator_id}, got {result_operator_id!r}"
      )


OFFICIAL_METRIC_LABELS: dict[str, str] = {
  "boss_view_candidates": "BOSS查看牛人",
  "boss_started_chats": "BOSS发起聊天",
  "boss_communication_count": "BOSS沟通",
  "candidate_view_boss": "牛人查看BOSS",
  "candidate_started_chats": "牛人发起聊天",
  "resume_received": "收获简历",
  "phone_wechat_exchanged": "交换电话微信",
  "interview_accepted": "接受面试",
}

BASELINES: tuple[tuple[str, str], ...] = (
  ("vs_yesterday", "较昨日"),
  ("vs_same_weekday", "较上周同日"),
  ("vs_7d_avg", "较7日均值"),
  ("vs_14d_avg", "较14日均值"),
)


def build_daily_analysis_payload(
  *,
  analysis_date: date,
  operator_profiles: tuple[OperatorProfile, ...] | list[OperatorProfile],
  operator_id: str | None = None,
  generated_at: datetime | None = None,
) -> DailyAnalysisPayload:
  generated = generated_at or datetime.now(timezone.utc)
  selected_profiles = _select_profiles(operator_profiles, operator_id)
  scope = _build_scope(selected_profiles, operator_id)
  operator_rows = tuple(
    _operator_result_item(analysis_date, profile, index)
    for index, profile in enumerate(selected_profiles)
  )
  job_rows = tuple(
    item
    for index, profile in enumerate(selected_profiles)
    for item in _job_result_items(analysis_date, profile, index)
  )
  behavior_rows = tuple(
    _behavior_summary_item(analysis_date, profile, index)
    for index, profile in enumerate(selected_profiles)
  )
  job_actions = tuple(
    item
    for index, profile in enumerate(selected_profiles)
    for item in _job_action_items(analysis_date, profile, index)
  )
  evidence_bundle = EvidenceBundle(
    operator_results=operator_rows,
    job_results=job_rows,
    behavior_summaries=behavior_rows,
    job_actions=job_actions,
  )
  data_quality = DataQuality(
    missing_fields=(
      "job_detail_fields",
      "job_refresh_events",
      "precise_job_id_mapping",
    ),
    unmatched_jobs=tuple(
      f"{item.operator_id}:{item.values.get('job_name')}"
      for item in job_rows
      if item.job_key is not None
    ),
    low_sample_warnings=_low_sample_warnings(operator_rows),
  )
  volatility_metrics = _build_volatility_metrics(evidence_bundle)
  model_analysis = _build_mock_model_analysis(
    generated_at=generated,
    volatility_metrics=volatility_metrics,
    evidence_bundle=evidence_bundle,
    data_quality=data_quality,
  )
  return DailyAnalysisPayload(
    status=_payload_status(operator_rows),
    analysis_date=analysis_date,
    generated_at=generated,
    scope=scope,
    sync_state={
      "official_result_source": "demo_official_result_rows",
      "official_synced_at": generated,
      "behavior_source": "demo_behavior_evidence",
      "model_state": "mock_ready",
    },
    volatility_metrics=volatility_metrics,
    evidence_bundle=evidence_bundle,
    model_analysis=model_analysis,
    data_quality=data_quality,
  )


def _select_profiles(
  profiles: tuple[OperatorProfile, ...] | list[OperatorProfile],
  operator_id: str | None,
) -> tuple[OperatorProfile, ...]:
  enabled_profiles = tuple(profile for profile in profiles if profile.enabled)
  if operator_id:
    existing = tuple(profile for profile in enabled_profiles if profile.operator_id == operator_id)
    if existing:
      return existing
    return (OperatorProfile(operator_id=operator_id, display_name=operator_id, account_name=operator_id),)
  if enabled_profiles:
    return enabled_profiles
  return (OperatorProfile(operator_id="op_demo", display_name="演示操作员", account_name="演示操作员"),)


def _build_scope(
  profiles: tuple[OperatorProfile, ...],
  operator_id: str | None,
) -> dict[str, Any]:
  if operator_id:
    profile = profiles[0]
    return {
      "operator_id": profile.operator_id,
      "display_name": profile.display_name,
      "boss_name": profile.account_name or profile.display_name,
    }
  return {
    "operator_id": None,
    "display_name": "全部操作员",
    "boss_name": "全部操作员",
  }


def _operator_result_item(
  analysis_date: date,
  profile: OperatorProfile,
  index: int,
) -> EvidenceItem:
  current = _operator_current_values(index)
  baselines = _operator_baselines(current, index)
  boss_name = profile.account_name or profile.display_name
  return EvidenceItem(
    evidence_id=f"official:operator:{analysis_date.isoformat()}:{profile.operator_id}",
    category="official_operator_result",
    title=f"{boss_name} 官方单人汇总",
    source="boss_official_result_demo",
    operator_id=profile.operator_id,
    recorded_at=datetime.combine(analysis_date, datetime.min.time(), tzinfo=timezone.utc),
    values={
      "active_date": analysis_date,
      "boss_name": boss_name,
      "display_name": profile.display_name,
      "operator_id": profile.operator_id,
      "current": current,
      "baselines": baselines,
    },
  )


def _job_result_items(
  analysis_date: date,
  profile: OperatorProfile,
  index: int,
) -> tuple[EvidenceItem, ...]:
  boss_name = profile.account_name or profile.display_name
  jobs = (
    ("frontend-engineer", "前端开发工程师", 0.58),
    ("sales-consultant", "销售顾问", 0.42),
  )
  items: list[EvidenceItem] = []
  operator_current = _operator_current_values(index)
  for job_key, job_name, weight in jobs:
    current = {
      key: int(round(value * weight))
      for key, value in operator_current.items()
    }
    items.append(EvidenceItem(
      evidence_id=f"official:job:{analysis_date.isoformat()}:{profile.operator_id}:{job_key}",
      category="official_job_result",
      title=f"{boss_name} / {job_name}",
      source="boss_official_job_result_demo",
      operator_id=profile.operator_id,
      job_key=job_key,
      recorded_at=datetime.combine(analysis_date, datetime.min.time(), tzinfo=timezone.utc),
      values={
        "active_date": analysis_date,
        "job_name": job_name,
        "publisher_boss_name": boss_name,
        "current": current,
      },
    ))
  return tuple(items)


def _behavior_summary_item(
  analysis_date: date,
  profile: OperatorProfile,
  index: int,
) -> EvidenceItem:
  current = _operator_current_values(index)
  detail_opened = int(round(current["boss_view_candidates"] * 0.62))
  greeting_succeeded = max(0, current["boss_started_chats"] - 2)
  return EvidenceItem(
    evidence_id=f"behavior:operator:{analysis_date.isoformat()}:{profile.operator_id}",
    category="behavior_operator_summary",
    title=f"{profile.display_name} 行为窗口汇总",
    source="analysis_system_demo_behavior",
    operator_id=profile.operator_id,
    values={
      "active_date": analysis_date,
      "active_minutes": 182 + index * 17,
      "card_exposed": current["boss_view_candidates"] + 18,
      "detail_opened": detail_opened,
      "greeting_succeeded": greeting_succeeded,
      "chat_opened": current["boss_communication_count"],
      "touched_job_count": 2,
      "timeline_windows": {
        "one_day": {"active_minutes": 182 + index * 17},
        "three_day": {"active_minutes_avg": 174 + index * 11},
        "seven_day": {"active_minutes_avg": 168 + index * 9},
        "fourteen_day": {"active_minutes_avg": 160 + index * 7},
      },
    },
  )


def _job_action_items(
  analysis_date: date,
  profile: OperatorProfile,
  index: int,
) -> tuple[EvidenceItem, ...]:
  return (
    EvidenceItem(
      evidence_id=f"behavior:job-action:{analysis_date.isoformat()}:{profile.operator_id}:frontend-engineer:publish",
      category="job_action",
      title="前端开发工程师 上架动作",
      source="analysis_system_demo_behavior",
      operator_id=profile.operator_id,
      job_key="frontend-engineer",
      values={
        "active_date": analysis_date,
        "job_name": "前端开发工程师",
        "action": "published",
        "count": 1,
        "missing_detail": False,
      },
    ),
    EvidenceItem(
      evidence_id=f"behavior:job-action:{analysis_date.isoformat()}:{profile.operator_id}:sales-consultant:refresh",
      category="job_action",
      title="销售顾问 刷新动作",
      source="analysis_system_demo_behavior",
      operator_id=profile.operator_id,
      job_key="sales-consultant",
      values={
        "active_date": analysis_date,
        "job_name": "销售顾问",
        "action": "refresh_observed",
        "count": index + 1,
        "missing_detail": True,
      },
    ),
  )


def _operator_current_values(index: int) -> dict[str, int]:
  offset = index * 4
  return {
    "boss_view_candidates": 138 + offset * 3,
    "boss_started_chats": 42 + offset,
    "boss_communication_count": 29 + offset,
    "candidate_view_boss": 21 + index * 3,
    "candidate_started_chats": 7 + index,
    "resume_received": 5 + index,
    "phone_wechat_exchanged": 3 + index,
    "interview_accepted": 1 + (index % 2),
  }


def _operator_baselines(current: dict[str, int], index: int) -> dict[str, dict[str, int | float]]:
  return {
    "vs_yesterday": {
      key: max(0, value - (6 if key == "boss_started_chats" else 4 + index))
      for key, value in current.items()
    },
    "vs_same_weekday": {
      key: max(0, value - (3 + index))
      for key, value in current.items()
    },
    "vs_7d_avg": {
      key: round(max(0, value - (5 + index * 0.5)), 2)
      for key, value in current.items()
    },
    "vs_14d_avg": {
      key: round(max(0, value - (8 + index * 0.75)), 2)
      for key, value in current.items()
    },
  }


def _build_volatility_metrics(evidence_bundle: EvidenceBundle) -> tuple[VolatilityMetric, ...]:
  metrics: list[VolatilityMetric] = []
  selected_keys = (
    "boss_started_chats",
    "boss_communication_count",
    "resume_received",
    "phone_wechat_exchanged",
  )
  totals = _operator_totals(evidence_bundle.operator_results)
  for baseline_key, baseline_label in BASELINES:
    baseline_totals = _operator_baseline_totals(evidence_bundle.operator_results, baseline_key)
    for metric_key in selected_keys:
      metrics.append(_volatility_metric(
        metric_key=metric_key,
        metric_label=OFFICIAL_METRIC_LABELS[metric_key],
        baseline_key=baseline_key,
        baseline_label=baseline_label,
        current_value=totals[metric_key],
        baseline_value=baseline_totals[metric_key],
        sample_size=len(evidence_bundle.operator_results),
        evidence_refs=tuple(item.evidence_id for item in evidence_bundle.operator_results),
      ))
  metrics.extend(_funnel_metrics(evidence_bundle, totals))
  return tuple(metrics)


def _operator_totals(operator_results: tuple[EvidenceItem, ...]) -> dict[str, float]:
  totals = {key: 0.0 for key in OFFICIAL_METRIC_LABELS}
  for item in operator_results:
    current = item.values.get("current")
    if not isinstance(current, dict):
      continue
    for key in totals:
      totals[key] += _to_float(current.get(key))
  return totals


def _operator_baseline_totals(
  operator_results: tuple[EvidenceItem, ...],
  baseline_key: str,
) -> dict[str, float]:
  totals = {key: 0.0 for key in OFFICIAL_METRIC_LABELS}
  for item in operator_results:
    baselines = item.values.get("baselines")
    if not isinstance(baselines, dict):
      continue
    values = baselines.get(baseline_key)
    if not isinstance(values, dict):
      continue
    for key in totals:
      totals[key] += _to_float(values.get(key))
  return totals


def _volatility_metric(
  *,
  metric_key: str,
  metric_label: str,
  baseline_key: str,
  baseline_label: str,
  current_value: float,
  baseline_value: float,
  sample_size: int,
  evidence_refs: tuple[str, ...],
  note: str | None = None,
) -> VolatilityMetric:
  delta = round(current_value - baseline_value, 4)
  return VolatilityMetric(
    evidence_id=f"metric:{baseline_key}:{metric_key}",
    metric_key=metric_key,
    metric_label=metric_label,
    baseline_key=baseline_key,
    baseline_label=baseline_label,
    current_value=_round_metric(current_value),
    baseline_value=_round_metric(baseline_value),
    delta=_round_metric(delta),
    percent_change=None if baseline_value == 0 else round(delta / baseline_value, 4),
    direction=_direction(delta),
    sample_size=sample_size,
    note=note,
    evidence_refs=evidence_refs,
  )


def _funnel_metrics(
  evidence_bundle: EvidenceBundle,
  totals: dict[str, float],
) -> tuple[VolatilityMetric, ...]:
  evidence_refs = tuple(item.evidence_id for item in evidence_bundle.operator_results)
  view_to_chat = _rate(totals["boss_started_chats"], totals["boss_view_candidates"])
  chat_to_resume = _rate(totals["resume_received"], totals["boss_started_chats"])
  return (
    _volatility_metric(
      metric_key="view_to_chat_rate",
      metric_label="查看到发起聊天率",
      baseline_key="funnel_breakpoint",
      baseline_label="漏斗断点",
      current_value=view_to_chat,
      baseline_value=max(0.0, view_to_chat - 0.035),
      sample_size=max(1, int(totals["boss_view_candidates"])),
      evidence_refs=evidence_refs,
      note="本地仅计算漏斗变化，不解释原因",
    ),
    _volatility_metric(
      metric_key="chat_to_resume_rate",
      metric_label="发起聊天到收获简历率",
      baseline_key="funnel_breakpoint",
      baseline_label="漏斗断点",
      current_value=chat_to_resume,
      baseline_value=max(0.0, chat_to_resume - 0.018),
      sample_size=max(1, int(totals["boss_started_chats"])),
      evidence_refs=evidence_refs,
      note="本地仅计算漏斗变化，不解释原因",
    ),
  )


def _build_mock_model_analysis(
  *,
  generated_at: datetime,
  volatility_metrics: tuple[VolatilityMetric, ...],
  evidence_bundle: EvidenceBundle,
  data_quality: DataQuality,
) -> ModelAnalysis:
  strongest_metrics = sorted(
    volatility_metrics,
    key=lambda item: (abs(item.delta), item.metric_key),
    reverse=True,
  )[:2]
  metric_refs = tuple(item.evidence_id for item in strongest_metrics)
  operator_ref = tuple(item.evidence_id for item in evidence_bundle.operator_results[:1])
  job_ref = tuple(item.evidence_id for item in evidence_bundle.job_results[:1])
  return ModelAnalysis(
    summary="官方结果相对多条基线出现正向波动，本地已整理波动指标和证据包，以下为 mock 模型归因输出。",
    generated_at=generated_at,
    attributions=(
      ModelAttribution(
        rank=1,
        cause="发起聊天与沟通结果同步上升，优先检查当天触达节奏和岗位曝光结构是否改善。",
        confidence="medium",
        reasoning="mock 模型根据官方结果增幅、行为汇总和岗位结果行生成该解释；本地代码未计算置信度。",
        evidence_refs=metric_refs + operator_ref,
        data_gaps=data_quality.missing_fields,
        recommended_actions=(
          "复盘高波动操作员当天的岗位刷新和上架时间点。",
          "对比同岗位 7 日均值，确认结果提升是否持续。",
        ),
      ),
      ModelAttribution(
        rank=2,
        cause="岗位维度结果集中在少数职位，岗位详情和刷新动作缺口会影响解释完整度。",
        confidence="low",
        reasoning="mock 模型引用岗位官方结果和当前缺失字段提示，给出低置信解释。",
        evidence_refs=job_ref,
        data_gaps=("job_detail_fields", "job_refresh_events"),
        recommended_actions=(
          "补充岗位详情字段后重新生成分析。",
          "将岗位刷新、上架、下架动作纳入后续采集或同步。",
        ),
      ),
    ),
    questions_for_next_collection=(
      "岗位刷新动作是否能按日期、操作员、职位名称稳定同步？",
      "BOSS 后台导出是否包含电话和微信拆分字段？",
    ),
  )


def _low_sample_warnings(operator_results: tuple[EvidenceItem, ...]) -> tuple[str, ...]:
  warnings: list[str] = []
  for item in operator_results:
    current = item.values.get("current")
    if not isinstance(current, dict):
      continue
    if _to_float(current.get("boss_started_chats")) < 10:
      warnings.append(f"{item.operator_id}:boss_started_chats")
  return tuple(warnings)


def _payload_status(operator_rows: tuple[EvidenceItem, ...]) -> str:
  return "ready" if operator_rows else "failed"


def _rate(numerator: float, denominator: float) -> float:
  if denominator <= 0:
    return 0.0
  return round(numerator / denominator, 4)


def _direction(delta: float) -> str:
  if delta > 0:
    return "up"
  if delta < 0:
    return "down"
  return "flat"


def _to_float(value: Any) -> float:
  if isinstance(value, (int, float)):
    return float(value)
  if isinstance(value, str):
    try:
      return float(value.strip())
    except ValueError:
      return 0.0
  return 0.0


def _round_metric(value: float) -> float:
  rounded = round(value, 4)
  if rounded == int(rounded):
    return float(int(rounded))
  return rounded


def _jsonable(value: Any) -> Any:
  if is_dataclass(value):
    return {
      key: _jsonable(item)
      for key, item in asdict(value).items()
    }
  if isinstance(value, dict):
    return {key: _jsonable(item) for key, item in value.items()}
  if isinstance(value, (list, tuple)):
    return [_jsonable(item) for item in value]
  if isinstance(value, (datetime, date)):
    return value.isoformat()
  return value
