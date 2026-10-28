#!/usr/bin/env bash
set -euo pipefail

# Use native PowerShell and native backend tools; Wine is only for the client.
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v pwsh >/dev/null 2>&1; then
  printf '%s\n' 'PowerShell 7.2 or newer (pwsh) is required for Frontier world lifecycle commands.' >&2
  exit 1
fi
exec pwsh -NoLogo -NoProfile -File "$repo_root/FrontierWorld.ps1" "$@"
