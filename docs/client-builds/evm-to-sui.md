# Catalogued EVM clients with a Sui backend

All **14 catalogued EVM builds** now have an exact-build adapter for wallet
bootstrap and assembly online/offline actions:

```text
2455427 2615573 2702949 2703993 2726651 2730628 2742057
2763641 2814770 2884873 2898485 2973163 2997426 3122254
```

The five catalogued Sui builds retain their Sui path. Unknown builds are
rejected. The [requirements audit](blockchain-requirements.md) and its source
hashes establish the branch differences; implementation is separate from live
acceptance. Testing is deferred at the user's request.

## Implemented paths

The ERC2771 adapters implement:

- Native wallet configuration and character-bound keystore passphrases.
- `SmartCharacterExistsRequest` backed by a verified Sui Character/PlayerProfile.
- Signed `create_smart_character`, including the older combined request and
  newer separate typed-data/signature arguments.
- Sui Character/PlayerProfile creation and reconciliation through the existing
  provisioning service, with durable pending transaction recovery.
- Legacy `TokenBalanceRequest` using a configured balance authority, with a
  matching balance notice when a read observes a changed amount.
- Build 2615573's encrypted mnemonic recovery RPCs.
- Build 3122254's `GetPrivateKeyRequest`/`StorePrivateKeyRequest`, scoped to the
  active character and encrypted at rest. These carry legacy EVM recovery data.
- Online/offline authorization translated into the existing Sui assembly worker.

The proxy adapter for 2455427 implements its account creation, unlock,
recovery, password change, EVM key export, balance, configuration, health,
character association, and SSU online/offline calls. Its mnemonic custody is
encrypted with a server secret and password-derived key. Unlocks are scoped
to the authenticated game session and expire; password changes invalidate
previous unlocks. It never exposes a Sui private key.

This does not migrate Solidity contracts or historic EVM balances. Storage,
fuel, anchoring, gate actions, token purchases/exchange and arbitrary Ethereum
dapp/RPC execution still need their own gameplay adapters. Unsupported actions
return explicit errors. A lifecycle acceptance acknowledges an intent queued
for the Sui worker; it is not a confirmed chain transaction receipt.

## Initial setup and world sync

Select the same build for client setup, world setup and the server:

```powershell
.\SetupFrontierWindows.ps1 -Build 2703993 -SkipStage
.\FrontierWorld.ps1 up -Build 2703993
.\StartFrontierServer.ps1 -Build 2703993
```

Use `FrontierWorld.ps1 sync -Build 2703993` for an already running world.
Initial setup prepares `_local/frontier-world/<build>/legacy-evm-sui.private.json`;
world `up`, `restart` and `sync` refresh it and reference it from
`world.private.json`. The launchers and server discover this manifest for the
selected build. The five catalogued Sui builds keep their existing setup path.
Client staging and trust patches still require their own exact-build profiles;
the example uses `-SkipStage` to prepare the server data and backend.

The generated manifest selects the audited adapter, virtual EVM signing domain,
local API endpoint and the existing Sui balance authority. A new authenticated
character gets a random, stable keystore passphrase stored encrypted in the
wallet database. Its first valid creation signature enrolls its EVM address.
Wallet reports and recovery uploads cannot change that binding. Existing
configured account pins and passphrases take precedence.

New assemblies are resolved from the character's owned runtime assemblies using
the selected build's object-ID formula. Existing ownership and lifecycle checks
still apply. No separate accounts file or manual assembly-ID list is required.

Repeated syncs preserve the recovery key, account settings, object mappings and
other authored bridge settings. Keep the private manifest with its wallet
database: losing the recovery key makes encrypted wallet data unreadable.
Malformed or wrong-build files stop synchronization rather than replacing them.
Restart the server after changing synchronized configuration.

World synchronization keeps the deployed Sui energy catalog and its source-build
provenance when bridging an older client. It does not deploy historical EVM
contracts or relabel their balances as Sui assets. Older clients may use a
subset of the deployed energy catalog; missing requirements for a client assembly
type still block synchronization rather than assigning it a zero energy cost.

## Optional manual manifest

Use compatible static/runtime data and a synchronized Sui world for the exact
selected build. The current backend uses Localnet gRPC at localhost:9000.
Ensure that address is reachable from the server's network namespace when
using efctl/Docker. Keep the deployment artifacts and assembly worker available.

Create an account file whose keys are trusted server account IDs:

```json
{
  "7": {
    "walletPassphrase": "a-stable-passphrase-for-this-legacy-keystore"
  }
}
```

An optional `evmAddress` pins an existing wallet. Otherwise the first valid,
character-bound creation signature enrolls the address durably. Wallet-report
events and recovery uploads cannot establish or change the binding. Reuse the
correct passphrase for an existing native keystore.

For 2455427 an empty account object is sufficient: the user chooses the proxy
wallet password in the legacy client. Its password is not the manifest's
keystore passphrase.

Generate a private manifest:

```sh
npm run frontier:convert-evm -- \
  --build 2703993 \
  --accounts /absolute/path/accounts.json \
  --item 1001 --item 1002 \
  --api-url http://127.0.0.1:26102 \
  --out /absolute/path/evm-sui-2703993.json
```

For a manually restricted manifest, `--item` is optional for bootstrap-only setup. Add each assembly game item ID
you want the relay to accept; the command computes its exact build-specific
object ID. IDs do not use one formula across all builds.

The generator supplies ordered or named contract entries, JSON-string or
structured configuration, direct or discovered system IDs, the correct ABI
argument names and character-creation tuples, and a virtual EVM signing domain.
Build 2615573 defaults to EVM tenant `devnet`; other builds default to `dev`.
`--tenant` selects another EVM tenant, which is also supplied in login global
configuration. The current Sui worker uses tenant `dev` and tribe `100`, independently of the
EVM tenant.

Each new manifest contains a random 32-byte `recoveryKey`, and is created with
mode `0600` on Unix. Preserve that secret with the encrypted wallet database:
changing or losing it makes stored recovery/custody data unreadable. The command
refuses to overwrite a file. When upgrading a previously used manifest, preserve
its recovery key and account settings instead of generating a replacement key.

## Balance authority and units

The default `tokenBalanceSource` is `local-ledger`: balances come from the
server's existing token ledger, using the confirmed Sui wallet binding. This
does not report the Sui gas balance as EVE or invent a fallback balance.

For an actual deployed Sui coin, select its exact type and decimal precision:

```sh
npm run frontier:convert-evm -- \
  --build 3122254 --accounts /absolute/path/accounts.json \
  --api-url http://127.0.0.1:26102 \
  --token-balance-source sui-coin \
  --token-coin-type 0xPACKAGE::token::TOKEN --token-decimals 9 \
  --out /absolute/path/evm-sui-3122254.json
```

Replace the coin type with a deployed type. Legacy ERC2771 wallets and ERC20
reads receive exact 18-decimal wire amounts; the 2455427 account-balance route
receives decimal display units. Amounts with precision that cannot be represented
exactly are rejected rather than rounded.

## Manifest overrides

Automatic setup does not require these overrides. They remain available for
custom server launch commands or a manually restricted manifest:

```sh
export EVEJS_CLIENT_BUILD_PROFILE=frontier-2703993
export EVEJS_CLIENT_BUILD=2703993
export EVEJS_LEGACY_EVM_SUI_BRIDGE_PATH=/absolute/path/evm-sui-2703993.json
```

The JSON alternative is `legacyEvmSuiBridgePath`. An empty path uses automatic
discovery from the synchronized world or the selected build's default directory.
Restart after changing profiles or manifests. The Sui worker uses
the resolved build when validating its world snapshot; setting the build
environment value remains useful for external launch/synchronization tools.
One process serves one build profile.

The conversion command writes configuration only. It does not start a server,
modify an installation or submit a chain transaction. The initial Sui deployment
and gas/admin authority must already be ready. Wallet creation confirms the
actual Sui Character/PlayerProfile before returning success to the legacy client.

For Docker, mount the private manifest and required world artifacts at paths
visible inside the server container. The gateway uses the existing authenticated
single-account loopback identity boundary; ordinary port forwarding does not
replace that boundary. The stock Compose file does not deploy the Sui node.

## Additional staging for 2455427

This client ignores a returned proxy URL and uses a packaged external host at
port 32811. The supplied adapter listener serves `127.0.0.1:32811/jsonrpc` when
that exact profile and manifest are enabled. An additional shared HTTP route is
available at `/legacy-evm/proxy`.

Use the guarded staging tool on a dedicated client copy:

```sh
python3 tools/frontier-client/patch_frontier_blockchain_proxy.py \
  --build 2455427 \
  --archive /path/to/source/awakening/code.ccp \
  --output /path/to/staged/awakening/code.ccp
```

It replaces only the audited proxy-host constant with `127.0.0.1`, retains
port 32811, rejects unknown member hashes, and preserves a backup before replacing
an existing output. `--in-place` is available only by explicit selection. The
tool has been implemented but has not been run on the user's installations.

## Authorization and recovery

ERC2771 signatures must match the exact forwarding domain, sender, delegated
world/system, active character, metadata and deadline. The verifier understands
the native hexadecimal chain-ID representation and preserves 256-bit integers.
Only the registered character-creation and lifecycle ABIs are accepted.

Pending provisioning bytes/signatures and confirmed receipts are durable.
Character-existence queries verify the live Sui identity and deployment.
Lifecycle nonces remain protected against conflicting calls and retries; the
deployment runtime rechecks ownership, location, construction, activation,
fuel and energy. Interrupted lifecycle entries require reconciliation instead
of repeating a possibly applied action.

Recovery blobs and proxy mnemonics use authenticated encryption tied to the
build, account and character. Stored historical recovery ciphertext from a
different server is not automatically decryptable without its original key.
Existing local EVM keystores still need their original passphrase.

## Deferred validation

Source and tool compilation is checked. No test suites, clients, native helpers,
staging patches or chain transactions were executed for this implementation.
The earlier bridge fixtures predate the expanded bootstrap/adapters and should
be reviewed during the deferred testing step before running the full workflow.
