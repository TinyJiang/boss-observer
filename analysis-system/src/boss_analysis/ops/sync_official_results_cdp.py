"""Convenience command for manual CDP official result sync.

This module is a thin wrapper around sync_official_results. It fixes the source
to CDP so a manual run only needs the target statistics date.
"""

from __future__ import annotations

import argparse

from boss_analysis.ops import sync_official_results


def main(argv: list[str] | None = None) -> int:
  args = build_parser().parse_args(argv)
  base_args = [
    "--source",
    "cdp",
    "--date",
    args.date,
  ]
  if args.dry_run:
    base_args.append("--dry-run")
  if args.cdp_url:
    base_args.extend(["--cdp-url", args.cdp_url])
  for env_file in args.env_file or []:
    base_args.extend(["--env-file", env_file])
  if args.operator_config_file:
    base_args.extend(["--operator-config-file", args.operator_config_file])
  return sync_official_results.main(base_args)


def build_parser() -> argparse.ArgumentParser:
  parser = argparse.ArgumentParser(
    description="Collect one day's BOSS official results through CDP and upload them to Feishu.",
  )
  parser.add_argument(
    "date",
    help="Target statistics date in YYYY-MM-DD.",
  )
  parser.add_argument(
    "--dry-run",
    action="store_true",
    help="Print the Feishu create/update plan without writing records.",
  )
  parser.add_argument(
    "--cdp-url",
    help="Chrome DevTools HTTP endpoint. Defaults to BOSS_OFFICIAL_RESULTS_CDP_URL or http://127.0.0.1:9222.",
  )
  parser.add_argument(
    "--env-file",
    action="append",
    help="Optional .env file to load before reading runtime config. Can be repeated.",
  )
  parser.add_argument(
    "--operator-config-file",
    help="Local operator mapping JSON path. Defaults to BOSS_ANALYSIS_OPERATOR_CONFIG_FILE.",
  )
  return parser


if __name__ == "__main__":
  raise SystemExit(main())
