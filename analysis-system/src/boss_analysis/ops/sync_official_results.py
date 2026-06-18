"""One-shot sync entry for BOSS official result rows.

No scheduler is implemented here. External orchestration should invoke this
module once per target date.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from typing import Any

from boss_analysis.dev_server import load_env_files
from boss_analysis.feishu.bitable import FeishuBitableClient, default_table_ids
from boss_analysis.official_results.cdp_source import BossOfficialResultsCdpSource
from boss_analysis.official_results.source import BossOfficialResultsApiSource, JsonOfficialResultsSource
from boss_analysis.official_results.sync import (
  DEFAULT_TIMEZONE_NAME,
  OfficialResultsSyncResult,
  resolve_sync_date,
  run_official_results_sync,
)
from boss_analysis.operator_config import OperatorConfigProvider


def main(argv: list[str] | None = None) -> int:
  parser = build_parser()
  args = parser.parse_args(argv)
  load_env_files(args.env_file)
  try:
    target_date = resolve_sync_date(
      args.date,
      clock=datetime.now,
      timezone_name=args.timezone,
    )
    source = _build_source(args)
    feishu_client = FeishuBitableClient.from_env()
    operator_table_id, job_table_id = default_table_ids()
    operator_profiles = OperatorConfigProvider(args.operator_config_file).load()
    result = run_official_results_sync(
      target_date=target_date,
      source=source,
      feishu_client=feishu_client,
      operator_profiles=operator_profiles,
      dry_run=args.dry_run,
      operator_table_id=operator_table_id,
      job_table_id=job_table_id,
    )
  except ValueError as error:
    parser.exit(status=2, message=f"error: {error}\n")
  except Exception as error:
    parser.exit(status=1, message=f"error: {error}\n")
  print(json.dumps(_result_summary(result), ensure_ascii=False, indent=2))
  return 0


def build_parser() -> argparse.ArgumentParser:
  parser = argparse.ArgumentParser(
    description="Sync one day's BOSS official result rows into Feishu Bitable.",
  )
  parser.add_argument(
    "--date",
    help="Target statistics date in YYYY-MM-DD. Defaults to yesterday in --timezone.",
  )
  parser.add_argument(
    "--timezone",
    default=os.environ.get("APP_TIMEZONE", DEFAULT_TIMEZONE_NAME),
    help=f"Timezone for default date resolution. Default: {DEFAULT_TIMEZONE_NAME}.",
  )
  parser.add_argument(
    "--dry-run",
    action="store_true",
    help="Read sources and Feishu existing records, then print create/update counts without writing.",
  )
  parser.add_argument(
    "--source",
    choices=("api", "cdp", "file"),
    default=None,
    help="BOSS official result source. Default: api, or file when --source-file is set.",
  )
  parser.add_argument(
    "--cdp-url",
    help="Chrome DevTools HTTP endpoint for --source cdp. Default: BOSS_OFFICIAL_RESULTS_CDP_URL or http://127.0.0.1:9222.",
  )
  parser.add_argument(
    "--source-file",
    help="Read BOSS raw result rows from a local JSON file instead of calling BOSS API. Implies --source file.",
  )
  parser.add_argument(
    "--operator-config-file",
    default=os.environ.get("BOSS_ANALYSIS_OPERATOR_CONFIG_FILE"),
    help="Local operator mapping JSON path. Defaults to BOSS_ANALYSIS_OPERATOR_CONFIG_FILE.",
  )
  parser.add_argument(
    "--env-file",
    action="append",
    help="Optional .env file to load before reading runtime config. Can be repeated.",
  )
  return parser


def _build_source(args: argparse.Namespace):
  if args.source_file:
    return JsonOfficialResultsSource.from_path(args.source_file)
  source_name = args.source or "api"
  if source_name == "file":
    raise ValueError("--source file requires --source-file")
  if source_name == "cdp":
    return BossOfficialResultsCdpSource.from_env(cdp_url=args.cdp_url)
  return BossOfficialResultsApiSource.from_env()


def _result_summary(result: OfficialResultsSyncResult) -> dict[str, Any]:
  plan = result.plan
  return {
    "dry_run": result.dry_run,
    "target_date": plan.target_date.isoformat(),
    "operator_rows": plan.summary.operator_row_count,
    "job_rows": plan.summary.job_row_count,
    "would_create": plan.summary.create_count,
    "would_update": plan.summary.update_count,
    "applied_create": result.applied_create_count,
    "applied_update": result.applied_update_count,
    "unmatched_operator_count": len(plan.summary.unmatched_operator_names),
    "missing_source_fields": list(plan.summary.missing_source_fields),
  }


if __name__ == "__main__":
  raise SystemExit(main())
