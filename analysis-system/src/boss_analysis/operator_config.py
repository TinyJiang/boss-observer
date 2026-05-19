"""Load local operator configuration for the dev dashboard."""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from boss_analysis.domain import OperatorProfile

DEFAULT_OPERATOR_CONFIG_FILE = "config/operators.local.json"


class OperatorConfigProvider:
  """Hot-load operator metadata from a JSON file when it changes."""

  def __init__(self, path: str | Path | None = None) -> None:
    self._path = _resolve_config_path(path or os.environ.get("BOSS_ANALYSIS_OPERATOR_CONFIG_FILE"))
    self._loaded_mtime_ns: int | None = None
    self._profiles: tuple[OperatorProfile, ...] = ()

  @property
  def path(self) -> Path:
    return self._path

  def load(self) -> tuple[OperatorProfile, ...]:
    if not self._path.exists():
      self._loaded_mtime_ns = None
      self._profiles = ()
      return self._profiles
    mtime_ns = self._path.stat().st_mtime_ns
    if self._loaded_mtime_ns == mtime_ns:
      return self._profiles
    data = json.loads(self._path.read_text(encoding="utf-8"))
    self._profiles = tuple(parse_operator_profiles(data))
    self._loaded_mtime_ns = mtime_ns
    return self._profiles


def parse_operator_profiles(value: Any) -> list[OperatorProfile]:
  """Parse operator profiles from a JSON object or list."""

  if isinstance(value, Mapping):
    raw_items = value.get("operators", [])
  else:
    raw_items = value
  if not isinstance(raw_items, list):
    raise ValueError("Operator config must contain an operators list")

  profiles: list[OperatorProfile] = []
  seen: set[str] = set()
  for raw_item in raw_items:
    if not isinstance(raw_item, Mapping):
      continue
    operator_id = _clean_string(raw_item.get("operatorId") or raw_item.get("operator_id"))
    if operator_id is None:
      continue
    if operator_id in seen:
      raise ValueError(f"Duplicate operatorId in config: {operator_id}")
    seen.add(operator_id)
    display_name = _clean_string(raw_item.get("displayName") or raw_item.get("display_name")) or operator_id
    profiles.append(OperatorProfile(
      operator_id=operator_id,
      display_name=display_name,
      account_name=_clean_string(raw_item.get("accountName") or raw_item.get("account_name")),
      enabled=_bool(raw_item.get("enabled"), True),
      role=_clean_string(raw_item.get("role")),
      note=_clean_string(raw_item.get("note")),
    ))
  return profiles


def _resolve_config_path(value: str | Path | None) -> Path:
  raw_path = Path(value or DEFAULT_OPERATOR_CONFIG_FILE)
  if raw_path.is_absolute():
    return raw_path
  project_root = Path(__file__).resolve().parents[2]
  return project_root / raw_path


def _clean_string(value: Any) -> str | None:
  if value is None:
    return None
  if isinstance(value, str):
    stripped = value.strip()
    return stripped or None
  return str(value)


def _bool(value: Any, default: bool) -> bool:
  if value is None:
    return default
  if isinstance(value, bool):
    return value
  if isinstance(value, str):
    normalized = value.strip().lower()
    if normalized in {"true", "1", "yes", "y", "on"}:
      return True
    if normalized in {"false", "0", "no", "n", "off"}:
      return False
  raise ValueError(f"Invalid operator enabled value: {value}")
