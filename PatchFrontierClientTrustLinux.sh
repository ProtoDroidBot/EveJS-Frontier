#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Select check explicitly; the patch command only mutates marker-owned staged files.
COMMAND=patch
if [[ "${1:-}" == "--check" ]]; then
  COMMAND=check
  shift
fi
exec bash "$SCRIPT_DIR/FrontierHost.sh" client "$COMMAND" "$@"
