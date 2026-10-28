#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 24.11+ (24.x) is required on PATH.' >&2
  exit 1
fi
if [[ ! -f "$repo_root/tools/frontier-host/index.mjs" ]]; then
  echo 'Host tools are not compiled. Run npm ci --include=dev, then npm run build:tools.' >&2
  exit 1
fi
exec node "$repo_root/tools/frontier-host/index.mjs" "$@"
