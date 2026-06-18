"""Load local operator configuration for the dev dashboard."""

from __future__ import annotations

import json
import os
import base64
import hashlib
import hmac
import secrets
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from boss_analysis.domain import OperatorProfile

DEFAULT_OPERATOR_CONFIG_FILE = "config/operators.local.json"
ENCRYPTED_PREFIX = "enc:v1:"
SENSITIVE_OPERATOR_FIELDS = frozenset({"accountName", "note"})


class OperatorConfigProvider:
  """Hot-load operator metadata from a JSON file when it changes."""

  def __init__(
    self,
    path: str | Path | None = None,
    *,
    encryption_secret: str | None = None,
  ) -> None:
    self._path = _resolve_config_path(path or os.environ.get("BOSS_ANALYSIS_OPERATOR_CONFIG_FILE"))
    self._encryption_secret = encryption_secret if encryption_secret is not None else _default_encryption_secret()
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
    self._profiles = tuple(parse_operator_profiles(
      data,
      encryption_secret=self._encryption_secret,
    ))
    self._loaded_mtime_ns = mtime_ns
    return self._profiles

  def save(
    self,
    values: list[Mapping[str, Any]] | tuple[Mapping[str, Any], ...],
    *,
    encrypt_sensitive: bool = False,
  ) -> tuple[OperatorProfile, ...]:
    profiles = parse_operator_profiles(
      values,
      encryption_secret=self._encryption_secret,
    )
    payload = {
      "operators": [
        _operator_profile_to_config_item(
          profile,
          encrypt_sensitive=encrypt_sensitive,
          encryption_secret=self._encryption_secret,
        )
        for profile in profiles
      ]
    }
    self._path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = self._path.with_suffix(f"{self._path.suffix}.tmp")
    temp_path.write_text(
      json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
      encoding="utf-8",
    )
    temp_path.replace(self._path)
    self._loaded_mtime_ns = None
    return self.load()

  def upsert(
    self,
    value: Mapping[str, Any],
    *,
    encrypt_sensitive: bool = False,
  ) -> OperatorProfile:
    profile = _parse_single_operator_profile(value, encryption_secret=self._encryption_secret)
    current = list(self.load())
    updated: list[Mapping[str, Any]] = []
    replaced = False
    for item in current:
      if item.operator_id == profile.operator_id:
        updated.append(_operator_profile_to_plain_config_item(profile))
        replaced = True
        continue
      updated.append(_operator_profile_to_plain_config_item(item))
    if not replaced:
      updated.append(_operator_profile_to_plain_config_item(profile))
    saved = self.save(updated, encrypt_sensitive=encrypt_sensitive)
    for item in saved:
      if item.operator_id == profile.operator_id:
        return item
    raise RuntimeError("Saved operator was not found")

  def delete(self, operator_id: str) -> bool:
    target = _clean_string(operator_id)
    if target is None:
      return False
    current = list(self.load())
    next_items = [
      _operator_profile_to_plain_config_item(item)
      for item in current
      if item.operator_id != target
    ]
    if len(next_items) == len(current):
      return False
    self.save(next_items)
    return True

  def encryption_enabled(self) -> bool:
    return bool(self._encryption_secret)


def parse_operator_profiles(
  value: Any,
  *,
  encryption_secret: str | None = None,
) -> list[OperatorProfile]:
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
    if _clean_string(raw_item.get("operatorId") or raw_item.get("operator_id")) is None:
      continue
    profile = _parse_single_operator_profile(raw_item, encryption_secret=encryption_secret)
    operator_id = profile.operator_id
    if operator_id in seen:
      raise ValueError(f"Duplicate operatorId in config: {operator_id}")
    seen.add(operator_id)
    profiles.append(profile)
  return profiles


def encrypt_config_value(value: str, secret: str) -> str:
  plaintext = value.encode("utf-8")
  nonce = secrets.token_bytes(16)
  key = _derive_key(secret)
  ciphertext = _xor_bytes(plaintext, _keystream(key, nonce, len(plaintext)))
  tag = hmac.new(key, b"tag" + nonce + ciphertext, hashlib.sha256).digest()[:16]
  return ENCRYPTED_PREFIX + ":".join([
    _b64encode(nonce),
    _b64encode(ciphertext),
    _b64encode(tag),
  ])


def decrypt_config_value(value: str, secret: str | None) -> str:
  if not is_encrypted_config_value(value):
    return value
  if not secret:
    raise ValueError("Operator config contains encrypted values but no encryption secret is configured")
  parts = value.split(":")
  if len(parts) != 5:
    raise ValueError("Invalid encrypted operator config value")
  _, _, nonce_raw, ciphertext_raw, tag_raw = parts
  nonce = _b64decode(nonce_raw)
  ciphertext = _b64decode(ciphertext_raw)
  expected_tag = hmac.new(
    _derive_key(secret),
    b"tag" + nonce + ciphertext,
    hashlib.sha256,
  ).digest()[:16]
  tag = _b64decode(tag_raw)
  if not hmac.compare_digest(expected_tag, tag):
    raise ValueError("Encrypted operator config value failed authentication")
  key = _derive_key(secret)
  plaintext = _xor_bytes(ciphertext, _keystream(key, nonce, len(ciphertext)))
  return plaintext.decode("utf-8")


def is_encrypted_config_value(value: Any) -> bool:
  return isinstance(value, str) and value.startswith(ENCRYPTED_PREFIX)


def _parse_single_operator_profile(
  raw_item: Mapping[str, Any],
  *,
  encryption_secret: str | None = None,
) -> OperatorProfile:
  operator_id = _clean_string(raw_item.get("operatorId") or raw_item.get("operator_id"))
  if operator_id is None:
    raise ValueError("Operator config item must contain operatorId")
  display_name = _clean_string(raw_item.get("displayName") or raw_item.get("display_name")) or operator_id
  account_name = _clean_string(_decrypt_if_needed(
    raw_item.get("accountName") or raw_item.get("account_name"),
    encryption_secret,
  ))
  note = _clean_string(_decrypt_if_needed(raw_item.get("note"), encryption_secret))
  aliases = _clean_string_tuple(raw_item.get("aliases"))
  return OperatorProfile(
    operator_id=operator_id,
    display_name=display_name,
    account_name=account_name,
    enabled=_bool(raw_item.get("enabled"), True),
    role=_clean_string(raw_item.get("role")),
    note=note,
    aliases=aliases,
  )


def _operator_profile_to_config_item(
  profile: OperatorProfile,
  *,
  encrypt_sensitive: bool,
  encryption_secret: str | None,
) -> dict[str, Any]:
  item = _operator_profile_to_plain_config_item(profile)
  if not encrypt_sensitive:
    return item
  if not encryption_secret:
    raise ValueError("Operator config encryption secret is required to encrypt sensitive fields")
  for key in SENSITIVE_OPERATOR_FIELDS:
    value = item.get(key)
    if isinstance(value, str) and value:
      item[key] = encrypt_config_value(value, encryption_secret)
  return item


def _operator_profile_to_plain_config_item(profile: OperatorProfile) -> dict[str, Any]:
  item: dict[str, Any] = {
    "operatorId": profile.operator_id,
    "displayName": profile.display_name,
    "enabled": profile.enabled,
  }
  if profile.account_name is not None:
    item["accountName"] = profile.account_name
  if profile.role is not None:
    item["role"] = profile.role
  if profile.note is not None:
    item["note"] = profile.note
  if profile.aliases:
    item["aliases"] = list(profile.aliases)
  return item


def _decrypt_if_needed(value: Any, encryption_secret: str | None) -> Any:
  if isinstance(value, str) and is_encrypted_config_value(value):
    return decrypt_config_value(value, encryption_secret)
  return value


def _clean_string_tuple(value: Any) -> tuple[str, ...]:
  if not isinstance(value, list):
    return ()
  items: list[str] = []
  seen: set[str] = set()
  for raw_item in value:
    item = _clean_string(raw_item)
    if item is None or item in seen:
      continue
    seen.add(item)
    items.append(item)
  return tuple(items)


def _default_encryption_secret() -> str | None:
  return (
    _clean_string(os.environ.get("BOSS_ANALYSIS_OPERATOR_CONFIG_SECRET"))
    or _clean_string(os.environ.get("BOSS_ANALYSIS_OPERATOR_ADMIN_PASSWORD"))
  )


def _derive_key(secret: str) -> bytes:
  return hashlib.sha256(secret.encode("utf-8")).digest()


def _keystream(key: bytes, nonce: bytes, size: int) -> bytes:
  chunks: list[bytes] = []
  counter = 0
  while sum(len(chunk) for chunk in chunks) < size:
    chunks.append(hmac.new(
      key,
      nonce + counter.to_bytes(8, "big"),
      hashlib.sha256,
    ).digest())
    counter += 1
  return b"".join(chunks)[:size]


def _xor_bytes(left: bytes, right: bytes) -> bytes:
  return bytes(left_byte ^ right_byte for left_byte, right_byte in zip(left, right))


def _b64encode(value: bytes) -> str:
  return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
  padding = "=" * (-len(value) % 4)
  return base64.urlsafe_b64decode(value + padding)


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
