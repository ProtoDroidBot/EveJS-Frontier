#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Retain this compatibility entry's sync/build defaults while sharing the host
# dispatcher, option translation and exact-build checks with npm and PowerShell.
case "${1:-}" in
  --help|-h|help|'-?') exec bash "$repo_root/FrontierHost.sh" world --help ;;
  [Uu][Pp]) action=up; shift ;;
  [Ss][Yy][Nn][Cc]) action=sync; shift ;;
  [Ss][Tt][Aa][Tt][Uu][Ss]) action=status; shift ;;
  [Dd][Oo][Ww][Nn]) action=down; shift ;;
  [Rr][Ee][Ss][Tt][Aa][Rr][Tt]) action=restart; shift ;;
  *) action=sync ;;
esac
build_selected=false
for argument in "$@"; do
  [[ "$argument" == -- ]] && break
  case "$argument" in
    --build|-[Bb][Uu][Ii][Ll][Dd]) build_selected=true ;;
  esac
done
if [[ "$build_selected" == false ]]; then
  set -- --build 3502403 "$@"
fi
exec bash "$repo_root/FrontierHost.sh" world "$action" "$@"
