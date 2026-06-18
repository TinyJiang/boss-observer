"""Official BOSS result sources.

The HTTP source uses BOSS JSON endpoints observed from the official recruitment
data page. It never reads browser storage and expects credentials to be supplied
by the caller through environment variables or constructor arguments.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from boss_analysis.official_results.models import OfficialResultsBatch
from boss_analysis.official_results.sync import map_job_row, map_operator_row
from boss_analysis.security import safe_preview

BOSS_BASE_URL = "https://www.zhipin.com"
BOSS_RECRUIT_DATA_REFERER = "https://www.zhipin.com/web/frame/enterprise/recruit/data"
BOSS_DAILY_OPERATOR_PATH = "/wapi/zpboss/h5/weeklyReport4Admin/getDailyBoss.json"
BOSS_DAILY_JOB_PATH = "/wapi/zpboss/h5/weeklyReport4Admin/getDailyJob.json"
DEFAULT_BOSS_PAGE_SIZE = 100
DEFAULT_BOSS_MAX_PAGES = 100


class OfficialResultsSourceError(RuntimeError):
  """Raised when an official result source cannot return usable rows."""


@dataclass(frozen=True)
class BossOfficialResultsApiSource:
  """Fetch official result rows from BOSS backend JSON APIs."""

  cookie: str
  base_url: str = BOSS_BASE_URL
  page_size: int = DEFAULT_BOSS_PAGE_SIZE
  max_pages: int = DEFAULT_BOSS_MAX_PAGES
  user_agent: str = "Mozilla/5.0"
  timeout_seconds: float = 30.0

  @classmethod
  def from_env(cls, env: Mapping[str, str] | None = None) -> "BossOfficialResultsApiSource":
    values = env if env is not None else os.environ
    cookie = _required_env(values, "BOSS_OFFICIAL_RESULTS_COOKIE")
    return cls(
      cookie=cookie,
      base_url=_string(values.get("BOSS_OFFICIAL_RESULTS_BASE_URL"), BOSS_BASE_URL),
      page_size=_int(values.get("BOSS_OFFICIAL_RESULTS_PAGE_SIZE"), DEFAULT_BOSS_PAGE_SIZE),
      max_pages=_int(values.get("BOSS_OFFICIAL_RESULTS_MAX_PAGES"), DEFAULT_BOSS_MAX_PAGES),
      user_agent=_string(values.get("BOSS_OFFICIAL_RESULTS_USER_AGENT"), "Mozilla/5.0"),
    )

  def fetch(self, target_date: date) -> OfficialResultsBatch:
    operator_payload = self._fetch_pages(BOSS_DAILY_OPERATOR_PATH, target_date)
    job_payload = self._fetch_pages(BOSS_DAILY_JOB_PATH, target_date)
    operator_rows = tuple(map_operator_row(row, target_date) for row in operator_payload.rows)
    job_rows = tuple(map_job_row(row, target_date) for row in job_payload.rows)
    warnings = (*operator_payload.warnings, *job_payload.warnings)
    deadline = operator_payload.deadline or job_payload.deadline
    return OfficialResultsBatch(
      target_date=target_date,
      operator_rows=operator_rows,
      job_rows=job_rows,
      source_deadline=deadline,
      source_warnings=warnings,
    )

  def _fetch_pages(self, path: str, target_date: date) -> "_PagedRows":
    rows: list[Mapping[str, Any]] = []
    deadline: str | None = None
    warnings: list[str] = []
    total_size: int | None = None
    for page in range(1, max(1, self.max_pages) + 1):
      payload = self._get_json(path, {
        "dateStr": target_date.isoformat(),
        "page": page,
        "pageSize": max(1, self.page_size),
      })
      zp_data = payload.get("zpData")
      if not isinstance(zp_data, Mapping):
        raise OfficialResultsSourceError(f"BOSS API returned no zpData for {path}")
      if zp_data.get("isReady") not in (None, 1, True):
        warnings.append(f"{path} reports data is not ready")
      if isinstance(zp_data.get("deadline"), str):
        deadline = zp_data["deadline"]
      page_rows = _list_of_mappings(zp_data.get("dataList"))
      total_size = _int_or_none(zp_data.get("totalSize"))
      rows.extend(page_rows)
      if not page_rows:
        break
      if total_size is not None and len(rows) >= total_size:
        break
      if len(page_rows) < self.page_size:
        break
    else:
      warnings.append(f"{path} reached max_pages={self.max_pages}")
    return _PagedRows(tuple(rows), deadline=deadline, warnings=tuple(warnings))

  def _get_json(self, path: str, params: Mapping[str, Any]) -> Mapping[str, Any]:
    query = urlencode({key: str(value) for key, value in params.items()})
    url = f"{self.base_url.rstrip('/')}{path}?{query}"
    request = Request(
      url,
      headers={
        "Accept": "application/json, text/plain, */*",
        "Cookie": self.cookie,
        "Referer": BOSS_RECRUIT_DATA_REFERER,
        "User-Agent": self.user_agent,
        "X-Requested-With": "XMLHttpRequest",
      },
      method="GET",
    )
    try:
      with urlopen(request, timeout=self.timeout_seconds) as response:
        raw = response.read().decode("utf-8")
    except HTTPError as error:
      raise OfficialResultsSourceError(f"BOSS API HTTP {error.code} for {path}") from error
    except URLError as error:
      raise OfficialResultsSourceError(f"BOSS API request failed for {path}: {safe_preview(error.reason)}") from error
    try:
      payload = json.loads(raw)
    except json.JSONDecodeError as error:
      raise OfficialResultsSourceError(f"BOSS API returned non-JSON response for {path}") from error
    if not isinstance(payload, Mapping):
      raise OfficialResultsSourceError(f"BOSS API returned invalid JSON shape for {path}")
    code = payload.get("code")
    if code not in (0, "0", None):
      message = safe_preview(payload.get("message")) or "unknown error"
      raise OfficialResultsSourceError(f"BOSS API failed for {path}: code={code}, message={message}")
    return payload


@dataclass(frozen=True)
class JsonOfficialResultsSource:
  """Read official result rows from a local JSON file for tests and replay."""

  path: Path

  @classmethod
  def from_path(cls, path: str | Path) -> "JsonOfficialResultsSource":
    return cls(Path(path))

  def fetch(self, target_date: date) -> OfficialResultsBatch:
    data = json.loads(self.path.read_text(encoding="utf-8"))
    if not isinstance(data, Mapping):
      raise OfficialResultsSourceError("Official result source file must contain a JSON object")
    operator_raw = _list_of_mappings(
      data.get("operator_rows")
      or data.get("operatorRows")
      or data.get("daily_operator_result")
      or data.get("dailyOperatorResult")
    )
    job_raw = _list_of_mappings(
      data.get("job_rows")
      or data.get("jobRows")
      or data.get("daily_operator_job_result")
      or data.get("dailyOperatorJobResult")
    )
    # TODO: Once additional Feishu fields are confirmed, promote selected job
    # detail keys from extra_source_fields into explicit table columns.
    return OfficialResultsBatch(
      target_date=target_date,
      operator_rows=tuple(map_operator_row(row, target_date) for row in operator_raw),
      job_rows=tuple(map_job_row(row, target_date) for row in job_raw),
      source_deadline=_optional_text(data.get("deadline")),
    )


@dataclass(frozen=True)
class _PagedRows:
  rows: tuple[Mapping[str, Any], ...]
  deadline: str | None = None
  warnings: tuple[str, ...] = ()


def _list_of_mappings(value: Any) -> tuple[Mapping[str, Any], ...]:
  if not isinstance(value, list):
    return ()
  return tuple(item for item in value if isinstance(item, Mapping))


def _required_env(values: Mapping[str, str], key: str) -> str:
  value = values.get(key)
  if value and value.strip():
    return value
  raise OfficialResultsSourceError(f"Missing required environment variable: {key}")


def _optional_text(value: Any) -> str | None:
  if value is None:
    return None
  text = str(value).strip()
  return text or None


def _string(value: str | None, default: str) -> str:
  if value is None or not value.strip():
    return default
  return value.strip()


def _int(value: str | None, default: int) -> int:
  if value is None or not value.strip():
    return default
  try:
    return int(value)
  except ValueError:
    return default


def _int_or_none(value: Any) -> int | None:
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, int):
    return value
  if isinstance(value, float):
    return int(value)
  if isinstance(value, str) and value.strip():
    try:
      return int(float(value))
    except ValueError:
      return None
  return None
