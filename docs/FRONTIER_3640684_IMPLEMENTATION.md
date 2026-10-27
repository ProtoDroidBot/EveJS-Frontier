# Build 3640684 server implementation

The implementation hold was released for the **entire F01–F21 backlog** on
2026-10-26. The selected geography remains `3502403-MOD4-STUFF1`. This document
records the server work and its remaining compatibility boundaries; it is not
a claim of native-client gameplay acceptance or official cycle-7 balance.

## Implemented domains

| Audit item | Server behavior |
| --- | --- |
| F01 | Exact-build public Request/Response/Notice/Event descriptors and their dependencies; `sint32` user notice targets, `uint64` shared identifiers, trace context, strict notice targets, authenticated local request/event/notice routing. Other build schemas remain selected independently. |
| F02–F03 | Persistent composite cells, extraction into scoopable regolith, timed pickup, atomic inventory credit, cancellation/recovery, collision replacement, configurable expiry/respawn/caps and substrate/grade mappings. See [voxel mining](VOXEL_MINING_3640684.md). |
| F04 | Pitch rate, roll rate, brake fraction and normalized heading commands, admitted native Destiny actions, server motion integration, independent axes, persisted controls and roll orientation. |
| F05 | Magnetic docking capabilities and service payloads, reservations, approach/settling, durable dock recovery, cargo authorization, stock-backed refueling, timed undocking and movement locks. |
| F06 | Authored Digital Chemistry catalog, previews, durable input escrow, timed jobs, variant outputs, cancellation/refunds and atomic completion. |
| F07–F09 | Nine target complexity skills and dogma effects; memories, vault, ascension, crowns and shell workflows; medical kits/remedies and persisted environmental trait treatment. |
| F10–F11 | Relay lens quote/prepare/execute and feral-data sales; separate LUX and EVE ledgers, exact amounts, signed intents, expiry and duplicate-safe atomic inventory/balance changes. |
| F12 | Native gate rebuild/fuel RPC shapes, target material costs and fuel-energy economy, atomic deposits, jump fuel reservation/refund, and correct ruined/unfueled/traversable state projection. |
| F13–F14 | Structure transponders for cairns, nodes, slingshots and authored smart gates; owner-authorized publication/revocation and discovery with lifecycle invalidation. |
| F15 | Persistent Lagrange occupancy, conflicts, local ownership/proximity checks, queries, native claim/unclaim payloads, and revocation after assembly destruction or ownership changes. |
| F16 | Configured and durably granted/revoked construction-pack entitlements, returned by `deploymentMgr.get_claimed_packs`, with server-side building requirements. |
| F17 | Wallet-bound kill reporting sourced from authoritative killmail records, participant authorization, provenance hashes and durable idempotent receipts. Local reports are explicitly local; an external backend requires confirmed receipts. |
| F18 | Configured founder entitlements and activity-driven objectives; exact achievement and broadcast upload notices with a trusted backend completion hook. |
| F19 | Native wallet-reported event processing with real validation and error status; local Sui signature verification; explicit provider boundary for official authentication. |
| F20 | Shared selected-world geography and exploration/scanner integration; detailed behavior and limits are recorded in [Exploration API](EXPLORATION_API.md). |
| F21 | Exact 3640684 Windows PE/code-archive patch profiles, cycle-7 handshake selection, and verification on disposable copies. Installed client files were not patched. |

The implementation uses the existing service loader in `server/index.ts`, which
recursively registers `*Service.js` classes. New services include `skillsMgr`,
`cycleService`, `dockingPoint`, `digitalChemistry`, `feralnetwork`,
`lagrangeOccupancyMgr`, and `smartKillMailService`.

## Configuration and authority

Select build `3640684`, version `20.04`, MachoNet `489`, and codename `cycle-7`
together. Set `EVEJS_EXPLORATION_WORLD_PATH` to the integrity-checked export of
the selected legacy world. Existing default launch profiles are preserved;
the supplied client is not silently promoted to the default.

The gateway's current local identity bridge requires one authenticated game
account on the matching loopback socket peer. It checks the claimed character
against the live TCP session registry and rechecks notice consumers on every
delivery. Remote peers, ambiguous loopback accounts, disconnected accounts and
forged characters fail closed. An envelope's authority fields are not accepted
as credentials. This is a local emulator boundary, not remote bearer login.

Local policies are explicit configuration, rather than inferred retail values:

- `frontierEconomyPolicy` defines token/LUX rates, relay prices and prepared
  operation expiry. The default is a local ledger. See [economy and
  chemistry](FRONTIER_3640684_ECONOMY.md) for exact defaults and signing behavior.
- `frontierProgressionPolicy` defines activity weights, shell creation costs,
  founder character IDs, objective definitions and nest interaction range.
  Default extraction/piloting inputs award one XP per ore unit/metre before
  the client's conversion factor. These rates and the 5 km nest interaction
  distance are local policy. Founder IDs, shell creation recipes and objectives
  require explicit configuration. Client requests cannot grant entitlements.
- `frontierClaimsPolicy.packEntitlements` maps character IDs to target pack IDs
  1–11. `buildingPackRequirements` maps assembly type IDs to required pack IDs.
  Durable revocations override configuration. `killReportingProfile: "local"`
  records local reports and never claims an external transaction was submitted.
- `voxelMiningPolicy` controls fragment expiry, asteroid respawn, active
  fragment limits and explicit substrate mappings. Default expiry and respawn
  are zero, preserving existing material. Limits refuse further extraction
  before consuming ore; they do not silently discard loose material.

Inventory mutations and domain receipts use ownership-scoped row proposals in
one SQLite transaction. The new runtime tables are explicitly registered in
both the store backend and ownership registry. Domain tests inject write
failures, retry operations and reopen persistent state.

Imported active celestial gates receive an initial deterministic reserve of
`12 + gateID % 14` jumps on their first target-profile interaction. The 12–25
bounds come from target constants; this initialization is local emulator policy.
Configured dormant gates start empty. Subsequent fuel deposits consume owned,
reachable cargo. A jump costs 22,176 energy, with a capacity of 22,176,000;
failed starts or failed handoffs that leave the ship in its source system refund
the reservation. Rebuild requires type 84180 × 86, 84210 × 1,204 and 84182 × 920.

Published structure locations are visible within the requesting pilot's current
system. Publication is revoked when ownership, system, type, position or deployed
state changes; private transponder codes are excluded from public responses.

## Exact-build staging

`tools/frontier-client/blue-pyd.3640684.patch.json` pins both source and patched
native hashes. The matching code profiles change only:

- `frontier/beta.pyc`
- `frontier/shell/common/const.pyc`
- `menucheckers/celestialCheckers.pyc`

The disposable-copy check preserved the other 11,676 archive members, verified
repeat application, rejected altered native content and confirmed the installed
source remained unchanged. Run it with Python 3.12:

```sh
python3.12 tools/frontier-client/verify_3640684_stage.py \
  --client-root '/path/to/EVE Frontier' \
  --report /tmp/frontier-3640684-stage.json
```

The source `code.ccp` SHA-256 is
`2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c`.
The native source `blue.pyd` SHA-256 is
`32a5a3bc837cd477a4e92369a62fc2064f299446cf37a77889bc20cd0230f729`.
Older custom adapters are not injected into 3640684 without matching evidence.

## Validation and remaining boundaries

Build server, test and tool TypeScript before running the focused suite:

```sh
npm run build:server
npm run build:tests
npm run build:tools
npm run test:frontier-3640684
```

Each suite uses a separate disposable store and process. Set
`FRONTIER_COMPOSITE_CLIENT_ARCHIVE` and `FRONTIER_PYTHON312` to enable the actual
client bytecode geometry oracle. A skipped oracle is not verification.

Recorded on 2026-10-26: all three TypeScript builds passed. The combined runner
passed **150 tests across 23 isolated suites, with zero failures or skips**,
including the original client geometry oracle, real SQLite rollback/restart
checks, wallet signatures, event-stream rejection/ACK behavior and gate fuel
transactions. The existing asynchronous gateway regression also passed 2/2.
Claim response constructors were separately checked against the actual target
Python dataclasses; the native marshal decoder was not launched.

A disposable-store check of the complete selected artifact also matched all
24,026 systems, 670,973 celestial rows and 7,072 reciprocal gates against the
canonical adapters and sampled scene inputs. The check took 8.07 seconds with
approximately 1.18 GiB peak RSS; supplemental stations/belts/sites were absent
from that test baseline, so it does not validate their cross-cycle mapping.

The following work still requires evidence or deployment configuration:

- Native Windows/Bottles launch, login, rendering, UI workflows, wallet signer
  interaction and multiplayer gameplay acceptance have not been performed.
  The collision-replacement path has server coverage; live flight through a
  newly carved hole still needs native acceptance.
- The installed archive/index do not contain the referenced
  `resource_substrate/{regolith_properties,mining_hardness,regolith_runtime,
  regolith_appearance}.json` resources. Retail density, grade mappings and
  toughness cannot be recovered from absent files. The server validates
  explicit mappings and miner tiers; its default retains legacy stock/yields.
- Official JWT/Enoki authentication and external chain execution require real
  configured providers. Missing providers return explicit errors. Local ledger
  receipts do not claim blockchain confirmation.
- Digital Chemistry currently uses whole inventory units. Fractional stock
  and general dynamic mass/volume migration are not implemented. Unknown costs,
  pack entitlements and shell recipes are not granted implicitly.
- Upload completion notices are wired to trusted backend results. No uploader
  service was present in the audited client contracts, so this does not invent
  an upload endpoint or report successful uploads that never occurred.
- The exported legacy geography and mutable mining state remain distinct.
  Schema-14 universe data has no arbitrary quantity/mined-bitset field; those
  belong to scanner/resource data and the composite RPCs.
- The target client **does contain** landscape, ecosystem and dungeon binaries
  in its resource cache. These are now decoded and integrated through the
  [temporary content profile](FRONTIER_3640684_TEMPORARY_LANDSCAPE.md), preserving
  authored positions on the selected galaxy. Unresolved planet references are
  omitted from the map until full era 6 cycle 7 data replaces this setup.
  [Allocation and trigger policies](FRONTIER_3640684_LANDSCAPE_POLICIES.md) add
  finite voxel resources and persistent NPC encounters, with explicit temporary
  defaults for the missing global resource budget and NPC rosters.

These boundaries remain visible in the port plan. Server tests and staged
binary checks are not a substitute for native acceptance or missing source data.
