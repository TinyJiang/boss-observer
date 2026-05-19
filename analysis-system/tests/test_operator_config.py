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
          "enabled": True,
          "role": "招聘操作员",
        }
      ]
    })

    self.assertEqual(len(profiles), 1)
    self.assertEqual(profiles[0].operator_id, "zhouxinyu")
    self.assertEqual(profiles[0].display_name, "zhouxinyu")
    self.assertEqual(profiles[0].account_name, "谢女士")
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


if __name__ == "__main__":
  unittest.main()
