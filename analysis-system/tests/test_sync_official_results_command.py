from __future__ import annotations

import unittest
from unittest.mock import patch

from boss_analysis.ops import sync_official_results_cdp


class SyncOfficialResultsCommandTests(unittest.TestCase):
  def test_positional_date_runs_cdp_collect_and_upload(self):
    with patch.object(sync_official_results_cdp.sync_official_results, "main", return_value=0) as base_main:
      exit_code = sync_official_results_cdp.main(["2026-06-15"])

    self.assertEqual(exit_code, 0)
    self.assertEqual(base_main.call_args.args[0], [
      "--source",
      "cdp",
      "--date",
      "2026-06-15",
    ])

  def test_optional_flags_are_forwarded_to_base_command(self):
    with patch.object(sync_official_results_cdp.sync_official_results, "main", return_value=0) as base_main:
      sync_official_results_cdp.main([
        "2026-06-15",
        "--dry-run",
        "--cdp-url",
        "http://127.0.0.1:9333",
        "--env-file",
        ".env.local",
        "--operator-config-file",
        "config/operators.local.json",
      ])

    self.assertEqual(base_main.call_args.args[0], [
      "--source",
      "cdp",
      "--date",
      "2026-06-15",
      "--dry-run",
      "--cdp-url",
      "http://127.0.0.1:9333",
      "--env-file",
      ".env.local",
      "--operator-config-file",
      "config/operators.local.json",
    ])


if __name__ == "__main__":
  unittest.main()
