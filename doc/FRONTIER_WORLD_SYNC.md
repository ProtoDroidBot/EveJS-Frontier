# Frontier World Sync

`FrontierWorld.ps1` connects EveJS to the disposable Sui localnet managed by
`efctl.exe`. The EveJS repository root is the default efctl workspace, with
`world-contracts` and `builder-scaffold` supplied by pinned Git submodules. It
publishes the current deployment identity into EveJS only after the local chain
and generated artifacts agree.

The deployment is split into the base world plus NPC, assembly-access,
catapult, Smart Industry, and transponder feature packages. The public feature
manifest keeps each package's current call target, stable type origin, and
shared registry separate from the base-world identity.

`efctl env up` regenerates this disposable local chain and redeploys the world,
so package and shared-object IDs can change on every up/restart. Using this
wrapper ensures EveJS receives the newly deployed values.

For the current checkout, the defaults resolve to:

```text
efctl workspace: D:\carbonengine-stuff_EF\EveJS-Frontier
world contracts: D:\carbonengine-stuff_EF\EveJS-Frontier\world-contracts
builder scaffold: D:\carbonengine-stuff_EF\EveJS-Frontier\builder-scaffold
assembly dApp:    D:\carbonengine-stuff_EF\EveJS-Frontier\smart-assembly-control
EveJS config:    D:\carbonengine-stuff_EF\EveJS-Frontier\_local\frontier-world\3502403\world.private.json
Feature config:  D:\carbonengine-stuff_EF\EveJS-Frontier\_local\frontier-world\3502403\npc-deployment.json
```

The `_local` output is ignored by Git. Its ACL is restricted to the current
Windows user because it contains the admin signer used by local character
provisioning. The tool copies no player, governor, or sponsor keys and does not
copy either submodule, dependency stores, build output, or logs. Generated
deployment artifacts remain ignored inside `world-contracts`.

This workflow is independent of the EveJS databases. It neither initializes a
database nor starts the EveJS server, so the world can be prepared and synced
while the rest of the server setup is still incomplete.

Every successful `sync`, `up`, or `restart` also regenerates the dApp's
public-only `.env.local` and `.deployment-source.json` from the same validated
`world-contracts` deployment. It never copies the admin signer into the dApp.
The native Windows server launcher builds and starts that configured dApp
automatically.

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
- when `deployments\localnet\npc-deployment.json` exists, its version-1 schema
  contains canonical nonzero package/origin/registry addresses for all five
  features and its chain/base-world IDs match the synchronized world.

It copies only the approved public feature fields to the sibling
`npc-deployment.json`; no private key is written to that file. Only then does it
atomically publish a `ready` private config. The native
Frontier launcher passes this stable config path to EveJS, which reads it when
provisioning a character. Explicit `EVEJS_SUI_*` overrides still take
precedence.

The historical feature-manifest filename now covers all five split packages.
It is not an NPC-only file. Current schema version 1 is atomic: partial feature
manifests are rejected. If an authoritative source manifest disappears while a
synchronized destination exists, sync preserves the destination for recovery
but fails closed instead of silently reverting feature calls to the base world.

After publishing the configuration, sync tops every configured NPC faction
wallet up to the common `suiWalletFunding.budgetMist` minimum from the
synchronized admin account. When enabled and necessary, the Localnet faucet
funds the admin, never the faction wallets directly. A dry run reports the
deficit without transferring; `-SkipNpcFactionFunding` is for isolated tests or
explicit recovery only.

After wallet funding succeeds, sync runs the checked-in dApp configuration
generator against the exact `world-contracts` directory used above. A missing
dApp submodule or rejected public deployment manifest fails the sync and marks
the private world state as `error`; run `git submodule update --init --recursive`
or repair the deployment and retry. `-SkipDappSync` is reserved for isolated
tests or explicit recovery workflows.

## Package-split validation boundary

Sync validates feature addresses and base-world bindings, but it does not yet
query each live feature package for its expected module or include the public
feature manifest and per-feature publish outputs in `world.private.json`'s
artifact hashes. Before activating manually upgraded metadata, verify the live
module set, exact shared-registry type, retained type origin, UpgradeCap
owner/policy, and a feature-specific transaction dry run.

The `world-contracts/scripts/deploy-world.sh` submodule script cleans deployment outputs
and performs a fresh publish of all six packages. It is not a per-feature
upgrade command. Preserve the base package, Object Registry, Admin ACL, feature
type origins, and registries when upgrading a call implementation. The full
topology and current upgrade limitations are documented in
`world-contracts/docs/package-topology.md`.

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
