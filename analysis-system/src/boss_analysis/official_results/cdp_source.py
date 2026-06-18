"""CDP-backed official BOSS result source.

This source attaches to a user-started Chrome remote debugging endpoint and
executes same-origin `fetch` calls inside an already authenticated BOSS page.
It intentionally does not read browser storage, cookies, profile databases, or
downloaded export files.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import struct
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import ProxyHandler, Request, build_opener

from boss_analysis.official_results.models import OfficialResultsBatch
from boss_analysis.official_results.source import (
  BOSS_BASE_URL,
  BOSS_DAILY_JOB_PATH,
  BOSS_DAILY_OPERATOR_PATH,
  BOSS_RECRUIT_DATA_REFERER,
  DEFAULT_BOSS_MAX_PAGES,
  DEFAULT_BOSS_PAGE_SIZE,
  OfficialResultsSourceError,
  _int,
  _int_or_none,
  _list_of_mappings,
  _string,
)
from boss_analysis.official_results.sync import map_job_row, map_operator_row
from boss_analysis.security import safe_preview

DEFAULT_BOSS_CDP_URL = "http://127.0.0.1:9222"
_BOSS_RECRUIT_DATA_PATH = "/web/frame/enterprise/recruit/data"
_WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class CdpPageClient(Protocol):
  def navigate(self, url: str) -> None:
    """Navigate or focus the BOSS official data page."""

  def fetch_json(self, path: str, params: Mapping[str, Any]) -> Mapping[str, Any]:
    """Fetch a JSON endpoint from the page origin with page credentials."""

  def close(self) -> None:
    """Release any resources owned by the client."""


@dataclass(frozen=True)
class BossOfficialResultsCdpSource:
  """Fetch official result rows through an authenticated Chrome page."""

  cdp_url: str = DEFAULT_BOSS_CDP_URL
  base_url: str = BOSS_BASE_URL
  page_size: int = DEFAULT_BOSS_PAGE_SIZE
  max_pages: int = DEFAULT_BOSS_MAX_PAGES
  timeout_seconds: float = 30.0
  page_client: CdpPageClient | None = None

  @classmethod
  def from_env(
    cls,
    env: Mapping[str, str] | None = None,
    *,
    cdp_url: str | None = None,
  ) -> "BossOfficialResultsCdpSource":
    values = env if env is not None else os.environ
    return cls(
      cdp_url=_string(cdp_url or values.get("BOSS_OFFICIAL_RESULTS_CDP_URL"), DEFAULT_BOSS_CDP_URL),
      base_url=_string(values.get("BOSS_OFFICIAL_RESULTS_BASE_URL"), BOSS_BASE_URL),
      page_size=_int(values.get("BOSS_OFFICIAL_RESULTS_PAGE_SIZE"), DEFAULT_BOSS_PAGE_SIZE),
      max_pages=_int(values.get("BOSS_OFFICIAL_RESULTS_MAX_PAGES"), DEFAULT_BOSS_MAX_PAGES),
    )

  def fetch(self, target_date: date) -> OfficialResultsBatch:
    client = self.page_client
    owns_client = client is None
    if client is None:
      client = _CdpChromePageClient.open(
        cdp_url=self.cdp_url,
        target_url=self._target_url(),
        timeout_seconds=self.timeout_seconds,
      )
    try:
      client.navigate(self._target_url())
      operator_payload = self._fetch_pages(client, BOSS_DAILY_OPERATOR_PATH, target_date)
      job_payload = self._fetch_pages(client, BOSS_DAILY_JOB_PATH, target_date)
    finally:
      if owns_client:
        client.close()
    return OfficialResultsBatch(
      target_date=target_date,
      operator_rows=tuple(map_operator_row(row, target_date) for row in operator_payload.rows),
      job_rows=tuple(map_job_row(row, target_date) for row in job_payload.rows),
      source_deadline=operator_payload.deadline or job_payload.deadline,
      source_warnings=(*operator_payload.warnings, *job_payload.warnings),
    )

  def _fetch_pages(self, client: CdpPageClient, path: str, target_date: date) -> "_PagedRows":
    rows: list[Mapping[str, Any]] = []
    warnings: list[str] = []
    deadline: str | None = None
    total_size: int | None = None
    page_size = max(1, self.page_size)
    for page in range(1, max(1, self.max_pages) + 1):
      payload = client.fetch_json(path, {
        "dateStr": target_date.isoformat(),
        "page": page,
        "pageSize": page_size,
      })
      zp_data = payload.get("zpData")
      if not isinstance(zp_data, Mapping):
        raise OfficialResultsSourceError(f"BOSS CDP fetch returned no zpData for {path}")
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
      if len(page_rows) < page_size:
        break
    else:
      warnings.append(f"{path} reached max_pages={self.max_pages}")
    return _PagedRows(tuple(rows), deadline=deadline, warnings=tuple(warnings))

  def _target_url(self) -> str:
    if self.base_url.rstrip("/") == BOSS_BASE_URL:
      return BOSS_RECRUIT_DATA_REFERER
    return f"{self.base_url.rstrip('/')}{_BOSS_RECRUIT_DATA_PATH}"


@dataclass(frozen=True)
class _PagedRows:
  rows: tuple[Mapping[str, Any], ...]
  deadline: str | None = None
  warnings: tuple[str, ...] = ()


class _CdpChromePageClient:
  def __init__(self, connection: "_WebSocketConnection", timeout_seconds: float) -> None:
    self._connection = connection
    self._timeout_seconds = timeout_seconds
    self._connection.call("Runtime.enable", timeout_seconds=timeout_seconds)
    self._connection.call("Page.enable", timeout_seconds=timeout_seconds)

  @classmethod
  def open(
    cls,
    *,
    cdp_url: str,
    target_url: str,
    timeout_seconds: float,
  ) -> "_CdpChromePageClient":
    target = _find_or_create_page(cdp_url, target_url, timeout_seconds)
    ws_url = target.get("webSocketDebuggerUrl")
    if not isinstance(ws_url, str) or not ws_url:
      raise OfficialResultsSourceError("CDP target does not expose a page websocket URL")
    return cls(_WebSocketConnection.connect(ws_url, timeout_seconds), timeout_seconds)

  def navigate(self, url: str) -> None:
    self._connection.call("Page.navigate", {"url": url}, timeout_seconds=self._timeout_seconds)
    self._connection.wait_for_event(
      {"Page.domContentEventFired", "Page.loadEventFired"},
      timeout_seconds=min(15.0, self._timeout_seconds),
    )
    self._wait_for_boss_origin(url)

  def fetch_json(self, path: str, params: Mapping[str, Any]) -> Mapping[str, Any]:
    expression = _build_fetch_expression(path, params)
    result = self._connection.call(
      "Runtime.evaluate",
      {
        "expression": expression,
        "awaitPromise": True,
        "returnByValue": True,
      },
      timeout_seconds=self._timeout_seconds,
    )
    value = _runtime_value(result)
    if not isinstance(value, Mapping):
      raise OfficialResultsSourceError(f"CDP fetch returned invalid shape for {path}")
    if value.get("parseError"):
      status = value.get("status")
      raise OfficialResultsSourceError(f"CDP fetch returned non-JSON response for {path}: status={status}")
    status = _int_or_none(value.get("status"))
    if status is not None and not 200 <= status < 300:
      raise OfficialResultsSourceError(f"CDP fetch HTTP {status} for {path}")
    payload = value.get("payload")
    if not isinstance(payload, Mapping):
      raise OfficialResultsSourceError(f"CDP fetch returned invalid JSON payload for {path}")
    code = payload.get("code")
    if code not in (0, "0", None):
      message = safe_preview(payload.get("message") or payload.get("msg")) or "unknown error"
      raise OfficialResultsSourceError(f"BOSS CDP fetch failed for {path}: code={code}, message={message}")
    return payload

  def close(self) -> None:
    self._connection.close()

  def _wait_for_boss_origin(self, target_url: str) -> None:
    expected_origin = _origin(target_url)
    deadline = time.monotonic() + min(15.0, self._timeout_seconds)
    last_error: Exception | None = None
    while time.monotonic() < deadline:
      try:
        result = self._connection.call(
          "Runtime.evaluate",
          {
            "expression": (
              "({origin: location.origin, readyState: document.readyState})"
            ),
            "returnByValue": True,
          },
          timeout_seconds=min(5.0, self._timeout_seconds),
        )
        value = _runtime_value(result)
        if (
          isinstance(value, Mapping)
          and value.get("origin") == expected_origin
          and value.get("readyState") in ("interactive", "complete")
        ):
          return
      except Exception as error:  # pragma: no cover - timing dependent CDP navigation path.
        last_error = error
      time.sleep(0.25)
    if last_error is not None:
      raise OfficialResultsSourceError(f"CDP page did not become ready: {safe_preview(last_error)}") from last_error
    raise OfficialResultsSourceError("CDP page did not become ready for BOSS origin")


class _WebSocketConnection:
  def __init__(self, sock: socket.socket) -> None:
    self._sock = sock
    self._next_id = 1
    self._closed = False

  @classmethod
  def connect(cls, ws_url: str, timeout_seconds: float) -> "_WebSocketConnection":
    parsed = urlparse(ws_url)
    if parsed.scheme != "ws":
      raise OfficialResultsSourceError(f"Unsupported CDP websocket scheme: {safe_preview(parsed.scheme)}")
    host = parsed.hostname
    if not host:
      raise OfficialResultsSourceError("CDP websocket URL is missing host")
    port = parsed.port or 80
    path = parsed.path or "/"
    if parsed.query:
      path = f"{path}?{parsed.query}"
    try:
      sock = socket.create_connection((host, port), timeout=timeout_seconds)
      _perform_websocket_handshake(sock, host, port, path, timeout_seconds)
    except OSError as error:
      raise OfficialResultsSourceError(f"Failed to connect CDP websocket: {safe_preview(error)}") from error
    return cls(sock)

  def call(
    self,
    method: str,
    params: Mapping[str, Any] | None = None,
    *,
    timeout_seconds: float,
  ) -> Mapping[str, Any]:
    message_id = self._next_id
    self._next_id += 1
    message: dict[str, Any] = {"id": message_id, "method": method}
    if params:
      message["params"] = dict(params)
    self._send_json(message)
    deadline = time.monotonic() + timeout_seconds
    while True:
      remaining = deadline - time.monotonic()
      if remaining <= 0:
        raise OfficialResultsSourceError(f"Timed out waiting for CDP method {method}")
      response = self._recv_json(timeout_seconds=remaining)
      if response.get("id") != message_id:
        continue
      if "error" in response:
        raise OfficialResultsSourceError(f"CDP method {method} failed: {safe_preview(response.get('error'))}")
      result = response.get("result")
      if isinstance(result, Mapping):
        return result
      return {}

  def wait_for_event(self, methods: set[str], *, timeout_seconds: float) -> None:
    deadline = time.monotonic() + timeout_seconds
    while True:
      remaining = deadline - time.monotonic()
      if remaining <= 0:
        return
      try:
        message = self._recv_json(timeout_seconds=remaining)
      except socket.timeout:
        return
      method = message.get("method")
      if isinstance(method, str) and method in methods:
        return

  def close(self) -> None:
    if self._closed:
      return
    self._closed = True
    try:
      self._send_frame(0x8, b"")
    except OSError:
      pass
    try:
      self._sock.close()
    except OSError:
      pass

  def _send_json(self, message: Mapping[str, Any]) -> None:
    payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    self._send_frame(0x1, payload)

  def _recv_json(self, *, timeout_seconds: float) -> Mapping[str, Any]:
    old_timeout = self._sock.gettimeout()
    self._sock.settimeout(timeout_seconds)
    try:
      payload = self._recv_message()
    finally:
      self._sock.settimeout(old_timeout)
    try:
      data = json.loads(payload.decode("utf-8"))
    except json.JSONDecodeError as error:
      raise OfficialResultsSourceError("CDP websocket returned non-JSON message") from error
    if not isinstance(data, Mapping):
      raise OfficialResultsSourceError("CDP websocket returned invalid message shape")
    return data

  def _recv_message(self) -> bytes:
    chunks: list[bytes] = []
    while True:
      fin, opcode, payload = self._recv_frame()
      if opcode == 0x8:
        raise OfficialResultsSourceError("CDP websocket closed")
      if opcode == 0x9:
        self._send_frame(0xA, payload)
        continue
      if opcode == 0xA:
        continue
      if opcode not in (0x0, 0x1, 0x2):
        continue
      chunks.append(payload)
      if fin:
        return b"".join(chunks)

  def _recv_frame(self) -> tuple[bool, int, bytes]:
    header = _recv_exact(self._sock, 2)
    first, second = header[0], header[1]
    fin = bool(first & 0x80)
    opcode = first & 0x0F
    masked = bool(second & 0x80)
    length = second & 0x7F
    if length == 126:
      length = struct.unpack("!H", _recv_exact(self._sock, 2))[0]
    elif length == 127:
      length = struct.unpack("!Q", _recv_exact(self._sock, 8))[0]
    mask = _recv_exact(self._sock, 4) if masked else b""
    payload = _recv_exact(self._sock, length) if length else b""
    if masked:
      payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    return fin, opcode, payload

  def _send_frame(self, opcode: int, payload: bytes) -> None:
    first = 0x80 | opcode
    length = len(payload)
    header = bytearray([first])
    if length < 126:
      header.append(0x80 | length)
    elif length <= 0xFFFF:
      header.extend((0x80 | 126, *struct.pack("!H", length)))
    else:
      header.extend((0x80 | 127, *struct.pack("!Q", length)))
    mask = os.urandom(4)
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    self._sock.sendall(bytes(header) + mask + masked)


def _find_or_create_page(
  cdp_url: str,
  target_url: str,
  timeout_seconds: float,
) -> Mapping[str, Any]:
  targets = _cdp_json(cdp_url, "/json/list", timeout_seconds)
  if isinstance(targets, list):
    target = _select_boss_page(targets)
    if target is not None:
      return target
  return _open_new_page(cdp_url, target_url, timeout_seconds)


def _select_boss_page(targets: list[Any]) -> Mapping[str, Any] | None:
  page_targets = [item for item in targets if isinstance(item, Mapping) and item.get("type") == "page"]
  for target in page_targets:
    url = target.get("url")
    if isinstance(url, str) and "/web/frame/enterprise/recruit/data" in url:
      return target
  for target in page_targets:
    url = target.get("url")
    if isinstance(url, str) and "zhipin.com" in url:
      return target
  return None


def _open_new_page(cdp_url: str, target_url: str, timeout_seconds: float) -> Mapping[str, Any]:
  path = f"/json/new?{quote(target_url, safe='')}"
  try:
    target = _cdp_json(cdp_url, path, timeout_seconds, method="PUT")
  except OfficialResultsSourceError:
    target = _cdp_json(cdp_url, path, timeout_seconds, method="GET")
  if not isinstance(target, Mapping):
    raise OfficialResultsSourceError("CDP /json/new returned invalid target shape")
  return target


def _cdp_json(
  cdp_url: str,
  path: str,
  timeout_seconds: float,
  *,
  method: str = "GET",
) -> Any:
  url = f"{cdp_url.rstrip('/')}{path}"
  request = Request(url, headers={"Accept": "application/json"}, method=method)
  try:
    with _urlopen_without_proxy(request, timeout_seconds) as response:
      raw = response.read().decode("utf-8")
  except HTTPError as error:
    raise OfficialResultsSourceError(f"CDP HTTP {error.code} for {path}") from error
  except URLError as error:
    raise OfficialResultsSourceError(f"CDP request failed for {path}: {safe_preview(error.reason)}") from error
  try:
    return json.loads(raw)
  except json.JSONDecodeError as error:
    raise OfficialResultsSourceError(f"CDP returned non-JSON response for {path}") from error


def _urlopen_without_proxy(request: Request, timeout_seconds: float):
  opener = build_opener(ProxyHandler({}))
  return opener.open(request, timeout=timeout_seconds)


def _perform_websocket_handshake(
  sock: socket.socket,
  host: str,
  port: int,
  path: str,
  timeout_seconds: float,
) -> None:
  key = base64.b64encode(os.urandom(16)).decode("ascii")
  host_header = f"{host}:{port}"
  request = (
    f"GET {path} HTTP/1.1\r\n"
    f"Host: {host_header}\r\n"
    "Upgrade: websocket\r\n"
    "Connection: Upgrade\r\n"
    f"Sec-WebSocket-Key: {key}\r\n"
    "Sec-WebSocket-Version: 13\r\n"
    "\r\n"
  ).encode("ascii")
  old_timeout = sock.gettimeout()
  sock.settimeout(timeout_seconds)
  try:
    sock.sendall(request)
    response = _read_http_headers(sock)
  finally:
    sock.settimeout(old_timeout)
  header_text = response.decode("iso-8859-1", errors="replace")
  first_line = header_text.split("\r\n", 1)[0]
  if " 101 " not in first_line:
    raise OfficialResultsSourceError(f"CDP websocket handshake failed: {safe_preview(first_line)}")
  expected_accept = base64.b64encode(
    hashlib.sha1((key + _WEBSOCKET_GUID).encode("ascii")).digest(),
  ).decode("ascii")
  accept = _http_header(header_text, "sec-websocket-accept")
  if accept and accept != expected_accept:
    raise OfficialResultsSourceError("CDP websocket handshake returned invalid accept key")


def _read_http_headers(sock: socket.socket) -> bytes:
  chunks: list[bytes] = []
  data = b""
  while b"\r\n\r\n" not in data:
    chunk = sock.recv(4096)
    if not chunk:
      break
    chunks.append(chunk)
    data = b"".join(chunks)
    if len(data) > 65536:
      raise OfficialResultsSourceError("CDP websocket handshake response is too large")
  return data


def _http_header(header_text: str, name: str) -> str | None:
  prefix = f"{name.lower()}:"
  for line in header_text.split("\r\n")[1:]:
    if line.lower().startswith(prefix):
      return line.split(":", 1)[1].strip()
  return None


def _recv_exact(sock: socket.socket, size: int) -> bytes:
  chunks: list[bytes] = []
  remaining = size
  while remaining > 0:
    chunk = sock.recv(remaining)
    if not chunk:
      raise OfficialResultsSourceError("CDP websocket closed while reading")
    chunks.append(chunk)
    remaining -= len(chunk)
  return b"".join(chunks)


def _build_fetch_expression(path: str, params: Mapping[str, Any]) -> str:
  query = urlencode({key: str(value) for key, value in params.items()})
  url = f"{path}?{query}"
  return f"""
(async () => {{
  const response = await fetch(new URL({json.dumps(url)}, location.origin).toString(), {{
    credentials: "include",
    headers: {{
      "Accept": "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest"
    }}
  }});
  const text = await response.text();
  try {{
    return {{
      status: response.status,
      ok: response.ok,
      payload: JSON.parse(text)
    }};
  }} catch (error) {{
    return {{
      status: response.status,
      ok: response.ok,
      parseError: true
    }};
  }}
}})()
""".strip()


def _runtime_value(result: Mapping[str, Any]) -> Any:
  runtime_result = result.get("result")
  if not isinstance(runtime_result, Mapping):
    return None
  if runtime_result.get("subtype") == "error":
    description = safe_preview(runtime_result.get("description")) or "unknown runtime error"
    raise OfficialResultsSourceError(f"CDP runtime evaluation failed: {description}")
  return runtime_result.get("value")


def _origin(url: str) -> str:
  parsed = urlparse(url)
  if not parsed.scheme or not parsed.netloc:
    return ""
  return f"{parsed.scheme}://{parsed.netloc}"
