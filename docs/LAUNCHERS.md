# Launcher Guide

This is the "what should I click?" page. First decide whether you are running
EVE Frontier or conventional EVE Online; their launchers and client patches
are intentionally separate.

## EVE Frontier on Windows and Linux

Use the same npm commands for setup, world synchronization and daily launch.
Each command requires the exact client build; the examples use the Windows
candidate `3502403`. See [FRONTIER_SETUP.md](FRONTIER_SETUP.md) for first-time
prerequisites, host/prefix trust and Linux Wine parameters.

| Run this | Use it when | What it does |
|---|---|---|
| `npm run frontier:doctor -- --build 3502403` | Inspect host readiness | Checks prerequisites, exact-build data and TLS without changing them |
| `npm run frontier:setup -- --build 3502403 --client-root <path>` | First setup or a build refresh | Installs locked dependencies in order, compiles, prepares TLS/data/contracts and stages the client |
| `npm run frontier:stage -- --build 3502403 --source-root <path>` | Recreate only the isolated client stage | Uses the same platform adapter as setup; Linux also requires `--staging-base` |
| `npm run frontier:world -- up --build 3502403` | Create a disposable local chain | Deploys and synchronizes the selected build's world and dApp configuration |
| `npm run frontier:sync -- --build 3502403` | Retain an already running deployment | Revalidates and refreshes world, NPC and dApp configuration |
| `npm run frontier:server -- start --build 3502403` | Daily server use | Starts the native server and HTTPS dApp against the synchronized world |
| `npm run frontier:launch -- --build 3502403` | Daily client use | Verifies and launches the selected stage; Linux also requires its stage and Wine runtime parameters |
| `npm run frontier:server -- status --build 3502403` | Inspect server processes | Reports the marker-owned server and dApp processes |
| `npm run frontier:server -- stop --build 3502403` | Stop background server processes | Stops only the selected runtime's recorded processes |

All aliases enter `frontier:host`. Additional client operations use
`npm run frontier:host -- client check|patch|trust|status|stop --build 3502403`
with action-specific options; `client --help` shows the full interface. Windows
trust remains in its platform certificate workflow. `--dry-run` is available
for setup, staging and launch previews.

The existing `SetupFrontierWindows.bat`/`.ps1` wrapper bootstraps Windows
prerequisites and then delegates to shared setup. Native Windows staging,
patching, launch and process scripts remain platform adapters. Linux shell
helpers dispatch through the same host commands; `StageFrontierClient.sh` and
`PlayFrontier.sh` select those helpers on Linux and retain the original macOS
implementation on macOS. macOS retains its accepted `3467658` profile.

For a fresh source checkout, install the root compiler without running the
postinstall build, then compile the host tools:

```sh
npm ci --include=dev --ignore-scripts
npm run build:tools
```

Windows build `3502403` uses `blue.pyd`. Automated workflow checks do not
establish live gameplay acceptance; see
[FRONTIER_BUILD_3502403.md](FRONTIER_BUILD_3502403.md).

## Conventional EVE Online build 3396210

If you do not want to guess which batch file matters, use this.

### The Only Two Buttons Most People Need

* `SetupEveJS.bat`
* `StartServer.bat`

That is enough for normal setup and play.

### What Each Launcher Does

|Click this|Use it when|What it does|
|-|-|-|
|`SetupEveJS.bat`|First-time setup, or after an update|Runs every setup step in the right order and skips whatever is already done. `-Status` shows progress without changing anything|
|`tools\\\\\\\\ClientSETUP\\\\\\\\StartClientSetup.bat`|You only want to redo the client|Walks you through client setup, certificate install, patching, and local-server config|
|`StartServer.bat`|Normal daily use|Creates the local database if needed, then starts the server or starts the server and launches the client for you|
|`Play.bat`|You already started the server yourself|Launches only the client|
|`tools\DatabaseCreator\CreateDatabase.bat`|You want to create or rebuild local database files manually|Downloads the public EVE SDE and generates `_local\gameStore`|
|`BuildMarketSeed.bat`|You want the optional standalone market|Builds or refreshes the market database|
|`StartMarketServer.bat`|You use the optional standalone market|Starts the separate market daemon|
|`tools\\\\\\\\ConfigEditor\\\\\\\\OpenServerConfig.bat`|You want to edit local config or player data|Creates the local database if needed, then opens the desktop config and database editor|
|`tools\\\\\\\\NewEdenStoreEditor\\\\\\\\StartStoreEditor.bat`|You want to edit store content|Opens the desktop New Eden Store editor|

### Best Choices By Situation

#### I am brand new

Click:

```text
SetupEveJS.bat
```

Then:

```text
StartServer.bat
```

Choose `2`.

The first server start may take longer because it downloads the SDE and generates `_local\gameStore`.

#### I already set everything up before

Click:

```text
StartServer.bat
```

Choose:

* `1` if you only want the server
* `2` if you want the server and client together

#### I already have the server running and only want to launch the game

Click:

```text
Play.bat
```

#### I want the optional fast market

Click these in order:

1. `BuildMarketSeed.bat`
2. `StartMarketServer.bat`
3. `StartServer.bat`

#### I want to edit server settings or data

Click:

```text
tools\\\\\\\\ConfigEditor\\\\\\\\OpenServerConfig.bat
```

The first launch may take longer because it generates `_local\gameStore` if the local database is missing.

#### I want to edit the store

Click:

```text
tools\\\\\\\\NewEdenStoreEditor\\\\\\\\StartStoreEditor.bat
```

That tool needs Python 3 installed.

### Launchers Most Players Can Ignore

You usually do not need to touch:

* `PlayDebug.bat`
* `tools\\\\\\\\ClientCodeGrabber\\\\\\\\StartCodeGrabber.bat`

You also usually do not need to run `tools\DatabaseCreator\CreateDatabase.bat` by hand. Use it when you want to rebuild the local database with `/force`.

Those are more useful for debugging or project maintenance than normal play.

## Related Guides

* [SETUP.md](SETUP.md)
* [FRONTIER_WINDOWS_SETUP.md](FRONTIER_WINDOWS_SETUP.md)
* [MARKET\_SETUP.md](MARKET_SETUP.md)
* [TOOLS.md](TOOLS.md)
* [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
