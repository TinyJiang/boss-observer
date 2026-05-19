"""Security helpers for redaction and safe previews."""

from __future__ import annotations

import re
from typing import Any

SENSITIVE_KEY_PARTS = (
  "secret",
  "password",
  "token",
  "key",
  "database_url",
  "authorization",
)

PHONE_RE = re.compile(r"(?<!\d)(1[3-9]\d{9})(?!\d)")
EMAIL_RE = re.compile(r"([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")


def is_sensitive_key(key: str) -> bool:
  lowered = key.lower()
  return any(part in lowered for part in SENSITIVE_KEY_PARTS)


def redact_value(key: str, value: Any) -> Any:
  if value is None:
    return None
  if is_sensitive_key(key):
    return "***REDACTED***"
  return value


def redact_mapping(values: dict[str, Any]) -> dict[str, Any]:
  return {key: redact_value(key, value) for key, value in values.items()}


def safe_preview(value: Any, *, limit: int = 256) -> str | None:
  """Return a bounded preview with obvious contact details masked."""

  if value is None:
    return None
  text = str(value)
  text = PHONE_RE.sub(_mask_phone_match, text)
  text = EMAIL_RE.sub(r"\1***\2", text)
  if len(text) <= limit:
    return text
  return text[:limit]


def _mask_phone_match(match: re.Match[str]) -> str:
  phone = match.group(1)
  return f"{phone[:3]}****{phone[-4:]}"
