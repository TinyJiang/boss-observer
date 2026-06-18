#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
PYTHONPATH=src exec python3 -m boss_analysis.ops.sync_official_results_cdp "$@"
