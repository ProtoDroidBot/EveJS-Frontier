# Frontier server, world, and client setup

Start here with no EveJS server running and no synchronized Sui world. The
order is **prepare server data and client → prepare the dApp → deploy and sync
the world → start the server → launch the client**. Client setup alone does
not prepare the chain or start either server.

This walkthrough uses the native Windows workflow and its current default
build, `3502403`. That build is an exact-build candidate; see its
[acceptance status](FRONTIER_BUILD_3502403.md). Run everything on the same
Windows computer, from **PowerShell 7.2 or newer in the repository root**.
Each new PowerShell window must also start in that directory.

Native Linux backend and Windows-client Wine/Bottles helpers are now implemented
as an experimental host workflow; see [Linux setup below](#native-linux-backend-and-winebottles-client).
Actual Windows/Wine gameplay acceptance remains build-specific and incomplete.
The original `.sh` client launchers remain macOS-specific; the new Linux client
entry points have `Linux` in their names. For macOS, use the
[README's macOS quickstart](../README.md#frontier-macos-quickstart-build-3467658).

## 1. Prepare the checkout and prerequisites

Have these available before proceeding:

- Git, PowerShell 7.2+, Node.js 24 LTS x64 (`24.11.0` or newer), npm,
  and CPython 3.12 x64.
- An installed Frontier **build `3502403`**, including its `stillness` build
  directory and complete shared `ResFiles` cache.
- Docker running Linux containers, with `docker.exe` on `PATH`.
- `efctl.exe` installed separately and on `PATH`. The world wrapper resolves
  it on each run; it does not install or update it.
- pnpm matching the `packageManager` declared in
  `smart-assembly-control/package.json` (currently `11.19.0`).

For an existing checkout, initialize its pinned repositories:

```powershell
git submodule update --init --recursive
```

A new clone can instead use `git clone --recurse-submodules <repository-url>`.
The three required submodules are `world-contracts`, `builder-scaffold`, and
`smart-assembly-control`. Keep the repository's `efctl.yaml`; the repository
root is the default efctl workspace.

Check the world tools before a long setup run:

```powershell
Get-Command efctl.exe, docker.exe
docker info
```

Resolve a missing executable or stopped Docker engine before continuing.
The native client/server setup script can install missing Git, Node, and
Python through `winget`; it does not supply Docker, efctl, or pnpm. For example,
if pnpm is missing and the declared version is still `11.19.0`, install it with
`npm install --global pnpm@11.19.0`, then check `pnpm --version`.

Use the Frontier scripts below. `SetupEveJS.bat`, `StartServer.bat`, and
`Play.bat` belong to the conventional EVE Online workflow.

## 2. Generate server data and stage the client

Replace the source path with the installed build directory:

```powershell
.\SetupFrontierWindows.ps1 -Build 3502403 -NonInteractive `
  -SourceRoot 'C:\CCP\EVE Frontier\stillness'
```

Wait for setup to complete successfully before continuing. It installs the
locked root and server npm packages, compiles TypeScript, checks the SQLite
binding, creates `_local\frontier-python312`, generates/reuses the game TLS
certificates, extracts and validates the client data, exports public client
contracts, generates the database, and creates a patched, isolated client stage.
It does not synchronize Sui or start the game server.

The stage defaults to
`%LOCALAPPDATA%\EveJS-Frontier\windows\staged-client\3502403`. Its large
`ResFiles` cache is shared with the source through a junction. Add
`-CopyResFiles` to setup for a separate cache copy. The retail executable and
other patched inputs are copied before modification.

Verify the stage without launching it:

```powershell
$stage = "$env:LOCALAPPDATA\EveJS-Frontier\windows\staged-client\3502403"
.\PatchFrontierClientTrust.ps1 -StagedRoot $stage -Check
```

For discovery or a dry run *before* full setup on a fresh checkout, first run
`npm ci --include=dev` so the discovery tools are compiled, then use
`SetupFrontierWindows.ps1 -Status` or `-DryRun` with the same `-Build` and
`-SourceRoot`. See [Windows setup](FRONTIER_WINDOWS_SETUP.md) for staging and
extraction diagnostics. Visual Studio C++ Build Tools and the Windows SDK are
needed only if extraction must compile the embedded-Python fallback runner.

## 3. Prepare the Smart Assembly dApp

The Windows server launcher builds and starts this dApp alongside EveJS, so
prepare it before starting the game server:

```powershell
npm run frontier:dapp:install
npm run frontier:dapp:setup:https
```

HTTPS setup creates `smart-assembly-control\.certs\localhost.pem` and
`localhost-key.pem`. Run it once for a new installation; it refuses to overwrite
existing files. Reuse an existing valid certificate/key pair. If replacement is
intentional, `npm run frontier:dapp:setup:https -- -Force` replaces both files,
and the replacement public certificate must be trusted again.

Certificate generation does **not** install browser trust or change name
resolution. For the configured `https://dev.dapps.evefrontier.com` address:

1. Using an administrator editor, add or reconcile this entry in
   `C:\Windows\System32\drivers\etc\hosts`:

   ```text
   127.0.0.1 dev.dapps.evefrontier.com
   ```

2. In your normal PowerShell session, trust the generated public certificate
   for the current user:

   ```powershell
   Import-Certificate -FilePath '.\smart-assembly-control\.certs\localhost.pem' `
     -CertStoreLocation Cert:\CurrentUser\Root
   ```

Keep `localhost-key.pem` private. The game client's CA setup in step 2 and this
dApp certificate are separate. The dApp's deployment configuration is generated
by world sync in the next step; do not fill in package IDs by hand.

## 4. Bring up and synchronize the world

With no running localnet or synced world, use **`up`**:

```powershell
.\FrontierWorld.ps1 up -Build 3502403
```

Wait for the entire command to succeed. It invokes efctl to start the Docker
environment and deploy the world, checks the live chain against its deployment
artifacts, writes EveJS's private/public world configuration, funds configured
NPC faction wallets, and refreshes the dApp's public `.env.local` and
`.deployment-source.json`. It does not start EveJS.

The normal efctl setup generates the local development keys and
`world-contracts\.env`; no manual admin-key or package-ID entry is needed.

`up` regenerates the disposable local chain. For an already-running chain whose
deployment should be retained, use `sync` instead:

```powershell
.\FrontierWorld.ps1 sync -Build 3502403
```

`sync` alone cannot create a missing chain. After a deployment succeeds but a
later sync step fails, fix the reported problem and retry `sync` against that
running chain.

Check the result:

```powershell
.\FrontierWorld.ps1 status -Build 3502403
```

Expect the environment to be running and EveJS sync state to be `ready` for
build `3502403` on `localnet`. A missing config before the first `up` is normal.
Do not continue after a failed command or a `down`, `starting`, `syncing`, or
`error` state. If the status is unclear, the live chain identifier is available
without printing credentials:

```powershell
docker exec sui-playground timeout 5 sui client `
  --client.env localnet chain-identifier --format hex
```

The private config is `_local\frontier-world\3502403\world.private.json`.
It contains an admin signer; do not paste or commit it. The public feature
manifest is its sibling `world-features.v1.json`. Leave explicit
`EVEJS_SUI_*` deployment/signer overrides unset for this workflow because they
take precedence over synchronized values. See
[world sync](FRONTIER_WORLD_SYNC.md) for ownership checks, alternate workspaces,
and recovery details.

## 5. Start the game server

In the first PowerShell window:

```powershell
.\StartFrontierServer.ps1 -Build 3502403
```

Keep this window open. The launcher initializes/reuses the build's mutable
runtime, verifies the current synchronized chain, compiles the server, builds
the dApp, and starts both processes. Do not start the dApp separately when
using this launcher.

In a second PowerShell window at the repository root, check the processes and
listeners before opening the client:

```powershell
.\StartFrontierServer.ps1 -Build 3502403 -Status
Get-NetTCPConnection -State Listen -LocalPort 443,5222,26000,26101,26102,26103,26401 |
  Select-Object LocalAddress, LocalPort, OwningProcess
(Invoke-WebRequest 'https://dev.dapps.evefrontier.com/').StatusCode
```

Expect both marker-owned processes to be running, the listeners below on
`127.0.0.1`, and an HTTPS status of `200` without bypassing certificate checks.
Process status alone does not prove that all listeners are ready.

| Port | Service |
| --- | --- |
| `26000` | Game TCP |
| `26101` | Image HTTP |
| `26102` | HTTP/bridge and game APIs |
| `26103` | Secure public gateway |
| `5222` | XMPP |
| `26401` | Monitor |
| `443` | Smart Assembly HTTPS dApp |
| `9000` | efctl-managed Sui fullnode, separate from EveJS |

All services stay local to this computer. The standalone market daemon is not
required by this Frontier workflow.

## 6. Launch the staged client

After the server checks pass, run in the second window:

```powershell
.\PlayFrontier.ps1 -Build 3502403
```

The launcher repeats the stage verification and selects loopback game/gateway
addresses, tenant `dev`, Placebo crypto, and the staged resource cache. Use this
launcher to preserve those settings.

Session-free launch is the default. If an official launcher session is needed,
start the official client from the EVE Launcher, capture its arguments, close
that official client, and replay the protected session file:

```powershell
.\CaptureFrontierSession.ps1 -SourceRoot 'C:\CCP\EVE Frontier\stillness'
.\PlayFrontier.ps1 -Build 3502403 -UseCapturedSession
```

New Frontier characters provision their Sui identity on the synchronized local
chain. If this client profile already holds a different
`sui_signer_key_pair_v1`, resolve that saved wallet setting before creating a
character so the client wallet matches EveJS's account-derived development
wallet. These predictable local wallets are for the disposable localnet.

## Stop, resume, and recover

Close the game normally, then press `Ctrl+C` in the foreground server window;
the launcher also cleans up its dApp process. To run without an open server
window, use `StartFrontierServer.ps1 -Build 3502403 -Background` and stop its
recorded processes with `StopFrontier.ps1 -Build 3502403 -ServerOnly`.

Stopping EveJS leaves the chain running. For the next session, check
`FrontierWorld.ps1 status -Build 3502403`, run `sync` if needed, then repeat
steps 5 and 6. Skip the one-time installs, extraction, and staging when their
inputs have not changed.

To stop the chain too, stop the client/server first, then run:

```powershell
.\FrontierWorld.ps1 down -Build 3502403
```

The next `up`, or `restart`, redeploys a disposable chain with new package and
object IDs. EveJS's SQLite runtime is separate and is not erased by world
commands. Retained characters/assemblies may need identity reconciliation after
a chain reset; synchronization of deployment IDs alone does not migrate their
old on-chain objects. Preserve any existing runtime before intentional resets.
`-ResetRuntime` discards mutable game state and is not a routine startup fix.

| Symptom | Next action |
| --- | --- |
| Missing generated data or rejected client hashes | Recheck the exact source build and rerun step 2; use its supported patch profile. |
| Missing dApp modules, deployment config, or TLS files | Finish steps 3 and 4. HTTPS setup alone does not sync the deployment. |
| dApp name resolves elsewhere or HTTPS is untrusted | Recheck the hosts entry and current public certificate in step 3. |
| World config stale or not `ready` | Restore the running localnet and run `sync`; use `up` only when a fresh deployment is intended. |
| `sui-playground` unavailable or chain check fails | Check Docker/efctl status; a retired JSON-RPC HTTP 404 alone is not the gRPC chain check. |
| Another workspace owns efctl containers | Use the owning workspace to stop them, or intentionally select the correct workspace as described in the world guide. |
| Port already occupied | Stop the owning service or an earlier marker-owned Frontier launch, then retry. |

For another client build, follow its build-specific data/contract instructions
and use that exact build consistently in setup, world, server, and client
commands. Changing `-Build` alone does not establish compatibility: Sui sync
requires matching assembly-energy deployment metadata. In particular,
[3640684](FRONTIER_3640684_IMPLEMENTATION.md) has separate world-data preparation
and pending native client acceptance; historical
[EVM clients](client-builds/evm-to-sui.md) have additional bridge requirements.
World synchronization passes the selected build explicitly to NPC funding.
The shared host CLI rejects conflicting inherited build/profile overrides.

## Native Linux backend and Wine/Bottles client

The backend uses native Linux Node.js, npm, PowerShell, Docker, efctl and pnpm.
Wine runs the Windows client and Windows static-data loaders. Use Node.js 24.x
(`24.11.0` or newer), x64, PowerShell 7.2+, native CPython 3.12 x64, and the
pnpm version in `smart-assembly-control/package.json`. Install the prerequisites
with your normal host tools; the repository does not install Wine, GPU drivers,
Docker, efctl or system packages.

Bootstrap compiled tooling on a fresh checkout, in this order:

```bash
npm ci --include=dev --ignore-scripts
npm --prefix server ci
npm run build
```

Ignoring only the root postinstall avoids compiling before the native server
dependencies exist. Server install scripts remain enabled for SQLite. Never
copy `node_modules` between Windows and Linux.

Use an explicit build consistently. These examples use the existing `3502403`
data-generation profile; they do not promote it to gameplay-accepted status.
For `3640684` and cross-cycle world candidates, first follow the selected
[build-specific data preparation](FRONTIER_3640684_IMPLEMENTATION.md) and
[world configuration](EXPLORATION_API.md). The generic extractor/database
workflow does not replace that work or expand its supported-build policy.

```bash
build=3502403
export EVEJS_FRONTIER_NATIVE_PYTHON312=/path/to/native/python3.12
npm run frontier:doctor -- --build "$build" --client-root '/path/to/EVE Frontier/stillness'
```

`doctor` is read-only and exits nonzero for missing prerequisites, mismatched
builds, incomplete/corrupt generated data, or invalid TLS pairs. It never prints
signer keys. Before the first setup, missing generated outputs are expected.

Review setup before running it. Use a separate extraction prefix and an explicit
Windows CPython 3.12 x64 executable for native FSD loaders:

```bash
npm run frontier:setup -- --build "$build" \
  --client-root '/path/to/EVE Frontier/stillness' \
  --wine-runner '/path/to/wine-or-extraction-wrapper' \
  --wine-prefix '/path/to/disposable-extraction-prefix' \
  --wine-python '/path/to/windows-python312/python.exe' \
  --staging-base '/path/to/evejs-staged-client' --dry-run
```

Remove `--dry-run` to install locked packages, create the native Python
environment, generate/reuse TLS pairs, extract/validate data, export contracts,
generate the immutable database baseline and stage an isolated client. The
source may be a launcher-cache root or the exact build directory; discovery
must find the requested build uniquely. Existing data are verified again.
Use `--force-data` only for intentional replacement of exporter-owned outputs.
`--server-only` installs backend/dApp dependencies and TLS files without client
preparation; it does not supply missing generated game data. `--skip-stage`
prepares data without copying the game, and `--skip-dapp` omits dApp installation.

The Linux stage contains a Windows binary marker plus separate Linux host/UID
ownership. Resource caches can be linked or copied with `--copy-resfiles`.
Unknown hashes, overlapping paths, redirected owned paths, and active stages
are rejected. Offline patch/check/restore use the existing exact-build core.

Configure host resolution for `dev.dapps.evefrontier.com` to loopback in
`/etc/hosts`, and trust the generated public
`smart-assembly-control/.certs/localhost.pem` in the browser that will open the
dApp. For `doctor --live` with `NODE_USE_SYSTEM_CA=1`, also install that public
certificate in the Linux system CA store using your distribution's trust tools;
browser-only trust does not configure Node's system trust. These host changes
are deliberately separate from certificate generation. Ensure your Linux policy
allows the dApp process itself to bind port `443`. The launcher checks port
availability and requires that listener to belong to its recorded dApp process;
an independent reverse proxy/forwarder is not supported by this readiness check.

Trust the public game CA and dApp certificate in the **selected gameplay
prefix**, then launch using the same runtime parameters:

```bash
wine_args=(--build "$build" --staged-root "/path/to/evejs-staged-client/$build"
  --wine-runner '/path/to/game-runner/bin/wine'
  --wine-prefix '/path/to/game-prefix'
  --wine-python '/path/to/windows-python312/python.exe')
bash TrustFrontierClientLinux.sh "${wine_args[@]}" \
  --dapp-cert "$PWD/smart-assembly-control/.certs/localhost.pem"

npm run frontier:host -- world up --build "$build"
npm run frontier:host -- server start --build "$build" --background
npm run frontier:host -- server status --build "$build"
NODE_USE_SYSTEM_CA=1 npm run frontier:doctor -- --build "$build" --server-only --live
bash PlayFrontierLinux.sh "${wine_args[@]}"
```

`up` creates a disposable chain. Use `world sync` to retain an already running
deployment. Prefix trust imports only the two supplied public certificates,
verifies their exact identities, and rolls back newly added certificates on
failure. Launch independently requires real Authenticode validation (including
a tampered-image negative control), the exact staged trust check and the
matching CA in the prefix. An unsupported Wine trust implementation produces an
error; it is not silently bypassed.

For a Bottles Flatpak runner add `--flatpak-app com.usebottles.bottles` to
`wine_args`. The wrapper grants the selected stage/prefix access and read-only
access to the retail build directory and tooling for that invocation. A linked
shared resource cache remains writable, matching the Windows cache policy. The selected prefix
must map drive `Z:` to the host filesystem. Select a runner whose libraries,
graphics components and environment work in the chosen sandbox: Bottles
manager settings are not automatically imported. Check the
[Bottles CLI](https://docs.usebottles.com/advanced/cli) and
[filesystem documentation](https://docs.usebottles.com/flatpak/expose-directories).

Linux server initialization seeds root `evejs.config.json` and
`evejs.config.local.json` into a private, owned runtime once. Later runtime
configuration edits survive reuse; edit the runtime copy when changing that
installation's settings. The server preserves source-artifact/live-chain
checks, starts the dApp with the same synchronized deployment, and records
process boot/start/command identity. Stop only its owned processes:

```bash
bash StopFrontierClientLinux.sh --build "$build" \
  --staged-root "/path/to/evejs-staged-client/$build"
npm run frontier:host -- server stop --build "$build"
npm run frontier:host -- world down --build "$build"
```

Client stop requests termination and retains its marker until exit; repeat
status/stop if needed. Runtime reset refuses retained PID markers, exact active
runtime processes and occupied service ports. An interrupted lifecycle lock is
retained with its owner record for deliberate recovery. None of these commands
uses a prefix-wide `wineserver -k`.

Run `npm run test:frontier-host` after compiling. CI now defines native Windows
and Ubuntu jobs for host fixtures, typechecks and static-data tests. The Linux
fixtures exercise process ownership, readiness, rollback and simulated Wine
argument/environment forwarding. They do not establish actual GPU rendering,
Wine trust API behavior, Flatpak execution or gameplay. Record those separately
for each exact client build, Wine runner, graphics configuration and host.
