#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$(uname -s)" == "Linux" ]]; then
  exec bash "$REPO_ROOT/StartFrontierServerLinux.sh" "$@"
fi
BUILD="3467658"
RESET_RUNTIME=false
LOG_LEVEL="2"

usage() {
  cat <<'EOF'
Usage: bash StartFrontierServer.sh [options]

Starts an isolated EVE Frontier compatibility server on local development
ports. It never reads or writes the live EveJS game store.

Options:
  --build <number>   Extracted/generated Frontier build. Default: 3467658
  --reset-runtime   Replace the disposable runtime database from its generated baseline
  --quiet           Use normal rather than verbose server logging
  -h, --help        Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build)
      BUILD="$2"
      shift 2
      ;;
    --reset-runtime)
      RESET_RUNTIME=true
      shift
      ;;
    --quiet)
      LOG_LEVEL="1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[evejs-frontier] Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! [[ "$BUILD" =~ ^[0-9]+$ ]]; then
  echo "[evejs-frontier] Build must be numeric: $BUILD" >&2
  exit 1
fi

PROJECT_CODENAME="cycle-6"
if [[ "$BUILD" == "3640684" ]]; then PROJECT_CODENAME="cycle-7"; fi
CLIENT_VERSION="20.04"
MACHO_VERSION="489"

GENERATED_ROOT="${REPO_ROOT}/_local/frontier-gameStore/${BUILD}"
GENERATED_DATA="${GENERATED_ROOT}/data"
GENERATED_ASSETS="${GENERATED_ROOT}/assets"
RUNTIME_ROOT="${REPO_ROOT}/_local/frontier-runtime/${BUILD}"
RUNTIME_GAMESTORE="${RUNTIME_ROOT}/gameStore"
RUNTIME_DATA="${RUNTIME_GAMESTORE}/data"
RUNTIME_MARKER="${RUNTIME_ROOT}/.evejs-frontier-runtime"
STATIC_ROOT="${REPO_ROOT}/_local/frontier-sde/${BUILD}"

if [[ ! -d "$GENERATED_DATA" ]]; then
  echo "[evejs-frontier] Generated Frontier database is missing: $GENERATED_DATA" >&2
  echo "[evejs-frontier] Run: npm run frontier:database -- --force" >&2
  exit 1
fi
if [[ ! -d "$STATIC_ROOT" ]]; then
  echo "[evejs-frontier] Frontier static snapshot is missing: $STATIC_ROOT" >&2
  exit 1
fi

if [[ ! -f "${REPO_ROOT}/node_modules/typescript/bin/tsc" ]]; then
  echo "[evejs-frontier] Installing the TypeScript build dependencies ..."
  npm --prefix "$REPO_ROOT" ci --include=dev
fi
echo "[evejs-frontier] Compiling TypeScript ..."
npm --prefix "$REPO_ROOT" run build

# Exact EVM profiles own their historical handshake fields. Their backend
# configuration is prepared locally; a missing world never starts Docker.
EVM_PROFILE_INFO="$(node -e '
const fs = require("node:fs");
const catalog = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const profile = catalog.profiles.find(entry => String(entry.clientBuild) === process.argv[2]);
if (profile?.blockchain?.protocol === "evm") process.stdout.write([
  profile.id, profile.clientCodename, Number(profile.clientVersion).toFixed(2), profile.machoVersion,
].join("\t"));
' "$REPO_ROOT/server/src/config/clientBuildCatalog.json" "$BUILD")"
SUI_WORLD_CONFIG_PATH="${EVEJS_SUI_WORLD_CONFIG_PATH:-$REPO_ROOT/_local/frontier-world/$BUILD/world.private.json}"
if [[ "$SUI_WORLD_CONFIG_PATH" != /* ]]; then SUI_WORLD_CONFIG_PATH="$REPO_ROOT/$SUI_WORLD_CONFIG_PATH"; fi
LEGACY_EVM_ENV=()
if [[ -n "$EVM_PROFILE_INFO" ]]; then
  IFS=$'\t' read -r EVM_PROFILE PROJECT_CODENAME CLIENT_VERSION MACHO_VERSION <<< "$EVM_PROFILE_INFO"
  if [[ -n "${EVEJS_CLIENT_BUILD_PROFILE:-}" && "$EVEJS_CLIENT_BUILD_PROFILE" != "auto" && "$EVEJS_CLIENT_BUILD_PROFILE" != "$EVM_PROFILE" ]]; then
    echo "[evejs-frontier] EVEJS_CLIENT_BUILD_PROFILE does not match EVM build $BUILD." >&2
    exit 1
  fi
  LEGACY_EVM_PATH="${EVEJS_LEGACY_EVM_SUI_BRIDGE_PATH:-}"
  if [[ -z "$LEGACY_EVM_PATH" && -f "$SUI_WORLD_CONFIG_PATH" ]]; then
    LEGACY_EVM_PATH="$(node -e '
const fs = require("node:fs"), path = require("node:path");
const file = process.argv[1], world = JSON.parse(fs.readFileSync(file, "utf8"));
if (Object.hasOwn(world, "legacyEvmBridgePath")) {
  if (typeof world.legacyEvmBridgePath !== "string" || !world.legacyEvmBridgePath.trim())
    throw new Error("The world configuration has an invalid EVM backend reference");
  const manifest = path.resolve(path.dirname(file), world.legacyEvmBridgePath);
  if (!fs.existsSync(manifest)) throw new Error("Referenced EVM backend secrets are missing; restore them before starting");
  process.stdout.write(manifest);
}
' "$SUI_WORLD_CONFIG_PATH")"
  fi
  if [[ -z "$LEGACY_EVM_PATH" ]]; then LEGACY_EVM_PATH="$(dirname -- "$SUI_WORLD_CONFIG_PATH")/legacy-evm-sui.private.json"; fi
  if [[ "$LEGACY_EVM_PATH" != /* ]]; then LEGACY_EVM_PATH="$REPO_ROOT/$LEGACY_EVM_PATH"; fi
  LEGACY_SYNC_ARGS=(--world-config "$SUI_WORLD_CONFIG_PATH" --build "$BUILD" --out "$LEGACY_EVM_PATH")
  if [[ ! -f "$SUI_WORLD_CONFIG_PATH" ]]; then LEGACY_SYNC_ARGS+=(--prepare-only); fi
  if [[ ! -f "$REPO_ROOT/tools/frontier-contracts/sync-legacy-evm-sui.mjs" ]]; then
    echo "[evejs-frontier] EVM backend startup requires npm run build:server and npm run build:tools." >&2
    exit 1
  fi
  LEGACY_SYNC_RESULT="$(node "$REPO_ROOT/tools/frontier-contracts/sync-legacy-evm-sui.mjs" "${LEGACY_SYNC_ARGS[@]}")"
  LEGACY_EVM_PATH="$(printf '%s' "$LEGACY_SYNC_RESULT" | node -e '
let input=""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => {
  const result = JSON.parse(input);
  if (!result.enabled || String(result.clientBuild) !== process.argv[1] || typeof result.manifestPath !== "string")
    throw new Error("Automatic EVM backend selected a mismatched manifest");
  process.stdout.write(result.manifestPath);
});
' "$BUILD")"
  LEGACY_EVM_ENV=("EVEJS_CLIENT_BUILD_PROFILE=$EVM_PROFILE" "EVEJS_LEGACY_EVM_SUI_BRIDGE_PATH=$LEGACY_EVM_PATH")
  echo "[evejs-frontier] EVM-to-Sui backend: $LEGACY_EVM_PATH"
fi

if [[ "$RESET_RUNTIME" == true && -e "$RUNTIME_ROOT" ]]; then
  if [[ ! -f "$RUNTIME_MARKER" ]]; then
    echo "[evejs-frontier] Refusing to reset an unrecognized runtime: $RUNTIME_ROOT" >&2
    exit 1
  fi
  rm -rf "$RUNTIME_ROOT"
fi

if [[ ! -d "$RUNTIME_DATA" ]]; then
  mkdir -p "$(dirname "$RUNTIME_DATA")"
  ditto "$GENERATED_DATA" "$RUNTIME_DATA"
  printf 'build=%s\n' "$BUILD" > "$RUNTIME_MARKER"
  echo "[evejs-frontier] Created isolated runtime from generated build $BUILD."
fi

# Assets and their attestation are immutable generated inputs, not runtime
# state. Refreshing them is safe when reusing a marker-owned runtime and lets a
# newly extracted collision bundle become active without discarding the DB.
mkdir -p "$RUNTIME_GAMESTORE"
cp "${GENERATED_ROOT}/manifest.json" "${RUNTIME_GAMESTORE}/manifest.json"
cp "${GENERATED_ROOT}/manifest.json" "${RUNTIME_ROOT}/generated-manifest.json"
if [[ -d "$GENERATED_ASSETS" ]]; then
  mkdir -p "${RUNTIME_GAMESTORE}/assets"
  ditto "$GENERATED_ASSETS" "${RUNTIME_GAMESTORE}/assets"
fi

echo "[evejs-frontier] Runtime: $RUNTIME_ROOT"
echo "[evejs-frontier] Game TCP: 127.0.0.1:26000"
echo "[evejs-frontier] Profile: Frontier $CLIENT_VERSION build $BUILD, MachoNet $MACHO_VERSION, Placebo"

cd "$REPO_ROOT"
exec env \
  "${LEGACY_EVM_ENV[@]}" \
  EVEJS_GAMESTORE_DATA_DIR="$RUNTIME_DATA" \
  EVEJS_COLLISION_BUNDLE_REQUIRED="1" \
  EVEJS_STATIC_JSONL_ROOT="$STATIC_ROOT" \
  EVEJS_CLIENT_COMPATIBILITY_PROFILE="frontier" \
  EVEJS_CLIENT_VERSION="$CLIENT_VERSION" \
  EVEJS_CLIENT_BUILD="$BUILD" \
  EVEJS_EVE_BIRTHDAY="170472" \
  EVEJS_MACHO_VERSION="$MACHO_VERSION" \
  EVEJS_PROJECT_CODENAME="$PROJECT_CODENAME" \
  EVEJS_PROJECT_REGION="ccp" \
  EVEJS_PROJECT_VERSION="V20.04@ccp" \
  EVEJS_SUI_WORLD_CONFIG_PATH="$SUI_WORLD_CONFIG_PATH" \
  EVEJS_GAME_SERVER_BIND_HOST="127.0.0.1" \
  EVEJS_GAME_SERVER_HOST="127.0.0.1" \
  EVEJS_SERVER_PORT="26000" \
  EVEJS_IMAGE_SERVER_URL="http://127.0.0.1:26101/" \
  EVEJS_IMAGE_SERVER_BIND_HOST="127.0.0.1" \
  EVEJS_MICROSERVICES_REDIRECT_URL="http://127.0.0.1:26102/" \
  EVEJS_MICROSERVICES_PUBLIC_BASE_URL="http://127.0.0.1:26102/" \
  EVEJS_MICROSERVICES_BIND_HOST="127.0.0.1" \
  EVEJS_PROXY_LOOPBACK_CDN_LISTEN_PORT="0" \
  EVEJS_REDSHIFT_MONITOR_PORT="26401" \
  EVEJS_XMPP_SERVER_PORT="5222" \
  EVEJS_XMPP_CONNECT_HOST="127.0.0.1" \
  EVEJS_XMPP_DOMAIN="frontier.localhost" \
  EVEJS_XMPP_CONFERENCE_DOMAIN="conference.frontier.localhost" \
  EVEJS_DEV_AUTO_CREATE_ACCOUNTS="true" \
  EVEJS_DEV_SKIP_PASSWORD_VALIDATION="true" \
  EVEJS_WORMHOLES_ENABLED="false" \
  EVEJS_MARKET_DAEMON_ENABLED="false" \
  EVEJS_SKIP_NPC_STARTUP="1" \
  EVEJS_LOG_LEVEL="$LOG_LEVEL" \
  node --enable-source-maps server/index.js
