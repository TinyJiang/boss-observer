"""Development helper for reading CLS minute-summary records through SearchLog."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import urllib.request
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

CLS_SEARCH_VERSION = "2020-10-16"
DEFAULT_CLS_ENDPOINT = "cls.tencentcloudapi.com"


@dataclass(frozen=True)
class TencentCloudCredentials:
  """Credentials for Tencent Cloud API 3.0 requests."""

  secret_id: str
  secret_key: str
  token: str | None = None


@dataclass(frozen=True)
class ClsSearchConfig:
  """SearchLog source configuration."""

  topic_id: str
  credentials: TencentCloudCredentials
  region: str | None = None
  endpoint: str = DEFAULT_CLS_ENDPOINT
  query: str = "*"
  window_minutes: int = 60
  window_mode: str = "relative"
  timezone_name: str = "Asia/Shanghai"
  limit: int = 1000
  max_pages: int = 5
  sort: str = "desc"
  syntax_rule: int = 1
  use_new_analysis: bool = True

  @property
  def window_label(self) -> str:
    if self.window_mode == "today":
      return f"today:{self.timezone_name}"
    return f"{self.window_minutes}m"


class TencentCloudApiClient:
  """Small Tencent Cloud API 3.0 client using TC3-HMAC-SHA256 signing."""

  def __init__(
    self,
    credentials: TencentCloudCredentials,
    *,
    endpoint: str = DEFAULT_CLS_ENDPOINT,
    service: str = "cls",
    timeout_seconds: int = 15,
  ) -> None:
    self._credentials = credentials
    self._endpoint = endpoint
    self._service = service
    self._timeout_seconds = timeout_seconds

  def call(
    self,
    action: str,
    payload: dict[str, Any],
    *,
    version: str = CLS_SEARCH_VERSION,
    region: str | None = None,
  ) -> dict[str, Any]:
    payload_bytes = _json_payload_bytes(payload)
    headers = self.build_headers(
      action,
      payload_bytes,
      version=version,
      region=region,
    )
    request = urllib.request.Request(
      f"https://{self._endpoint}",
      data=payload_bytes,
      headers=headers,
      method="POST",
    )
    with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
      body = response.read().decode("utf-8")
    return json.loads(body)

  def build_headers(
    self,
    action: str,
    payload_bytes: bytes,
    *,
    version: str = CLS_SEARCH_VERSION,
    region: str | None = None,
    timestamp: int | None = None,
  ) -> dict[str, str]:
    signed_at = int(timestamp if timestamp is not None else datetime.now(timezone.utc).timestamp())
    content_type = "application/json; charset=utf-8"
    headers = {
      "Authorization": _build_tc3_authorization(
        self._credentials,
        payload_bytes,
        host=self._endpoint,
        service=self._service,
        content_type=content_type,
        timestamp=signed_at,
      ),
      "Content-Type": content_type,
      "Host": self._endpoint,
      "X-TC-Action": action,
      "X-TC-Timestamp": str(signed_at),
      "X-TC-Version": version,
    }
    if region:
      headers["X-TC-Region"] = region
    if self._credentials.token:
      headers["X-TC-Token"] = self._credentials.token
    return headers


def load_cls_summary_search_config(env: Mapping[str, str] | None = None) -> ClsSearchConfig:
  """Load development SearchLog configuration for scheduled SQL summary output."""

  values = env if env is not None else os.environ
  return _load_prefixed_cls_search_config(
    values,
    prefix="CLS_SUMMARY",
    default_query="*",
    default_window="today",
    token_name="CLS_SUMMARY_TOKEN",
    secret_id_names=("TENCENTCLOUD_SECRET_ID", "CLS_SUMMARY_SECRET_ID"),
    secret_key_names=("TENCENTCLOUD_SECRET_KEY", "CLS_SUMMARY_SECRET_KEY"),
  )


def load_cls_daily_summary_search_config(env: Mapping[str, str] | None = None) -> ClsSearchConfig:
  """Load development SearchLog configuration for daily scheduled SQL metric output."""

  values = env if env is not None else os.environ
  return _load_prefixed_cls_search_config(
    values,
    prefix="CLS_DAILY_SUMMARY",
    default_query="*",
    default_window="today",
    token_name="CLS_DAILY_SUMMARY_TOKEN",
    secret_id_names=("TENCENTCLOUD_SECRET_ID", "CLS_DAILY_SUMMARY_SECRET_ID", "CLS_SUMMARY_SECRET_ID"),
    secret_key_names=("TENCENTCLOUD_SECRET_KEY", "CLS_DAILY_SUMMARY_SECRET_KEY", "CLS_SUMMARY_SECRET_KEY"),
  )


def load_cls_daily_basic_summary_search_config(env: Mapping[str, str] | None = None) -> ClsSearchConfig:
  """Load development SearchLog configuration for daily operator basic-stat output."""

  values = env if env is not None else os.environ
  return _load_prefixed_cls_search_config(
    values,
    prefix="CLS_DAILY_BASIC_SUMMARY",
    default_query="*",
    default_window="today",
    token_name="CLS_DAILY_BASIC_SUMMARY_TOKEN",
    secret_id_names=(
      "TENCENTCLOUD_SECRET_ID",
      "CLS_DAILY_BASIC_SUMMARY_SECRET_ID",
      "CLS_DAILY_SUMMARY_SECRET_ID",
      "CLS_SUMMARY_SECRET_ID",
    ),
    secret_key_names=(
      "TENCENTCLOUD_SECRET_KEY",
      "CLS_DAILY_BASIC_SUMMARY_SECRET_KEY",
      "CLS_DAILY_SUMMARY_SECRET_KEY",
      "CLS_SUMMARY_SECRET_KEY",
    ),
  )


def load_cls_log_quality_search_config(env: Mapping[str, str] | None = None) -> ClsSearchConfig:
  """Load development SearchLog configuration for 10-minute log-quality output."""

  values = env if env is not None else os.environ
  return _load_prefixed_cls_search_config(
    values,
    prefix="CLS_LOG_QUALITY",
    default_query="*",
    default_window="today",
    token_name="CLS_LOG_QUALITY_TOKEN",
    secret_id_names=("TENCENTCLOUD_SECRET_ID", "CLS_LOG_QUALITY_SECRET_ID", "CLS_SUMMARY_SECRET_ID"),
    secret_key_names=("TENCENTCLOUD_SECRET_KEY", "CLS_LOG_QUALITY_SECRET_KEY", "CLS_SUMMARY_SECRET_KEY"),
  )


def search_cls_log_values(
  config: ClsSearchConfig,
  *,
  now: datetime | None = None,
  start_at: datetime | None = None,
  end_at: datetime | None = None,
  client: Any | None = None,
) -> list[dict[str, Any]]:
  """Search CLS and return decoded log JSON values."""

  _ensure_searchlog_allowed()
  api_client = client or TencentCloudApiClient(
    config.credentials,
    endpoint=config.endpoint,
    service="cls",
  )
  values: list[dict[str, Any]] = []
  context = None
  for _ in range(config.max_pages):
    response = api_client.call(
      "SearchLog",
      build_search_payload(config, now=now, start_at=start_at, end_at=end_at, context=context),
      version=CLS_SEARCH_VERSION,
      region=config.region,
    )
    values.extend(iter_log_values_from_search_response(response))
    body = _response_body(response)
    if body.get("ListOver") is True:
      break
    next_context = body.get("Context")
    if not isinstance(next_context, str) or next_context == context:
      break
    context = next_context
  return values


def query_cls_metric_range(
  config: ClsSearchConfig,
  *,
  query: str,
  start_at: datetime,
  end_at: datetime,
  step_seconds: int = 60,
  client: Any | None = None,
) -> list[dict[str, Any]]:
  """Query a CLS metric topic with PromQL range syntax."""

  api_client = client or TencentCloudApiClient(
    config.credentials,
    endpoint=config.endpoint,
    service="cls",
  )
  response = api_client.call(
    "QueryRangeMetric",
    build_metric_range_payload(
      config,
      query=query,
      start_at=start_at,
      end_at=end_at,
      step_seconds=step_seconds,
    ),
    version=CLS_SEARCH_VERSION,
    region=config.region,
  )
  body = _response_body(response)
  _raise_cls_error(body, "QueryRangeMetric")
  return decode_metric_query_result(body.get("Result"))


def build_search_payload(
  config: ClsSearchConfig,
  *,
  now: datetime | None = None,
  start_at: datetime | None = None,
  end_at: datetime | None = None,
  context: str | None = None,
) -> dict[str, Any]:
  resolved_end_at = end_at or now or datetime.now(timezone.utc)
  if resolved_end_at.tzinfo is None:
    resolved_end_at = resolved_end_at.replace(tzinfo=timezone.utc)
  resolved_start_at = start_at or _search_start_at(config, resolved_end_at)
  if resolved_start_at.tzinfo is None:
    resolved_start_at = resolved_start_at.replace(tzinfo=timezone.utc)
  end_ms = int(resolved_end_at.timestamp() * 1000)
  start_ms = int(resolved_start_at.timestamp() * 1000)
  payload = {
    "TopicId": config.topic_id,
    "From": start_ms,
    "To": end_ms,
    "QueryString": config.query,
    "Limit": config.limit,
    "Sort": config.sort,
    "UseNewAnalysis": config.use_new_analysis,
    "QuerySyntax": config.syntax_rule,
  }
  if context:
    payload["Context"] = context
  return payload


def build_metric_range_payload(
  config: ClsSearchConfig,
  *,
  query: str,
  start_at: datetime,
  end_at: datetime,
  step_seconds: int = 60,
) -> dict[str, Any]:
  """Build the payload for the CLS QueryRangeMetric API."""

  if start_at.tzinfo is None:
    start_at = start_at.replace(tzinfo=timezone.utc)
  if end_at.tzinfo is None:
    end_at = end_at.replace(tzinfo=timezone.utc)
  return {
    "TopicId": config.topic_id,
    "Query": query,
    "Start": int(start_at.timestamp()),
    "End": int(end_at.timestamp()),
    "Step": max(1, int(step_seconds)),
  }


def decode_metric_query_result(value: Any) -> list[dict[str, Any]]:
  """Decode CLS metric API Result JSON into a list of series."""

  decoded = value
  if isinstance(value, str):
    try:
      decoded = json.loads(value)
    except json.JSONDecodeError:
      return []
  if not isinstance(decoded, list):
    return []
  return [dict(item) for item in decoded if isinstance(item, Mapping)]


def iter_log_values_from_search_response(response: Mapping[str, Any]) -> Iterable[dict[str, Any]]:
  body = _response_body(response)
  if not isinstance(body, Mapping):
    return
  _raise_cls_error(body, "SearchLog")

  results = body.get("Results") or []
  if not isinstance(results, list):
    return
  for item in results:
    if not isinstance(item, Mapping):
      continue
    yield from _iter_values_from_log_info(item)


def _iter_values_from_log_info(item: Mapping[str, Any]) -> Iterable[dict[str, Any]]:
  for key in ("LogJson", "RawLog", "Content", "content"):
    value = item.get(key)
    if isinstance(value, Mapping):
      yield dict(value)
      return
    if isinstance(value, str) and value.strip():
      decoded = _decode_json_object(value)
      if decoded is not None:
        yield decoded
        return
  if _looks_like_flattened_log(item):
    yield dict(item)


def _response_body(response: Mapping[str, Any]) -> Mapping[str, Any]:
  body = response.get("Response", response)
  return body if isinstance(body, Mapping) else {}


def _raise_cls_error(body: Mapping[str, Any], action: str) -> None:
  error = body.get("Error")
  if isinstance(error, Mapping):
    code = error.get("Code") or "Unknown"
    message = error.get("Message") or f"CLS {action} failed"
    raise RuntimeError(f"CLS {action} failed: {code}: {message}")


def _decode_json_object(value: str) -> dict[str, Any] | None:
  try:
    decoded = json.loads(value)
  except json.JSONDecodeError:
    return None
  if isinstance(decoded, dict):
    return decoded
  return None


def _looks_like_flattened_log(item: Mapping[str, Any]) -> bool:
  return "event_id" in item or "event_type" in item or "contents" in item


def _build_tc3_authorization(
  credentials: TencentCloudCredentials,
  payload_bytes: bytes,
  *,
  host: str,
  service: str,
  content_type: str,
  timestamp: int,
) -> str:
  algorithm = "TC3-HMAC-SHA256"
  date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")
  signed_headers = "content-type;host"
  canonical_headers = f"content-type:{content_type}\nhost:{host}\n"
  canonical_request = "\n".join([
    "POST",
    "/",
    "",
    canonical_headers,
    signed_headers,
    _sha256_hex(payload_bytes),
  ])
  credential_scope = f"{date}/{service}/tc3_request"
  string_to_sign = "\n".join([
    algorithm,
    str(timestamp),
    credential_scope,
    _sha256_hex(canonical_request.encode("utf-8")),
  ])
  secret_date = _hmac_sha256(("TC3" + credentials.secret_key).encode("utf-8"), date)
  secret_service = _hmac_sha256(secret_date, service)
  secret_signing = _hmac_sha256(secret_service, "tc3_request")
  signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
  return (
    f"{algorithm} "
    f"Credential={credentials.secret_id}/{credential_scope}, "
    f"SignedHeaders={signed_headers}, "
    f"Signature={signature}"
  )


def _json_payload_bytes(payload: dict[str, Any]) -> bytes:
  return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256_hex(value: bytes) -> str:
  return hashlib.sha256(value).hexdigest()


def _hmac_sha256(key: bytes, value: str) -> bytes:
  return hmac.new(key, value.encode("utf-8"), hashlib.sha256).digest()


def _required(values: Mapping[str, str], name: str) -> str:
  value = _optional(values.get(name))
  if value is None:
    raise ValueError(f"Missing required environment variable: {name}")
  return value


def _required_any(values: Mapping[str, str], names: tuple[str, ...]) -> str:
  for name in names:
    value = _optional(values.get(name))
    if value is not None:
      return value
  raise ValueError(f"Missing required environment variable: {' or '.join(names)}")


def _load_prefixed_cls_search_config(
  values: Mapping[str, str],
  *,
  prefix: str,
  default_query: str,
  default_window: int | str,
  token_name: str,
  secret_id_names: tuple[str, ...],
  secret_key_names: tuple[str, ...],
) -> ClsSearchConfig:
  credentials = _load_credentials(
    values,
    token_name=token_name,
    secret_id_names=secret_id_names,
    secret_key_names=secret_key_names,
  )
  window_mode, window_minutes = _window_settings(values.get(f"{prefix}_WINDOW_MINUTES"), default_window)
  return ClsSearchConfig(
    topic_id=_required(values, f"{prefix}_TOPIC_ID"),
    credentials=credentials,
    region=_optional(values.get(f"{prefix}_REGION")),
    endpoint=_string(values.get(f"{prefix}_ENDPOINT"), DEFAULT_CLS_ENDPOINT),
    query=_string(values.get(f"{prefix}_QUERY"), default_query),
    window_minutes=window_minutes,
    window_mode=window_mode,
    timezone_name=_string(values.get("APP_TIMEZONE"), "Asia/Shanghai"),
    limit=_bounded_int(values.get(f"{prefix}_LIMIT"), 1000, minimum=1, maximum=1000),
    max_pages=_positive_int(values.get(f"{prefix}_MAX_PAGES"), 5),
    sort=_sort(values.get(f"{prefix}_SORT"), name=f"{prefix}_SORT"),
  )


def _load_credentials(
  values: Mapping[str, str],
  *,
  token_name: str,
  secret_id_names: tuple[str, ...],
  secret_key_names: tuple[str, ...],
) -> TencentCloudCredentials:
  secret_id = _required_any(values, secret_id_names)
  secret_key = _required_any(values, secret_key_names)
  return TencentCloudCredentials(
    secret_id=secret_id,
    secret_key=secret_key,
    token=_optional(values.get("TENCENTCLOUD_TOKEN") or values.get(token_name)),
  )


def _optional(value: str | None) -> str | None:
  if value is None:
    return None
  stripped = value.strip()
  return stripped or None


def _window_settings(value: str | None, default: int | str) -> tuple[str, int]:
  raw = _optional(value)
  spec = raw if raw is not None else str(default)
  if spec.strip().lower() in {"today", "day", "current_day"}:
    return "today", 1
  return "relative", _positive_int(spec, 60)


def _search_start_at(config: ClsSearchConfig, end_at: datetime) -> datetime:
  if config.window_mode == "today":
    try:
      local_tz = ZoneInfo(config.timezone_name)
    except ZoneInfoNotFoundError:
      local_tz = timezone.utc
    local_end = end_at.astimezone(local_tz)
    return local_end.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
  return datetime.fromtimestamp(end_at.timestamp() - config.window_minutes * 60, tz=timezone.utc)


def _ensure_searchlog_allowed() -> None:
  if (os.environ.get("APP_ENV") or "").strip().lower() == "production":
    raise RuntimeError("CLS SearchLog is disabled in production; use the approved summary ingestion path")


def _string(value: str | None, default: str) -> str:
  optional = _optional(value)
  return optional if optional is not None else default


def _positive_int(value: str | None, default: int) -> int:
  parsed = _bounded_int(value, default, minimum=1, maximum=None)
  return parsed


def _bounded_int(value: str | None, default: int, *, minimum: int, maximum: int | None) -> int:
  optional = _optional(value)
  if optional is None:
    return default
  try:
    parsed = int(optional)
  except ValueError as error:
    raise ValueError(f"Invalid integer value: {value}") from error
  if parsed < minimum:
    raise ValueError(f"Integer must be >= {minimum}: {value}")
  if maximum is not None and parsed > maximum:
    raise ValueError(f"Integer must be <= {maximum}: {value}")
  return parsed


def _sort(value: str | None, *, name: str = "CLS_SUMMARY_SORT") -> str:
  sort = _string(value, "desc").lower()
  if sort not in {"asc", "desc"}:
    raise ValueError(f"Invalid {name}: {value}")
  return sort
