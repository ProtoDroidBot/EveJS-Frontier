#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$(uname -s)" != "Linux" ]]; then
  echo 'Use StartFrontierServer.ps1 on Windows or StartFrontierServer.sh on macOS.' >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo 'Native Linux Node >=24.11.0 must be in PATH.' >&2
  exit 1
fi
if [[ ! -f "$REPO_ROOT/tools/frontier-host/server.mjs" ]]; then
  echo 'Host tools are not compiled. Run npm ci --include=dev and npm run build:production.' >&2
  exit 1
fi
exec node "$REPO_ROOT/tools/frontier-host/server.mjs" start "$@"
