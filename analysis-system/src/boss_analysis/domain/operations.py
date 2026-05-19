"""Operations and security domain models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ProcessRole = Literal["api-server", "cls-consumer", "aggregate-worker", "replay-worker"]


@dataclass(frozen=True)
class AppSettings:
  """Runtime settings read from environment variables."""

  app_env: str
  app_timezone: str
  process_role: ProcessRole
  cls_kafka_brokers: str | None
  cls_kafka_topic: str | None
  cls_kafka_username: str | None
  cls_kafka_password: str | None
  cls_kafka_group_id: str
  database_url: str | None
  jwt_secret: str | None
  cos_bucket: str | None
  cos_region: str | None
  sensitive_data_access_enabled: bool
  log_level: str


@dataclass(frozen=True)
class RuntimeHealth:
  """Lightweight health state for a running process."""

  process_role: ProcessRole
  status: Literal["ok", "degraded", "failed"]
  message: str
