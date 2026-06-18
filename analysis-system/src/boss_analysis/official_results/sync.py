"""Map and sync BOSS official results into Feishu Bitable tables."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from boss_analysis.domain.operators import OperatorProfile
from boss_analysis.official_results.models import OfficialResultRow, OfficialResultsBatch, OfficialResultsSource

BOSS_DAILY_OPERATOR_TABLE_ID = "tbl7FU8548wp187I"
BOSS_DAILY_JOB_TABLE_ID = "tbl7IizPNJdfxLup"
DEFAULT_TIMEZONE_NAME = "Asia/Shanghai"

OPERATOR_SOURCE_TO_FEISHU: tuple[tuple[str, str, str], ...] = (
  ("bossName", "BOSS姓名", "text"),
  ("phoneDesc", "手机号码", "text"),
  ("companyDesc", "所属公司", "text"),
  ("groupDesc", "所在分组", "text"),
  ("certJobDesc", "认证职务", "text"),
  ("companyEmail", "企业邮箱", "text"),
  ("detailGeek", "BOSS查看牛人", "number"),
  ("activeAdd", "BOSS发起聊天", "number"),
  ("communication", "BOSS沟通", "number"),
  ("detailBoss", "牛人查看BOSS", "number"),
  ("passiveAdd", "牛人发起聊天", "number"),
  ("resumeAccept", "收获简历", "number"),
  ("contactAccept", "交换电话微信", "number"),
  ("interviewAccept", "接受面试", "number"),
)

JOB_SOURCE_TO_FEISHU: tuple[tuple[str, str, str], ...] = (
  ("jobDesc", "职位名称", "text"),
  ("bossName", "职位发布人", "text"),
  ("phoneDesc", "发布人手机号", "text"),
  ("companyDesc", "发布人所属公司", "text"),
  ("groupDesc", "发布人所在分组", "text"),
  ("certJobDesc", "发布人认证职务", "text"),
  ("companyEmail", "发布人企业邮箱", "text"),
  ("detailGeek", "BOSS查看牛人", "number"),
  ("activeAdd", "BOSS发起聊天", "number"),
  ("communication", "BOSS沟通", "number"),
  ("detailBoss", "牛人查看BOSS", "number"),
  ("passiveAdd", "牛人发起聊天", "number"),
  ("resumeAccept", "收获简历", "number"),
  ("contactAccept", "交换电话微信", "number"),
  ("interviewAccept", "接受面试", "number"),
)


class FeishuTableClient(Protocol):
  def list_records(self) -> list[dict[str, Any]]:
    """Return records from one Feishu table."""

  def create_record(self, fields: dict[str, Any]) -> str:
    """Create one record and return the new record id."""

  def update_record(self, record_id: str, fields: dict[str, Any]) -> None:
    """Update one existing record."""


class FeishuClient(Protocol):
  def table(self, table_id: str) -> FeishuTableClient:
    """Return a table-scoped Feishu client."""


@dataclass(frozen=True)
class SyncPlanItem:
  table_id: str
  action: str
  business_key: str
  fields: dict[str, Any]
  record_id: str | None = None
  missing_source_fields: tuple[str, ...] = ()
  extra_source_fields: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class SyncPlanSummary:
  create_count: int
  update_count: int
  operator_row_count: int
  job_row_count: int
  unmatched_operator_names: tuple[str, ...] = ()
  missing_source_fields: tuple[str, ...] = ()


@dataclass(frozen=True)
class SyncPlan:
  target_date: date
  operator_items: tuple[SyncPlanItem, ...]
  job_items: tuple[SyncPlanItem, ...]
  summary: SyncPlanSummary


@dataclass(frozen=True)
class OfficialResultsSyncResult:
  plan: SyncPlan
  dry_run: bool
  applied_create_count: int
  applied_update_count: int


def resolve_sync_date(
  value: str | None,
  *,
  clock=None,
  timezone_name: str = DEFAULT_TIMEZONE_NAME,
) -> date:
  if value:
    return date.fromisoformat(value)
  now = (clock or datetime.now)()
  if now.tzinfo is None:
    try:
      timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
      timezone = ZoneInfo(DEFAULT_TIMEZONE_NAME)
    now = now.replace(tzinfo=timezone)
  else:
    now = now.astimezone(ZoneInfo(timezone_name))
  return now.date() - timedelta(days=1)


def map_operator_row(raw: Mapping[str, Any], target_date: date) -> OfficialResultRow:
  fields = _mapped_fields(raw, target_date, OPERATOR_SOURCE_TO_FEISHU)
  missing = _missing_fields(raw, ("bossName",))
  business_key = _business_key(
    target_date,
    fields["BOSS姓名"],
    fields["手机号码"],
  )
  return OfficialResultRow(
    fields=fields,
    business_key=business_key,
    missing_source_fields=missing,
    extra_source_fields=_extra_source_fields(raw, OPERATOR_SOURCE_TO_FEISHU),
  )


def map_job_row(raw: Mapping[str, Any], target_date: date) -> OfficialResultRow:
  fields = _mapped_fields(raw, target_date, JOB_SOURCE_TO_FEISHU)
  missing = _missing_fields(raw, ("jobDesc", "bossName"))
  business_key = _business_key(
    target_date,
    fields["职位名称"],
    fields["职位发布人"],
    fields["发布人手机号"],
  )
  return OfficialResultRow(
    fields=fields,
    business_key=business_key,
    missing_source_fields=missing,
    extra_source_fields=_extra_source_fields(raw, JOB_SOURCE_TO_FEISHU),
  )


def build_sync_plan(
  batch: OfficialResultsBatch,
  *,
  operator_existing_records: Sequence[Mapping[str, Any]],
  job_existing_records: Sequence[Mapping[str, Any]],
  operator_profiles: Iterable[OperatorProfile],
  operator_table_id: str = BOSS_DAILY_OPERATOR_TABLE_ID,
  job_table_id: str = BOSS_DAILY_JOB_TABLE_ID,
) -> SyncPlan:
  operator_existing = _existing_operator_keys(operator_existing_records)
  job_existing = _existing_job_keys(job_existing_records)
  operator_items = tuple(
    _plan_item(
      table_id=operator_table_id,
      row=row,
      existing_record_id=operator_existing.get(row.business_key),
    )
    for row in batch.operator_rows
  )
  job_items = tuple(
    _plan_item(
      table_id=job_table_id,
      row=row,
      existing_record_id=job_existing.get(row.business_key),
    )
    for row in batch.job_rows
  )
  missing_source_fields = tuple(sorted(set(
    field
    for item in (*operator_items, *job_items)
    for field in item.missing_source_fields
  )))
  summary = SyncPlanSummary(
    create_count=sum(1 for item in (*operator_items, *job_items) if item.action == "create"),
    update_count=sum(1 for item in (*operator_items, *job_items) if item.action == "update"),
    operator_row_count=len(operator_items),
    job_row_count=len(job_items),
    unmatched_operator_names=_unmatched_operator_names(batch, operator_profiles),
    missing_source_fields=missing_source_fields,
  )
  return SyncPlan(
    target_date=batch.target_date,
    operator_items=operator_items,
    job_items=job_items,
    summary=summary,
  )


def run_official_results_sync(
  *,
  target_date: date,
  source: OfficialResultsSource,
  feishu_client: FeishuClient,
  operator_profiles: Iterable[OperatorProfile],
  dry_run: bool = False,
  operator_table_id: str = BOSS_DAILY_OPERATOR_TABLE_ID,
  job_table_id: str = BOSS_DAILY_JOB_TABLE_ID,
) -> OfficialResultsSyncResult:
  batch = source.fetch(target_date)
  operator_table = feishu_client.table(operator_table_id)
  job_table = feishu_client.table(job_table_id)
  plan = build_sync_plan(
    batch,
    operator_existing_records=operator_table.list_records(),
    job_existing_records=job_table.list_records(),
    operator_profiles=operator_profiles,
    operator_table_id=operator_table_id,
    job_table_id=job_table_id,
  )
  if dry_run:
    return OfficialResultsSyncResult(
      plan=plan,
      dry_run=True,
      applied_create_count=0,
      applied_update_count=0,
    )
  applied_create_count = 0
  applied_update_count = 0
  for item in plan.operator_items:
    created, updated = _apply_plan_item(operator_table, item)
    applied_create_count += created
    applied_update_count += updated
  for item in plan.job_items:
    created, updated = _apply_plan_item(job_table, item)
    applied_create_count += created
    applied_update_count += updated
  return OfficialResultsSyncResult(
    plan=plan,
    dry_run=False,
    applied_create_count=applied_create_count,
    applied_update_count=applied_update_count,
  )


def plan_to_jsonable(plan: SyncPlan) -> dict[str, Any]:
  return {
    "target_date": plan.target_date.isoformat(),
    "operator": _items_summary(plan.operator_items),
    "job": _items_summary(plan.job_items),
    "summary": {
      "create_count": plan.summary.create_count,
      "update_count": plan.summary.update_count,
      "operator_row_count": plan.summary.operator_row_count,
      "job_row_count": plan.summary.job_row_count,
      "unmatched_operator_names": list(plan.summary.unmatched_operator_names),
      "missing_source_fields": list(plan.summary.missing_source_fields),
    },
  }


def _mapped_fields(
  raw: Mapping[str, Any],
  target_date: date,
  mapping: tuple[tuple[str, str, str], ...],
) -> dict[str, Any]:
  fields: dict[str, Any] = {"统计日期": target_date.isoformat()}
  for source_key, field_name, value_kind in mapping:
    value = raw.get(source_key)
    if value_kind == "number":
      fields[field_name] = _int_value(value)
    else:
      fields[field_name] = _text_value(value)
  return fields


def _missing_fields(raw: Mapping[str, Any], required_keys: tuple[str, ...]) -> tuple[str, ...]:
  return tuple(
    key
    for key in required_keys
    if key not in raw or raw.get(key) is None
  )


def _extra_source_fields(
  raw: Mapping[str, Any],
  mapping: tuple[tuple[str, str, str], ...],
) -> dict[str, Any]:
  known = {source_key for source_key, _, _ in mapping}
  return {
    key: value
    for key, value in raw.items()
    if key not in known
  }


def _plan_item(
  *,
  table_id: str,
  row: OfficialResultRow,
  existing_record_id: str | None,
) -> SyncPlanItem:
  return SyncPlanItem(
    table_id=table_id,
    action="update" if existing_record_id else "create",
    business_key=row.business_key,
    fields=row.fields,
    record_id=existing_record_id,
    missing_source_fields=row.missing_source_fields,
    extra_source_fields=row.extra_source_fields,
  )


def _apply_plan_item(table: FeishuTableClient, item: SyncPlanItem) -> tuple[int, int]:
  if item.action == "update":
    if not item.record_id:
      raise RuntimeError(f"Update plan item has no record_id for key {item.business_key}")
    table.update_record(item.record_id, item.fields)
    return 0, 1
  table.create_record(item.fields)
  return 1, 0


def _existing_operator_keys(records: Sequence[Mapping[str, Any]]) -> dict[str, str]:
  return {
    key: record_id
    for record in records
    for record_id, key in [_record_operator_key(record)]
    if record_id and key
  }


def _existing_job_keys(records: Sequence[Mapping[str, Any]]) -> dict[str, str]:
  return {
    key: record_id
    for record in records
    for record_id, key in [_record_job_key(record)]
    if record_id and key
  }


def _record_operator_key(record: Mapping[str, Any]) -> tuple[str | None, str | None]:
  fields = _record_fields(record)
  record_id = _record_id(record)
  if not fields:
    return record_id, None
  active_date = _normalize_date_value(fields.get("统计日期"))
  key = _business_key(active_date, fields.get("BOSS姓名"), fields.get("手机号码"))
  return record_id, key


def _record_job_key(record: Mapping[str, Any]) -> tuple[str | None, str | None]:
  fields = _record_fields(record)
  record_id = _record_id(record)
  if not fields:
    return record_id, None
  active_date = _normalize_date_value(fields.get("统计日期"))
  key = _business_key(
    active_date,
    fields.get("职位名称"),
    fields.get("职位发布人"),
    fields.get("发布人手机号"),
  )
  return record_id, key


def _record_fields(record: Mapping[str, Any]) -> Mapping[str, Any]:
  fields = record.get("fields", record)
  return fields if isinstance(fields, Mapping) else {}


def _record_id(record: Mapping[str, Any]) -> str | None:
  for key in ("record_id", "recordId", "id"):
    value = record.get(key)
    if isinstance(value, str) and value:
      return value
  return None


def _business_key(active_date: date | str, *parts: Any) -> str:
  if isinstance(active_date, date):
    date_part = active_date.isoformat()
  else:
    date_part = _text_value(active_date)
  return "|".join((date_part, *(_text_value(part) for part in parts)))


def _normalize_date_value(value: Any) -> str:
  if isinstance(value, date):
    return value.isoformat()
  if isinstance(value, (int, float)) and not isinstance(value, bool):
    # Feishu Bitable date fields are commonly returned as Unix milliseconds.
    try:
      return datetime.fromtimestamp(value / 1000).date().isoformat()
    except (OSError, OverflowError, ValueError):
      return str(value)
  text = _text_value(value)
  if len(text) >= 10:
    normalized = text[:10].replace(".", "-")
    try:
      return date.fromisoformat(normalized).isoformat()
    except ValueError:
      return text
  return text


def _unmatched_operator_names(
  batch: OfficialResultsBatch,
  operator_profiles: Iterable[OperatorProfile],
) -> tuple[str, ...]:
  known_names: set[str] = set()
  for profile in operator_profiles:
    if not profile.enabled:
      continue
    known_names.add(profile.display_name)
    if profile.account_name:
      known_names.add(profile.account_name)
  names = set()
  for row in batch.operator_rows:
    name = _text_value(row.fields.get("BOSS姓名"))
    if name:
      names.add(name)
  for row in batch.job_rows:
    name = _text_value(row.fields.get("职位发布人"))
    if name:
      names.add(name)
  return tuple(sorted(name for name in names if name not in known_names))


def _items_summary(items: tuple[SyncPlanItem, ...]) -> dict[str, int]:
  return {
    "create_count": sum(1 for item in items if item.action == "create"),
    "update_count": sum(1 for item in items if item.action == "update"),
    "row_count": len(items),
  }


def _text_value(value: Any) -> str:
  if value is None:
    return ""
  return str(value).strip()


def _int_value(value: Any) -> int:
  if value is None or value == "":
    return 0
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, int):
    return value
  if isinstance(value, float):
    return int(value)
  text = str(value).strip().replace(",", "")
  if text in {"--", "-"}:
    return 0
  try:
    return int(float(text))
  except ValueError:
    return 0
