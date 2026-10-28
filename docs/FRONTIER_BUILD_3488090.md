# Frontier build 3488090 port candidate

This is an exact-build Windows-client port for Frontier `3488090`, not a claim
of validated gameplay. The installed `stillness/start.ini` identifies
`appname=FRONTIER`, version `20.04`, build and sync `3488090`, branch
`//frontier/cycle-6`, codename `cycle-6`, and region `ccp`.

The previous `3474408` Windows smoke-run evidence remains historical. No
client/server live acceptance run was performed for `3488090` during this
port. Read-only bytecode inspection confirms MachoNet `489` in
`eve/common/script/net/eveMachoNetVersion.pyc` and birthday `170472` in
`carbon/common/script/net/GPS.pyc`. The runtime retains `V20.04@ccp`; a live
handshake still needs verification.

## Runtime and launcher selection

`StartFrontierServer.ps1`, `PlayFrontier.ps1`, `StopFrontier.ps1`, and
`npm run test:frontier-server` default to `3488090`. Setup and staging continue
to discover the installed client rather than assuming that it matches the
default. The conventional EVE Online configuration remains build `3396210`;
the Frontier launcher supplies its own scoped environment overrides.

The shell staging/server scripts remain on the last accepted macOS build
`3467658`, because their native workflow uses macOS tools. They are not Linux
or Wine client launchers. This port does not establish Wine gameplay support.

Run `npm run build` after editing TypeScript sources. Generated `.js`/`.mjs`
files are build outputs, not the source of record.

For native Windows setup, use the existing isolated workflow with an explicit
build and installed source root:

```powershell
.\SetupFrontierWindows.ps1 -Build 3488090 -SourceRoot 'C:\CCP\EVE Frontier\stillness' -DryRun
.\SetupFrontierWindows.ps1 -Build 3488090 -SourceRoot 'C:\CCP\EVE Frontier\stillness' -NonInteractive
$stage = "$env:LOCALAPPDATA\EveJS-Frontier\windows\staged-client\3488090"
.\PatchFrontierClientTrust.ps1 -StagedRoot $stage -Check
.\StartFrontierServer.ps1 -Build 3488090 -Status
```

These are workflow instructions, not a record of commands executed during
this port. See [the Windows setup guide](FRONTIER_WINDOWS_SETUP.md) for the
full staging, certificate, runtime, and rollback rules. Its old hashes and
live-run counts apply only to `3474408`.

Generated data and runtime roots must remain separate from older builds:

```text
_local/frontier-sde/3488090
_local/frontier-contracts/3488090
_local/frontier-gameStore/3488090/data
_local/frontier-runtime/3488090/gameStore
```

Do not rename or silently reuse an older snapshot as `3488090`. Existing
mutable worlds require an explicit backup/migration decision; the new default
does not migrate them or justify `-ResetRuntime`.

## Native blue.pyd profile

The exact profile is `tools/frontier-client/blue-pyd.3488090.patch.json`.
Native analysis found the same verifier code and patch result as `3474408`,
but a different signed source hash. The new source must be matched by its own
profile; broadening an old profile's accepted hashes is not equivalent.

| State | SHA-256 |
|---|---|
| Original `bin64/blue.pyd` | `a7c2789f7a00f19cfd0e3603397f26377f69937ad32ef1611c7308bc36c45c5c` |
| Exact patched `blue.pyd` | `2dcfd00d4b84534abecf7f4cb3be09209fb2bac85377066cb8e18fe32131de82` |

The content-addressed cache copy must be resolved from the installation's
`index_stillness.txt` entry for `app:/bin64/blue.pyd`, not by guessing a cache
filename or applying a wildcard patch. Any explicit in-place operation must
back up both exact files first and verify them afterward.

The native-only helper supports read-only inspection, explicit patching, and
backup-bound restoration:

```sh
python3 tools/frontier-client/patch_frontier_blue_cache.py check --client-root "/path/to/EVE Frontier/stillness" --build 3488090
python3 tools/frontier-client/patch_frontier_blue_cache.py patch --client-root "/path/to/EVE Frontier/stillness" --build 3488090
python3 tools/frontier-client/patch_frontier_blue_cache.py restore --client-root "/path/to/EVE Frontier/stillness" --build 3488090 --backup "/exact/backup/path/from-patch-report"
```

The native/cache helper uses only Python's standard library (tested with
Python 3.12). Close the client
and launcher before patching. The helper backs up both files under the
installation parent's `.evejs-backups/frontier-client-<timestamp>` directory
and writes `native-cache-patch.json` with the exact paths and original hashes.
Keep that backup; restoration must use the directory reported by the patch,
not an inferred path. These commands do not start the client or server.

A native-only patch of `blue.pyd` and its indexed resource-cache counterpart
is distinct from full staged-client setup. It does not by itself install the
Placebo boot settings, local CA bundles, manifest updates, or docking/feature
bytecode changes. The normal stage patcher continues to require its complete
transaction and independent `-Check`; restore the original pair before
creating a fresh stage from an in-place-patched source. The official
launcher may repair or replace modified cache content on its next update.

## Offline validation (2026-09-04)

The installed native module and its exact indexed `ResFiles` counterpart were
patched and independently verified against the target SHA-256 above. Both
originals were retained in a timestamped backup. `exefile.exe`, `code.ccp`,
`manifest.dat`, `start.ini`, both CA bundles, and the launcher index retained
their pre-patch hashes. The three-byte verifier change, cleared certificate
directory, and recalculated PE checksum were also checked with `objdump`.

The build-specific static snapshot was extracted and validated: 1,148,579
records across 35 JSONL files, including 24,026 systems, 113,253 landscape
sites, 32,626 raw types, and 7,072 stargates. The generated database under
`_local/frontier-gameStore/3488090` was validated separately. Exact Rift,
Tallyport, and Relay authority was checked before enabling the new build's
database validation gate. See [the comparison record](../tools/frontier-contracts/frontier-build.3488090.comparison.json)
and [Linux extraction instructions](../tools/frontier-static/README.md#linux-with-wine).

Verification used Node `24.19.0` and Python `3.12.3`:

- TypeScript build/typecheck and whitespace/shell syntax checks passed.
- `npm test`: 44 passed, with three Windows-only tests skipped on Linux.
- Python client tests: 30 passed, including actual 3488090 bytecode patched
  only inside a temporary archive, pair backup/restore, and failure rollback.
- Full Frontier server regressions: 220 passed, zero failures or skips,
  against an attested disposable copy of the new generated database. No
  persistent runtime or live game session was started.

To repeat the server regressions without initializing a permanent runtime,
run the following from the repository root after building and generating the
3488090 data:

```sh
EVEJS_CLIENT_BUILD=3488090 EVEJS_CLIENT_VERSION=20.04 \
EVEJS_MACHO_VERSION=489 EVEJS_EVE_BIRTHDAY=170472 \
EVEJS_PROJECT_CODENAME=cycle-6 EVEJS_PROJECT_REGION=ccp \
EVEJS_PROJECT_VERSION=V20.04@ccp EVEJS_CLIENT_COMPATIBILITY_PROFILE=frontier \
EVEJS_TEST_STORE_BASELINE_ROOT=_local/frontier-gameStore/3488090 \
EVEJS_TEST_FRONTIER_FIXTURES=1 EVEJS_STATIC_JSONL_ROOT="$PWD/_local/frontier-sde/3488090" \
node scripts/Tests/run-isolated-tests.js --test-concurrency=1 server/tests/frontier*.test.js
```

## Actual gateway contract checks

The four implemented gateway protobuf roots were compared against the actual
`3488090` contract index and full descriptor export: core 18 messages/24 fields,
assembly gate 17/28, network node 24/38, and storage unit 24/42. Field numbers,
names, scalar/wire types, repeated/map semantics, and fully-qualified message
types matched. No implemented messages were absent from the client export and
no optional client-only fields appeared on these messages. Shared identifiers
are counted once per root. This checks message definitions, not service behavior.

The standalone actual-export regression uses no gameStore and starts no server:

```sh
EVEJS_CLIENT_BUILD=3488090 EVEJS_FRONTIER_CONTRACT_INDEX=_local/frontier-contracts/3488090/frontier-contract-index.json node --test server/tests/frontierActualGatewayContracts.test.js
```

Keep `frontier-public-protos.json` beside the index; it preserves map metadata
omitted by the compact index. An explicitly selected missing export or a build
mismatch fails. Without the explicit path, the tests use the selected build's
local export and skip if it is absent. The actual `3488090` run passed all four
tests; a deliberate `3474408`/`3488090` mismatch was also confirmed to fail.

## Remaining acceptance

Run focused tests after building:

```sh
npm run test:frontier-runners
npm run test:frontier-static
# Requires newly generated 3488090 data and an initialized isolated runtime:
npm run test:frontier-server -- --build 3488090
```

Offline checks cannot establish a successful game session. A separate live
pass must cover the exact handshake, login/character selection, rendered space,
flight/warp, docking, Creation fitting and reload/unload, XMPP/TLS gateway,
Smart Storage, Heavy Gate, and HUD/map interactions. Do not infer server RPC
equivalence from an unchanged native binary alone.
