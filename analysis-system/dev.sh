#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"
RUN_DIR="${BOSS_ANALYSIS_RUN_DIR:-${ROOT_DIR}/.dev}"

PYTHON_BIN="${PYTHON_BIN:-python3}"
BACKEND_HOST="${BOSS_ANALYSIS_BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BOSS_ANALYSIS_BACKEND_PORT:-8765}"
FRONTEND_HOST="${BOSS_ANALYSIS_FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${BOSS_ANALYSIS_FRONTEND_PORT:-5173}"
REFRESH_SECONDS="${BOSS_ANALYSIS_REFRESH_SECONDS:-15}"
DATA_SOURCE="${BOSS_ANALYSIS_DATA_SOURCE:-summary}"
API_TARGET="${BOSS_ANALYSIS_API_TARGET:-http://${BACKEND_HOST}:${BACKEND_PORT}}"
OPERATOR_CONFIG_FILE="${BOSS_ANALYSIS_OPERATOR_CONFIG_FILE:-config/operators.local.json}"
REQUIRE_REAL_DATA="${BOSS_ANALYSIS_REQUIRE_REAL_DATA:-1}"

BACKEND_PID_FILE="${RUN_DIR}/backend.pid"
FRONTEND_PID_FILE="${RUN_DIR}/frontend.pid"
BACKEND_LOG_FILE="${RUN_DIR}/backend.log"
FRONTEND_LOG_FILE="${RUN_DIR}/frontend.log"

read_pid() {
  local pid_file="$1"
  local pid

  if [[ ! -f "${pid_file}" ]]; then
    return 1
  fi

  pid="$(<"${pid_file}")"
  if [[ ! "${pid}" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  printf "%s\n" "${pid}"
}

is_running() {
  local pid="$1"
  kill -0 "${pid}" 2>/dev/null
}

remove_stale_pid() {
  local pid_file="$1"
  local pid

  if pid="$(read_pid "${pid_file}")"; then
    if ! is_running "${pid}"; then
      rm -f "${pid_file}"
    fi
  else
    rm -f "${pid_file}"
  fi
}

require_not_running() {
  local label="$1"
  local pid_file="$2"
  local pid

  remove_stale_pid "${pid_file}"
  if pid="$(read_pid "${pid_file}")" && is_running "${pid}"; then
    echo "${label} is already running with pid ${pid}." >&2
    echo "Use ./restart.sh to restart it or ./stop.sh to stop it." >&2
    exit 1
  fi
}

port_listeners() {
  local port="$1"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true
}

require_port_free() {
  local label="$1"
  local port="$2"
  local pids

  pids="$(port_listeners "${port}")"
  if [[ -n "${pids}" ]]; then
    echo "${label} port ${port} is already in use by pid(s): ${pids}" >&2
    echo "Use ./stop.sh to clean up this project's dev processes, or choose another port." >&2
    exit 1
  fi
}

stop_started_processes() {
  local pid

  if pid="$(read_pid "${FRONTEND_PID_FILE}")" && is_running "${pid}"; then
    kill "${pid}" 2>/dev/null || true
  fi
  if pid="$(read_pid "${BACKEND_PID_FILE}")" && is_running "${pid}"; then
    kill "${pid}" 2>/dev/null || true
  fi
  rm -f "${FRONTEND_PID_FILE}" "${BACKEND_PID_FILE}"
}

assert_started() {
  local label="$1"
  local pid_file="$2"
  local log_file="$3"
  local pid

  if ! pid="$(read_pid "${pid_file}")" || ! is_running "${pid}"; then
    echo "${label} failed to start. See ${log_file}" >&2
    stop_started_processes
    exit 1
  fi
}

if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  echo "Missing Python executable: ${PYTHON_BIN}" >&2
  exit 1
fi

if [[ ! -x "${FRONTEND_DIR}/node_modules/.bin/vite" ]]; then
  echo "Missing frontend dependencies. Run: cd frontend && npm install" >&2
  exit 1
fi

mkdir -p "${RUN_DIR}"
require_not_running "Backend" "${BACKEND_PID_FILE}"
require_not_running "Frontend" "${FRONTEND_PID_FILE}"
require_port_free "Backend" "${BACKEND_PORT}"
require_port_free "Frontend" "${FRONTEND_PORT}"

export PYTHONPATH="${ROOT_DIR}/src${PYTHONPATH:+:${PYTHONPATH}}"
export BOSS_ANALYSIS_DATA_SOURCE="${DATA_SOURCE}"
export BOSS_ANALYSIS_OPERATOR_CONFIG_FILE="${OPERATOR_CONFIG_FILE}"
export BOSS_ANALYSIS_API_TARGET="${API_TARGET}"

BACKEND_ARGS=(
  "${PYTHON_BIN}"
  -m
  boss_analysis.dev_server
  --host
  "${BACKEND_HOST}"
  --port
  "${BACKEND_PORT}"
  --data-source
  "${DATA_SOURCE}"
  --refresh-seconds
  "${REFRESH_SECONDS}"
  --operator-config-file
  "${OPERATOR_CONFIG_FILE}"
)

if [[ -n "${BOSS_ANALYSIS_DEV_DATA_FILE:-}" ]]; then
  BACKEND_ARGS+=(--data-file "${BOSS_ANALYSIS_DEV_DATA_FILE}")
fi

if [[ "${REQUIRE_REAL_DATA}" == "1" ]]; then
  BACKEND_ARGS+=(--require-real-data)
fi

if [[ "${BOSS_ANALYSIS_NO_DEMO:-1}" == "1" ]]; then
  BACKEND_ARGS+=(--no-demo)
fi

: >"${BACKEND_LOG_FILE}"
: >"${FRONTEND_LOG_FILE}"

(
  backend_pid=""
  cd "${ROOT_DIR}"
  nohup "${BACKEND_ARGS[@]}" >"${BACKEND_LOG_FILE}" 2>&1 &
  backend_pid="$!"
  echo "${backend_pid}" >"${BACKEND_PID_FILE}"
  disown "${backend_pid}" 2>/dev/null || true
)

(
  frontend_pid=""
  cd "${FRONTEND_DIR}"
  nohup env BOSS_ANALYSIS_API_TARGET="${API_TARGET}" \
    "${FRONTEND_DIR}/node_modules/.bin/vite" \
    --host "${FRONTEND_HOST}" \
    --port "${FRONTEND_PORT}" \
    --strictPort >"${FRONTEND_LOG_FILE}" 2>&1 &
  frontend_pid="$!"
  echo "${frontend_pid}" >"${FRONTEND_PID_FILE}"
  disown "${frontend_pid}" 2>/dev/null || true
)

sleep 1
assert_started "Backend" "${BACKEND_PID_FILE}" "${BACKEND_LOG_FILE}"
assert_started "Frontend" "${FRONTEND_PID_FILE}" "${FRONTEND_LOG_FILE}"

echo "Started backend:  http://${BACKEND_HOST}:${BACKEND_PORT} (pid $(<"${BACKEND_PID_FILE}"), ${DATA_SOURCE})"
echo "Started frontend: http://${FRONTEND_HOST}:${FRONTEND_PORT} (pid $(<"${FRONTEND_PID_FILE}"))"
echo "Frontend API target: ${API_TARGET}"
echo "Logs:"
echo "  backend:  ${BACKEND_LOG_FILE}"
echo "  frontend: ${FRONTEND_LOG_FILE}"
echo "Use ./stop.sh to stop, or ./restart.sh to restart."
