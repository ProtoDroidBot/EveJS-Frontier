#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${EVEJS_FRONTIER_NATIVE_PYTHON312:-${SCRIPT_DIR}/_local/frontier-python312-linux/bin/python}"
if [[ -z "${EVEJS_FRONTIER_NATIVE_PYTHON312:-}" && ! -x "$PYTHON" ]]; then PYTHON=python3.12; fi
# Select check explicitly; the patch command only mutates marker-owned staged files.
COMMAND=patch
if [[ "${1:-}" == "--check" ]]; then
  COMMAND=check
  shift
fi
exec "$PYTHON" -B "${SCRIPT_DIR}/tools/frontier-client/frontier_linux_client.py" "$COMMAND" "$@"
