# Frontier World Sync

`FrontierWorld.ps1` connects EveJS to the disposable Sui localnet managed by
`efctl.exe`. It operates on the build-numbered efctl workspace beside this
repository and publishes the current deployment identity into EveJS only after
the local chain and generated artifacts agree.

`efctl env up` regenerates this disposable local chain and redeploys the world,
so package and shared-object IDs can change on every up/restart. Using this
wrapper ensures EveJS receives the newly deployed values.

For the current checkout, the defaults resolve to:

```text
efctl workspace: D:\carbonengine-stuff_EF\3502403
EveJS config:    D:\carbonengine-stuff_EF\EveJS-Frontier\_local\frontier-world\3502403\world.private.json
```

The `_local` output is ignored by Git. Its ACL is restricted to the current
Windows user because it contains the admin signer used by local character
provisioning. The tool copies no player, governor, or sponsor keys and does not
copy the world-contracts Git checkout, dependency stores, build output, or
logs.

This workflow is independent of the EveJS databases. It neither initializes a
database nor starts the EveJS server, so the world can be prepared and synced
while the rest of the server setup is still incomplete.

## Commands

Run from PowerShell 7:

```powershell
# Synchronize an already-running efctl localnet into EveJS.
.\FrontierWorld.ps1 sync

# Start/deploy with efctl, validate the live chain, then synchronize EveJS.
.\FrontierWorld.ps1 up

# Mark the EveJS config inactive, then stop the efctl Docker environment.
.\FrontierWorld.ps1 down

# Perform down -> up -> validation -> sync in one command.
.\FrontierWorld.ps1 restart

# Show efctl environment status and the local EveJS sync state.
.\FrontierWorld.ps1 status
```

`FrontierWorld.bat` exposes the same commands from `cmd.exe`. A no-write check
is available for every command:

```powershell
.\FrontierWorld.ps1 restart -DryRun
```

Only supported, action-specific flags after the tool options are forwarded to
the guarded efctl command. For example:

```powershell
.\FrontierWorld.ps1 up --with-frontend --with-graphql
```

`up` and `restart` accept `--with-frontend[=true|false]`,
`--with-graphql[=true|false]`, and `--debug`; restart forwards these flags
to its up step and also forwards `--debug` to down. `down` accepts only
`--debug`. `status` accepts
`--debug` and `--rpc-url`. Help, positional, workspace, config-file, and
unknown arguments are rejected so efctl cannot exit successfully without
performing the requested lifecycle action. The tool itself always supplies
absolute `--config-file` and `--workspace` values.

## efctl executable ownership

By default the executable is resolved fresh from `PATH` for each tool run:

```powershell
Get-Command efctl.exe
```

The tool reports the resolved file and version but never downloads, copies,
pins, or updates efctl. Continue updating your PATH-installed `efctl.exe`
manually. `-EfctlPath` exists for an intentional one-off override.

## What is synchronized

After `efctl env up` succeeds, the tool validates all of the following:

- `deployments\localnet\extracted-object-ids.json` is a localnet deployment;
- the world package, ObjectRegistry, and AdminACL IDs are canonical Sui IDs;
- `contracts\world\Pub.localnet.toml` names the same package;
- its chain ID matches `sui_getChainIdentifier` at `127.0.0.1:9000`;
- `.env` contains exactly one checksum-valid, Ed25519
  `suiprivkey` `ADMIN_PRIVATE_KEY`.

Only then does it atomically publish a `ready` private config. The native
Frontier launcher passes this stable config path to EveJS, which reads it when
provisioning a character. Explicit `EVEJS_SUI_*` overrides still take
precedence.

`down` changes the synchronized state before tearing down the chain. A
character-provisioning attempt while the state is `syncing`, `starting`,
`stopping`, `down`, or `error` fails closed instead of using stale
deployment IDs. A named host-global lock serializes concurrent tool commands,
and IDs plus artifact hashes are published from the same stable file snapshot.

## Alternate workspace or build

```powershell
.\FrontierWorld.ps1 sync `
  -Build 3502403 `
  -SourceRoot 'D:\another\efctl-workspace'
```

The fixed efctl container names allow only one local environment at a time.
Before publishing a sync or running `up` or `down`, the tool inspects an
existing `sui-playground` container
and refuses to touch it when `/workspace/world-contracts` belongs to another
workspace. It also refuses to operate when Docker cannot be queried or when
only partial fixed-name efctl containers remain and ownership cannot be proven.

This lifecycle is separate from EveJS's own `compose.yaml`. efctl creates and
manages the Sui containers directly; use `FrontierWorld.ps1 down`, not
`docker compose down`, for that environment.
