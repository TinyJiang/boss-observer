from __future__ import annotations

import unittest

from boss_analysis.config import load_settings, public_settings
from boss_analysis.security import redact_mapping, safe_preview


class OperationsSecurityTests(unittest.TestCase):
  def test_load_settings_reads_environment_with_defaults(self):
    settings = load_settings({
      "APP_ENV": "production",
      "PROCESS_ROLE": "cls-consumer",
      "CLS_KAFKA_BROKERS": "broker-a:9092",
      "CLS_KAFKA_TOPIC": "topic-a",
      "CLS_KAFKA_USERNAME": "user-a",
      "CLS_KAFKA_PASSWORD": "password-a",
      "DATABASE_URL": "postgresql://user:pass@example/db",
      "JWT_SECRET": "secret-a",
      "SENSITIVE_DATA_ACCESS_ENABLED": "false",
    })

    self.assertEqual(settings.app_env, "production")
    self.assertEqual(settings.process_role, "cls-consumer")
    self.assertEqual(settings.cls_kafka_group_id, "boss-analysis-system")
    self.assertFalse(settings.sensitive_data_access_enabled)
    self.assertEqual(settings.log_level, "INFO")

  def test_invalid_process_role_is_rejected(self):
    with self.assertRaises(ValueError):
      load_settings({"PROCESS_ROLE": "debug-shell"})

  def test_invalid_boolean_is_rejected(self):
    with self.assertRaises(ValueError):
      load_settings({"SENSITIVE_DATA_ACCESS_ENABLED": "maybe"})

  def test_public_settings_redacts_secrets(self):
    settings = load_settings({
      "CLS_KAFKA_PASSWORD": "password-a",
      "DATABASE_URL": "postgresql://user:pass@example/db",
      "JWT_SECRET": "secret-a",
      "SENSITIVE_DATA_ACCESS_ENABLED": "true",
    })

    public = public_settings(settings)

    self.assertEqual(public["cls_kafka_password"], "***REDACTED***")
    self.assertEqual(public["database_url"], "***REDACTED***")
    self.assertEqual(public["jwt_secret"], "***REDACTED***")
    self.assertTrue(public["sensitive_data_access_enabled"])

  def test_redact_mapping_masks_sensitive_key_names(self):
    redacted = redact_mapping({
      "authorization": "Bearer abc",
      "plain_value": "visible",
      "api_key": "key-a",
    })

    self.assertEqual(redacted["authorization"], "***REDACTED***")
    self.assertEqual(redacted["api_key"], "***REDACTED***")
    self.assertEqual(redacted["plain_value"], "visible")

  def test_safe_preview_masks_contact_info_and_truncates(self):
    preview = safe_preview(
      "phone 13812345678 email test@example.com " + ("x" * 500),
      limit=64,
    )

    self.assertLessEqual(len(preview), 64)
    self.assertIn("138****5678", preview)
    self.assertIn("t***@example.com", preview)
    self.assertNotIn("13812345678", preview)
    self.assertNotIn("test@example.com", preview)


if __name__ == "__main__":
  unittest.main()
