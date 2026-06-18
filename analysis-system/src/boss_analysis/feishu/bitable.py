"""Small Feishu Bitable OpenAPI client.

This module intentionally keeps secrets in memory only and does not log request
headers, tenant access tokens, app secrets, cookies, or record contents.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from boss_analysis.official_results.sync import BOSS_DAILY_JOB_TABLE_ID, BOSS_DAILY_OPERATOR_TABLE_ID
from boss_analysis.security import safe_preview

FEISHU_OPEN_API_BASE_URL = "https://open.feishu.cn"
DEFAULT_RECORD_PAGE_SIZE = 500


class FeishuBitableError(RuntimeError):
  """Raised when a Feishu Bitable API call fails."""


@dataclass(frozen=True)
class FeishuBitableConfig:
  app_id: str
  app_secret: str
  app_token: str | None = None
  wiki_node_token: str | None = None
  base_url: str = FEISHU_OPEN_API_BASE_URL

  @classmethod
  def from_env(cls, env: Mapping[str, str] | None = None) -> "FeishuBitableConfig":
    values = env if env is not None else os.environ
    app_token = _optional_env(values, "FEISHU_BITABLE_APP_TOKEN")
    wiki_node_token = _optional_env(values, "FEISHU_BITABLE_WIKI_NODE_TOKEN")
    if not app_token and not wiki_node_token:
      raise FeishuBitableError(
        "Missing required environment variable: FEISHU_BITABLE_APP_TOKEN or FEISHU_BITABLE_WIKI_NODE_TOKEN",
      )
    return cls(
      app_id=_required_env(values, "FEISHU_APP_ID"),
      app_secret=_required_env(values, "FEISHU_APP_SECRET"),
      app_token=app_token,
      wiki_node_token=wiki_node_token,
      base_url=_string(values.get("FEISHU_OPEN_API_BASE_URL"), FEISHU_OPEN_API_BASE_URL),
    )


class FeishuBitableClient:
  """OpenAPI wrapper for one Feishu Bitable app."""

  def __init__(
    self,
    config: FeishuBitableConfig,
    *,
    date_fields: set[str] | None = None,
    page_size: int = DEFAULT_RECORD_PAGE_SIZE,
  ) -> None:
    self._config = config
    self._tenant_access_token: str | None = None
    self._resolved_app_token = config.app_token
    self._date_fields = date_fields or {"统计日期"}
    self._page_size = page_size

  @classmethod
  def from_env(cls, env: Mapping[str, str] | None = None) -> "FeishuBitableClient":
    return cls(FeishuBitableConfig.from_env(env))

  def table(self, table_id: str) -> "FeishuBitableTable":
    return FeishuBitableTable(
      client=self,
      app_token=self._app_token(),
      table_id=table_id,
      date_fields=self._date_fields,
      page_size=self._page_size,
    )

  def _request(
    self,
    method: str,
    path: str,
    *,
    query: Mapping[str, Any] | None = None,
    body: Mapping[str, Any] | None = None,
    auth: bool = True,
  ) -> Mapping[str, Any]:
    url = f"{self._config.base_url.rstrip('/')}{path}"
    if query:
      url = f"{url}?{urlencode({key: str(value) for key, value in query.items() if value is not None})}"
    data = None
    headers = {"Content-Type": "application/json; charset=utf-8"}
    if auth:
      headers["Authorization"] = f"Bearer {self._tenant_token()}"
    if body is not None:
      data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=data, headers=headers, method=method)
    try:
      with urlopen(request, timeout=30) as response:
        raw = response.read().decode("utf-8")
    except HTTPError as error:
      raise FeishuBitableError(f"Feishu API HTTP {error.code} for {method} {path}") from error
    except URLError as error:
      raise FeishuBitableError(f"Feishu API request failed for {method} {path}: {safe_preview(error.reason)}") from error
    try:
      payload = json.loads(raw)
    except json.JSONDecodeError as error:
      raise FeishuBitableError(f"Feishu API returned non-JSON response for {method} {path}") from error
    if not isinstance(payload, Mapping):
      raise FeishuBitableError(f"Feishu API returned invalid JSON shape for {method} {path}")
    code = payload.get("code")
    if code not in (0, "0", None):
      message = safe_preview(payload.get("msg") or payload.get("message")) or "unknown error"
      raise FeishuBitableError(f"Feishu API failed for {method} {path}: code={code}, message={message}")
    return payload

  def _tenant_token(self) -> str:
    if self._tenant_access_token:
      return self._tenant_access_token
    payload = self._request(
      "POST",
      "/open-apis/auth/v3/tenant_access_token/internal",
      body={
        "app_id": self._config.app_id,
        "app_secret": self._config.app_secret,
      },
      auth=False,
    )
    token = payload.get("tenant_access_token")
    if not isinstance(token, str) or not token:
      raise FeishuBitableError("Feishu token response did not include tenant_access_token")
    self._tenant_access_token = token
    return token

  def _app_token(self) -> str:
    if self._resolved_app_token:
      return self._resolved_app_token
    wiki_node_token = self._config.wiki_node_token
    if not wiki_node_token:
      raise FeishuBitableError(
        "Missing required environment variable: FEISHU_BITABLE_APP_TOKEN or FEISHU_BITABLE_WIKI_NODE_TOKEN",
      )
    payload = self._request(
      "GET",
      "/open-apis/wiki/v2/spaces/get_node",
      query={"token": wiki_node_token},
    )
    data = payload.get("data")
    node = data.get("node") if isinstance(data, Mapping) else None
    if not isinstance(node, Mapping):
      raise FeishuBitableError("Feishu wiki node response did not include node")
    if node.get("obj_type") != "bitable":
      raise FeishuBitableError("Configured Feishu wiki node is not a bitable node")
    obj_token = node.get("obj_token")
    if not isinstance(obj_token, str) or not obj_token.strip():
      raise FeishuBitableError("Feishu wiki node response did not include obj_token")
    self._resolved_app_token = obj_token.strip()
    return self._resolved_app_token


class FeishuBitableTable:
  def __init__(
    self,
    *,
    client: FeishuBitableClient,
    app_token: str,
    table_id: str,
    date_fields: set[str],
    page_size: int,
  ) -> None:
    self._client = client
    self._app_token = app_token
    self._table_id = table_id
    self._date_fields = date_fields
    self._page_size = page_size

  def list_records(self) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    page_token: str | None = None
    while True:
      payload = self._client._request(
        "GET",
        self._records_path(),
        query={
          "page_size": self._page_size,
          "page_token": page_token,
        },
      )
      data = payload.get("data")
      if not isinstance(data, Mapping):
        return records
      items = data.get("items") or data.get("records") or []
      if isinstance(items, list):
        records.extend(item for item in items if isinstance(item, dict))
      if not data.get("has_more"):
        return records
      next_token = data.get("page_token")
      if not isinstance(next_token, str) or not next_token:
        return records
      page_token = next_token

  def create_record(self, fields: dict[str, Any]) -> str:
    payload = self._client._request(
      "POST",
      self._records_path(),
      body={"fields": self._encode_fields(fields)},
    )
    data = payload.get("data")
    if isinstance(data, Mapping):
      record = data.get("record")
      if isinstance(record, Mapping):
        record_id = record.get("record_id") or record.get("id")
        if isinstance(record_id, str):
          return record_id
      record_id = data.get("record_id")
      if isinstance(record_id, str):
        return record_id
    return ""

  def update_record(self, record_id: str, fields: dict[str, Any]) -> None:
    self._client._request(
      "PUT",
      f"{self._records_path()}/{record_id}",
      body={"fields": self._encode_fields(fields)},
    )

  def _records_path(self) -> str:
    return f"/open-apis/bitable/v1/apps/{self._app_token}/tables/{self._table_id}/records"

  def _encode_fields(self, fields: Mapping[str, Any]) -> dict[str, Any]:
    return {
      key: _encode_date_value(value) if key in self._date_fields else value
      for key, value in fields.items()
    }


def default_table_ids(env: Mapping[str, str] | None = None) -> tuple[str, str]:
  values = env if env is not None else os.environ
  return (
    _string(values.get("FEISHU_DAILY_OPERATOR_RESULT_TABLE_ID"), BOSS_DAILY_OPERATOR_TABLE_ID),
    _string(values.get("FEISHU_DAILY_OPERATOR_JOB_RESULT_TABLE_ID"), BOSS_DAILY_JOB_TABLE_ID),
  )


def _encode_date_value(value: Any) -> Any:
  if isinstance(value, (int, float)) and not isinstance(value, bool):
    return int(value)
  if isinstance(value, date):
    return _date_to_millis(value)
  if isinstance(value, str) and value.strip():
    try:
      return _date_to_millis(date.fromisoformat(value.strip()[:10]))
    except ValueError:
      return value
  return value


def _date_to_millis(value: date) -> int:
  dt = datetime.combine(value, time.min, tzinfo=timezone.utc)
  return int(dt.timestamp() * 1000)


def _required_env(values: Mapping[str, str], key: str) -> str:
  value = values.get(key)
  if value and value.strip():
    return value.strip()
  raise FeishuBitableError(f"Missing required environment variable: {key}")


def _optional_env(values: Mapping[str, str], key: str) -> str | None:
  value = values.get(key)
  if value and value.strip():
    return value.strip()
  return None


def _string(value: str | None, default: str) -> str:
  if value is None or not value.strip():
    return default
  return value.strip()
