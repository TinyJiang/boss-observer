"""Configured operator identities for display and filtering."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class OperatorProfile:
  """Human-maintained operator metadata keyed by CLS operator_id."""

  operator_id: str
  display_name: str
  account_name: str | None = None
  enabled: bool = True
  role: str | None = None
  note: str | None = None
