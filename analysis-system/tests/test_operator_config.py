from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from boss_analysis.operator_config import OperatorConfigProvider, parse_operator_profiles


class OperatorConfigTests(unittest.TestCase):
  def test_parse_operator_profiles_accepts_camel_case_schema(self):
    profiles = parse_operator_profiles({
      "operators": [
        {
          "operatorId": "zhouxinyu",
          "displayName": "zhouxinyu",
          "accountName": "谢女士",
          "aliases": ["周心语"],
          "enabled": True,
          "role": "招聘操作员",
        }
      ]
    })

    self.assertEqual(len(profiles), 1)
    self.assertEqual(profiles[0].operator_id, "zhouxinyu")
    self.assertEqual(profiles[0].display_name, "zhouxinyu")
    self.assertEqual(profiles[0].account_name, "谢女士")
    self.assertEqual(profiles[0].aliases, ("周心语",))
    self.assertTrue(profiles[0].enabled)

  def test_parse_operator_profiles_rejects_duplicate_ids(self):
    with self.assertRaisesRegex(ValueError, "Duplicate operatorId"):
      parse_operator_profiles({
        "operators": [
          {"operatorId": "op_001"},
          {"operatorId": "op_001"},
        ]
      })

  def test_operator_config_provider_hot_loads_changed_file(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "operators.json"
      path.write_text(json.dumps({
        "operators": [
          {"operatorId": "op_001", "displayName": "Operator A"},
        ]
      }), encoding="utf-8")
      provider = OperatorConfigProvider(path)

      first = provider.load()
      path.write_text(json.dumps({
        "operators": [
          {"operatorId": "op_001", "displayName": "Operator A+"},
          {"operatorId": "op_002", "displayName": "Operator B"},
        ]
      }), encoding="utf-8")
      second = provider.load()

    self.assertEqual(first[0].display_name, "Operator A")
    self.assertEqual(second[0].display_name, "Operator A+")
    self.assertEqual(second[1].operator_id, "op_002")

  def test_operator_config_provider_writes_encrypted_sensitive_fields(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "operators.json"
      provider = OperatorConfigProvider(path, encryption_secret="local-secret")

      saved = provider.save([
        {
          "operatorId": "op_001",
          "displayName": "Operator A",
          "accountName": "谢女士",
          "enabled": True,
          "role": "招聘操作员",
          "note": "本地备注",
        }
      ], encrypt_sensitive=True)
      raw = json.loads(path.read_text(encoding="utf-8"))
      loaded = provider.load()

    self.assertEqual(saved[0].account_name, "谢女士")
    self.assertEqual(saved[0].note, "本地备注")
    self.assertEqual(loaded[0].account_name, "谢女士")
    self.assertEqual(loaded[0].note, "本地备注")
    self.assertNotEqual(raw["operators"][0]["accountName"], "谢女士")
    self.assertNotEqual(raw["operators"][0]["note"], "本地备注")
    self.assertTrue(raw["operators"][0]["accountName"].startswith("enc:v1:"))
    self.assertTrue(raw["operators"][0]["note"].startswith("enc:v1:"))

  def test_operator_config_provider_can_create_update_and_delete_operator(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "operators.json"
      provider = OperatorConfigProvider(path)

      created = provider.upsert({
        "operatorId": "op_001",
        "displayName": "Operator A",
        "accountName": "谢女士",
        "enabled": True,
      })
      updated = provider.upsert({
        "operatorId": "op_001",
        "displayName": "Operator A+",
        "accountName": "谢女士",
        "enabled": False,
      })
      deleted = provider.delete("op_001")
      loaded = provider.load()

    self.assertEqual(created.display_name, "Operator A")
    self.assertEqual(updated.display_name, "Operator A+")
    self.assertFalse(updated.enabled)
    self.assertTrue(deleted)
    self.assertEqual(loaded, ())

  def test_operator_config_provider_preserves_aliases(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "operators.json"
      provider = OperatorConfigProvider(path)

      saved = provider.save([
        {
          "operatorId": "wujiahao",
          "displayName": "吴先生",
          "aliases": ["吴佳豪", "吴先生"],
          "enabled": True,
        }
      ])
      raw = json.loads(path.read_text(encoding="utf-8"))
      loaded = provider.load()

    self.assertEqual(saved[0].aliases, ("吴佳豪", "吴先生"))
    self.assertEqual(loaded[0].aliases, ("吴佳豪", "吴先生"))
    self.assertEqual(raw["operators"][0]["aliases"], ["吴佳豪", "吴先生"])

  def test_operator_config_provider_rejects_sensitive_encryption_without_secret(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "operators.json"
      provider = OperatorConfigProvider(path)

      with self.assertRaisesRegex(ValueError, "encryption secret"):
        provider.save([
          {
            "operatorId": "op_001",
            "displayName": "Operator A",
            "accountName": "谢女士",
          }
        ], encrypt_sensitive=True)


if __name__ == "__main__":
  unittest.main()
