#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"
RUN_DIR="${BOSS_ANALYSIS_RUN_DIR:-${ROOT_DIR}/.dev}"

BACKEND_PORT="${BOSS_ANALYSIS_BACKEND_PORT:-8765}"
FRONTEND_PORT="${BOSS_ANALYSIS_FRONTEND_PORT:-5173}"
STOP_TIMEOUT_SECONDS="${BOSS_ANALYSIS_STOP_TIMEOUT_SECONDS:-10}"

BACKEND_PID_FILE="${RUN_DIR}/backend.pid"
FRONTEND_PID_FILE="${RUN_DIR}/frontend.pid"

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

command_for_pid() {
  local pid="$1"
  ps -p "${pid}" -o command= 2>/dev/null || true
}

wait_for_exit() {
  local pid="$1"
  local waited=0

  while is_running "${pid}"; do
    if (( waited >= STOP_TIMEOUT_SECONDS )); then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done

  return 0
}

stop_pid() {
  local label="$1"
  local pid="$2"

  if ! is_running "${pid}"; then
    return 0
  fi

  echo "Stopping ${label} (pid ${pid})..."
  if ! kill "${pid}" 2>/dev/null; then
    echo "Failed to stop ${label} (pid ${pid})." >&2
    return 1
  fi

  if ! wait_for_exit "${pid}"; then
    echo "${label} did not exit after ${STOP_TIMEOUT_SECONDS}s; sending SIGKILL."
    kill -KILL "${pid}" 2>/dev/null || true
  fi
}

stop_pid_file() {
  local label="$1"
  local pid_file="$2"
  local pid

  if pid="$(read_pid "${pid_file}")"; then
    stop_pid "${label}" "${pid}"
  fi
  rm -f "${pid_file}"
}

port_listeners() {
  local port="$1"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true
}

stop_matching_port_listener() {
  local label="$1"
  local port="$2"
  local pattern="$3"
  local pid
  local command

  for pid in $(port_listeners "${port}"); do
    command="$(command_for_pid "${pid}")"
    if [[ "${command}" == *"${pattern}"* ]]; then
      stop_pid "${label} port ${port} listener" "${pid}"
    else
      echo "Port ${port} is still used by unrelated pid ${pid}: ${command}" >&2
    fi
  done
}

stop_matching_processes() {
  local label="$1"
  local pattern="$2"
  local pid

  for pid in $(pgrep -f "${pattern}" 2>/dev/null || true); do
    if [[ "${pid}" == "$$" ]]; then
      continue
    fi
    stop_pid "${label}" "${pid}"
  done
}

stop_pid_file "frontend" "${FRONTEND_PID_FILE}"
stop_pid_file "backend" "${BACKEND_PID_FILE}"

stop_matching_port_listener "backend" "${BACKEND_PORT}" "boss_analysis.dev_server"
stop_matching_port_listener "frontend" "${FRONTEND_PORT}" "${FRONTEND_DIR}/node_modules/.bin/vite"
stop_matching_processes "frontend esbuild helper" "${FRONTEND_DIR}/node_modules/@esbuild"

echo "Stopped analysis-system dev processes."
