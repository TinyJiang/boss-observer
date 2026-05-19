"""Environment-driven runtime configuration."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import asdict
from typing import Any

from boss_analysis.domain import AppSettings, ProcessRole
from boss_analysis.security import redact_mapping

VALID_PROCESS_ROLES = {"api-server", "cls-consumer", "aggregate-worker", "replay-worker"}


def load_settings(env: Mapping[str, str] | None = None) -> AppSettings:
  values = env if env is not None else os.environ
  process_role = _process_role(values.get("PROCESS_ROLE", "api-server"))
  return AppSettings(
    app_env=_string(values.get("APP_ENV"), "development"),
    app_timezone=_string(values.get("APP_TIMEZONE"), "Asia/Shanghai"),
    process_role=process_role,
    cls_kafka_brokers=_optional_string(values.get("CLS_KAFKA_BROKERS")),
    cls_kafka_topic=_optional_string(values.get("CLS_KAFKA_TOPIC")),
    cls_kafka_username=_optional_string(values.get("CLS_KAFKA_USERNAME")),
    cls_kafka_password=_optional_string(values.get("CLS_KAFKA_PASSWORD")),
    cls_kafka_group_id=_string(values.get("CLS_KAFKA_GROUP_ID"), "boss-analysis-system"),
    database_url=_optional_string(values.get("DATABASE_URL")),
    jwt_secret=_optional_string(values.get("JWT_SECRET")),
    cos_bucket=_optional_string(values.get("COS_BUCKET")),
    cos_region=_optional_string(values.get("COS_REGION")),
    sensitive_data_access_enabled=_bool(values.get("SENSITIVE_DATA_ACCESS_ENABLED"), False),
    log_level=_string(values.get("LOG_LEVEL"), "INFO").upper(),
  )


def public_settings(settings: AppSettings) -> dict[str, Any]:
  """Return settings safe for logs or health responses."""

  return redact_mapping(asdict(settings))


def _process_role(value: str) -> ProcessRole:
  normalized = value.strip() if value else "api-server"
  if normalized not in VALID_PROCESS_ROLES:
    raise ValueError(f"Invalid PROCESS_ROLE: {value}")
  return normalized


def _optional_string(value: str | None) -> str | None:
  if value is None:
    return None
  stripped = value.strip()
  return stripped or None


def _string(value: str | None, default: str) -> str:
  optional = _optional_string(value)
  return optional if optional is not None else default


def _bool(value: str | None, default: bool) -> bool:
  if value is None or value.strip() == "":
    return default
  normalized = value.strip().lower()
  if normalized in {"true", "1", "yes", "y", "on"}:
    return True
  if normalized in {"false", "0", "no", "n", "off"}:
    return False
  raise ValueError(f"Invalid boolean value: {value}")
