#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$(uname -s)" != "Linux" ]]; then
  echo 'Use StartFrontierServer.ps1 on Windows or StartFrontierServer.sh on macOS.' >&2
  exit 1
fi
exec bash "$REPO_ROOT/FrontierHost.sh" server start "$@"
