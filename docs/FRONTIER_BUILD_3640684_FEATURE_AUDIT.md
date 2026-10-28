# Build 3640684 feature compatibility audit

Recorded: 2026-10-26. Server reference: `bef5e36` plus the current working-tree
exploration implementation. **This is the baseline audit before the full
F01–F21 implementation pass.** It identifies the missing contracts and partial
implementations at that point; it does not establish live gameplay acceptance.
The resulting work is included in the [port plan](FRONTIER_BUILD_3640684_PORT_PLAN.md).

Subsequent implementation update (2026-10-26): the user released the hold for
the entire backlog. The [implementation record](FRONTIER_3640684_IMPLEMENTATION.md)
and [current port status](FRONTIER_BUILD_3640684_PORT_PLAN.md#verified-feature-backlog--2026-10-26)
supersede the baseline status labels below. They document server support across
F01–F21, tests, explicit local economic/progression policies and remaining
external-provider/data/native-acceptance boundaries. This audit retains the
original contract evidence and rationale for the work.

## Evidence and coverage

The supplied `stillness/start.ini` identifies build `3640684`, version `20.04`,
branch `//frontier/cycle-7`. The inspected `code.ccp` is 119,398,148 bytes with
SHA-256:

```text
2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c
```

- Inventoried all 11,684 Python bytecode members, including 1,628 under
  `frontier/`. Relative to the selected modified 3502403 archive, 335 Frontier
  member names are new and 44 removed. These are module counts, not features
  or a compatibility percentage.
- Extracted all 182 public protobuf descriptor files with zero extraction
  failures; the export contains 106 messages whose names end in `Request`.
  The gateway registry declares handlers for 47 of those names. The other 59
  include envelopes, dormant/hidden APIs and admin operations, so this ratio
  must not be presented as gameplay coverage.
- Inspected player-facing service calls, relevant bound ship/ballpark calls,
  response consumers and notice subscriptions using Python 3.12
  `marshal`/disassembly. Also inspected feature flags and distinguished normal
  workflows from QA/prototype and conditional integrations.
- Compared TypeScript implementations, service registration, dispatch,
  explicit refusals, state handling and notice producers. Missing services
  were checked against recursive `*Service.js` registration in
  [server/index.ts](../server/index.ts#L156) and source identifiers, not just
  guessed filenames. Unhandled methods on existing services return `null`
  in [baseService.ts](../server/src/services/baseService.ts#L163); that fallback
  is not feature support.
- Ran pure descriptor/wire checks. No client/server process was launched,
  native extension imported, world reset, chain transaction submitted, or
  gameplay implementation changed during this audit.

Client `member:line` references below use embedded bytecode source line
numbers; they are not recovered source-file line numbers. Selected symbols,
flags, schema comparisons and input fingerprints are saved in
[feature evidence](FRONTIER_BUILD_3640684_FEATURE_EVIDENCE.json). Full inventories,
descriptors and audit scripts are local outputs under
`_local/feature-audit-3640684/`.

Static absence or an explicit refusal can be verified this way. Runtime
enablement, exact gameplay outcomes, native rendering, catalog compatibility
and complete wire/session behavior still require isolated live acceptance.
Dynamic calls and native-only behavior are not exhaustively proven by a
Python module inventory.

## Existing support and verified compatible contracts

The existing `frontierActualGatewayContracts.test.js` was run with
`EVEJS_CLIENT_BUILD=3640684` and `EVEJS_FRONTIER_CONTRACT_INDEX` explicitly
pointing to this target export. All four cases passed, without skips:

| Reflected contract family | Messages / fields compared | Result |
| --- | ---: | --- |
| Frontier core (chat membership, wallet/balance, exchange rate) | 18 / 24 | Exact checked schema match |
| Smart assembly gate | 17 / 28 | Exact checked schema match |
| Network-node fuel | 24 / 38 | Exact checked schema match |
| Storage-unit transactions | 24 / 42 | Exact checked schema match |

Additional reflection comparison found exploration's 11 messages / 28 fields
and industry's seven notice/dependency messages / 13 fields match. Industry
already publishes production/input/output notices through
[`industryNotifications.ts`](../server/src/services/frontier/industryNotifications.ts).
These checks validate the compared schemas, not economic semantics or all
shared gateway envelopes; F01 below is a counterexample outside the four
existing test families.

Server implementations exist for Creation management/abilities, skillshot
and held-beam firing, directional scanning, jump drives, deployment and
cancellation, blueprint production and inventory transfers, Creation-hosted
industry, SmartHangar berthing, clone/spawn/death handling, basic shell
implant/raiment equipment, cairn visibility, assembly online/offline and gate
link/jump operations. Existing environment/status progression also has a
runtime. Preserve these as the baseline and verify their 3640684 response
shapes/catalogs; do not replace them with a blanket “not implemented” label.

## Required protocol and player-workflow work

| ID | Feature / current status | Verified client expectation and server mismatch | Required work |
| --- | --- | --- | --- |
| F01 | Shared gateway notice/identity schema — **incompatible** | Target `Notice.TargetGroup.user` field 3 is `sint32`; [publicGatewayLocal.ts:168](../server/src/_secondary/express/publicGatewayLocal.ts#L168) declares `int64`. Server encoding user 42 is `18 2a`; target encoding is `18 54`; the target decodes the server's value as **21**. Some shared system/faction/skill/type identifiers are also uint32 instead of target uint64. | Correct the target envelope/dependency contract and add target-derived request/response/notice tests, including user-target zigzag encoding and wide IDs. Preserve privacy routing. Audit optional identity/trace fields separately from required behavior. |
| F02 | Composite/voxel asteroids — **scoped implementation added** | Target recipe/mined-set RPCs, original compact-grid indices, zlib bits and voxel notices are implemented with four shapes verified by the actual client. Eight base legacy ore identities use target composite type95899; partial cells, collision holes and replay persist. The audit initially found only radius-based depletion. | [Voxel mining](VOXEL_MINING_3640684.md) records tests and mappings. Complete remaining grade/vein/catalog and retail substrate density/toughness/gate balance; verify native rendering and incremental collision-tail behavior. |
| F03 | Regolith and channeled tractor pickup — **implemented; native acceptance pending** | Target `CRRegolith.oreUnits`, bound ship `BeginScoop/CancelScoop`, timed pull/channel, local visibility/scope/range/capacity, cancellation and exclusive claims are implemented. Supported voxel mining creates fragments instead of immediate inventory credit; SQLite atomically commits consumption with the grant. | [Voxel mining](VOXEL_MINING_3640684.md) records rollback/restart and production-path tests. Verify native pickup visuals and live concurrency; define operational fragment expiry/respawn policy. Existing fitted container/wreck tractors remain a separate workflow. |
| F04 | Manual flight controls and reconciliation — **partial** | `frontier/navigation/client/integration.pyc:645/700/712/724` calls `CmdSetPitchRate`, `CmdSetRollRate`, `CmdSetBrakeFraction`, `CmdSetHeading` and consumes corresponding `OnSet*` echoes. These commands/state actions are absent; [beyonceService.ts:2683](../server/src/services/ship/beyonceService.ts#L2683) supports speed fraction, absolute pitch, strafe and yaw rate. | Add the missing input contracts, authoritative motion/state and Destiny echoes; validate client prediction/interpolation, stopping and heading reconciliation rather than aliasing rates to absolute angles. |
| F05 | Magnetic docking points, port cargo/refueling — **absent** | `frontier/docking_point/client/docking_point_svc.pyc:179/247/425/1029` calls `dockingPointService.undock/get_docking_capabilities/manual_dock/get_docked_point`; `refuel_pane.pyc:90` calls `refuel_from_port`. Normal primary actions use this workflow. Existing [berthingSvcService.ts](../server/src/services/frontier/berthingSvcService.ts) implements SmartHangar berthing, not this service. | Implement capabilities, approach/settling/failure/cancel/undock, movement suppression/resync, cargo/refuel access and dock-state persistence with the target notices. |
| F06 | Digital Chemistry recipes/jobs — **absent** | `frontier/digitalchemistry/client/recipe_svc.pyc:49–159` calls `digitalChemistry.list_recipes/preview/start/get_jobs/discontinue` and listens for `OnRecipeJobCompleted`. No server service. Existing blueprint industry does not satisfy its typed properties/traits and recipe-plan model. | Add recipe/property catalog and planner, authorized preview, atomic input consumption, timed/discontinued jobs, output delivery, completion notices and persistence. |
| F07 | Frontier skill complexity and vault — **absent** | `frontier/skills/client/service.pyc:39/52/82` calls plural `skillsMgr.get_complexity_split/get_vault_complexity`, consumes inherited/acquired maps and `OnSkillsUpdated`. [skillMgrService.ts:154](../server/src/services/skills/skillMgrService.ts#L154) registers singular `skillMgr` for traditional skill queues. | Implement the Frontier complexity/vault model, catalog and persistence, connect character panels and progression notifications; retain legacy skills only where intended. |
| F08 | Memories, ascension, crowns and shell switching — **partial/stubbed** | Target `experience/client/service.pyc:87–169` and `frontier/shell/client/service.pyc:86–135` expose these workflows. [experienceService.ts:160](../server/src/services/frontier/experienceService.ts#L160) returns zero/empty progression and refuses memory/ascension/crown mutations; [shellManagerService.ts:341](../server/src/services/frontier/shellManagerService.ts#L341) rejects crown operations and `:401` rejects create/activate shell. | Implement durable progression/memory ownership, choices/costs, crown cooldown/create/equip/delete and shell transitions. Preserve already implemented basic equipment and raiment behavior. |
| F09 | Medical kits, remedies and medical traits — **partial/refused** | `frontier/shell/client/service.pyc:110–122` calls trait/kit/remedy actions. [shellManagerService.ts:269](../server/src/services/frontier/shellManagerService.ts#L269) returns empty trait breakdown and `:377–390` rejects mutations; [statusEffectMgrService.ts](../server/src/services/frontier/statusEffectMgrService.ts) advertises no medical traits. | Validate/consume items, apply healing/remedies/traits and notify state; integrate with existing environmental damage rather than claiming that entire subsystem is absent. |
| F10 | Relay-lens purchase and feral data sale — **absent** | `frontier/smart_assemblies/client/trader/relay_messenger.pyc:57/79/106` sends lens prepare/execute/price requests. Trader controller `:136` calls `feralnetwork.sell_feral_data`. No corresponding gateway/remote service. | Implement price/quote and prepare/execute semantics, cargo/access checks, sale/purchase accounting, completion/failure handling and transaction idempotency. |
| F11 | LUX/token exchange and wallet balances — **partial/local substitute** | `CryptoCurrencyMessenger` calls exchange mutation APIs; [frontierTokenExchangeGatewayService.ts](../server/src/_secondary/express/gatewayServices/frontierTokenExchangeGatewayService.ts) only implements a fixed 1:1 exchange-rate read. Wallet balance currently represents local character balance rather than a verified requested wallet address. | Decide the local/chain economic authority, then implement actual conversions, address binding, accounting and reconciliation. Matching read schemas do not establish exchange support. |
| F12 | Celestial stargate rebuild/fuel operations — **partial contract mismatch** | `frontier/stargates/client/stargate_svc.pyc:49/52/67` calls `get_rebuild_progress/deposit_rebuild_items/deposit_fuel_items`. [stargateService.ts:153](../server/src/services/frontier/stargateService.ts#L153) instead has fuel-energy reads and custom reactivation APIs. | Map target request/result/notice shapes onto authoritative rebuild/fuel state and resource consumption. Preserve existing travel, smart-gate linking and reactivation functionality. |
| F13 | Structure transponders — **partial method/type coverage** | `frontier/iff/client/structures.pyc:79` calls `iffMapService.set_structure_transponder`. Target type predicate includes smart gates, slingshots and network nodes. [iffMapService.ts:103](../server/src/services/frontier/iffMapService.ts#L103) exposes `set_transponder`, and `:122` rejects non-cairn types. | Add the target method and response contract plus authorized handling of supported assembly types; a rename alone is insufficient. |
| F14 | Assembly location publication — **missing method** | `frontier/smart_assemblies/client/smart_assembly_svc.pyc:362` calls `smartAssemblyService.publish_location`; no server handler. Other assembly lifecycle methods are implemented. | Establish publication visibility/ownership, discovery integration and revocation/lifecycle behavior; do not substitute the owner's assembly listing. |

The voxel and scoop findings now corroborate the user's report with actual
client code. The exact physical rendering format, server mining authority,
material yield rules and live input binding still need their own acceptance
evidence; a client decoder is not the production server implementation.

## Conditional features and incomplete infrastructure

| ID | Feature / status | Evidence and planned decision |
| --- | --- | --- |
| F15 | Lagrange occupancy — **contract absent, activation unverified** | `frontier/lagrange_occupancy/client/lagrange_occupancy_svc.pyc:27–87` expects `lagrangeOccupancyMgr` add/remove/query/filter methods and claim/unclaim notices. Static exported points do not provide ownership. Establish enabled consumers, then implement authorized claims, conflicts, queries and persistence if part of the selected profile. |
| F16 | Claimed construction packs — **empty bootstrap** | Target `BuildingService.get_claimed_packs:48` calls `deploymentMgr.get_claimed_packs`; [deploymentMgrService.ts:36](../server/src/services/frontier/deploymentMgrService.ts#L36) always returns an empty list. Actual deployment/cancellation exists. Determine entitlement/claim policy and implement state if enabled. |
| F17 | Smart killmail reporting — **absent, wallet-dependent** | `frontier/web3/client/kill_mail_service.pyc:22–33` calls `smartKillMailService.report_kill/kill_already_reported` when a wallet is present. Conventional destruction/killmail records are not this on-chain reporting contract. Define authorization, report provenance and duplicate-safe submission/read state for the chosen chain profile. |
| F18 | Cycle Hub founder/achievement/broadcast lifecycle — **absent/conditional** | `founder_access_provider.pyc:24` calls missing `cycleService.is_founder`; client messengers subscribe to `achievement.CompletedNotice` and broadcast upload success/failure notices with no server producer found. Cycle Hub is configuration-controlled. Decide local entitlements/objectives/upload behavior or explicitly keep the feature unavailable. |
| F19 | Native wallet login/proof and event routing — **policy-dependent gap** | `ZKSignerMessenger` requests JWT/Enoki login/proofs and publishes a wallet-address report. No equivalent public handlers; the old local signing adapter may intentionally replace official authentication. [publicGatewayLocal.ts:2364](../server/src/_secondary/express/publicGatewayLocal.ts#L2364) ACKs `Events.Publish` frames without processing payloads. Define the local authentication/address-binding policy, and route required state events; telemetry-only ACKs are not evidence of gameplay mutation support. |
| F20 | Exploration/resource discovery and canonical-world completeness — **implemented core, incomplete integration** | The new exploration API delivers the legacy map/detail and visits. Thermal/EM ladders remain empty; asteroid belts/sites and mutable mining state are not exported. Existing scanning needs an explicit knowledge/discovery bridge, and all map/scene/travel/bootstrap consumers need the same selected world/catalog crosswalk. Retain conservative scope flags. |
| F21 | Exact-build launch/native patches and custom adapters — **not ported** | Target Macho version is independently confirmed as **489** in `eve/common/script/net/eveMachoNetVersion.pyc`; that agrees with the Frontier launcher's protocol default. However the launcher still selects build 3502403/cycle-6 and no 3640684 native patch profile exists. [frontier_windows_client.py:139](../tools/frontier-client/frontier_windows_client.py#L139) requires an exact profile; docking/features and custom adapters are build-scoped. Audit/port only required adapters, stage on copies, validate catalogs and launch on each claimed platform before promotion. |

The shared gateway comparison also found 13 target-only optional trace and
identity/authority fields and a server-only `bubble_instance_uuid` extension.
Unknown optional protobuf fields are not themselves broken features. Audit
their consumers and privacy semantics rather than treating all additions as
mandatory or assuming unknown fields fix the incompatible F01 user encoding.

## Features not inferred as missing gameplay

The target `frontier/beta.pyc` still hides numerous legacy EVE surfaces,
including PLEX, market, jump clones, daily login rewards, Project Discovery,
HyperNet, classic skill UI and assorted corporation controls. Their bundled
modules/protobuf types do not establish enabled Frontier requirements. New
Frontier complexity skills in F07 are a separate service and panel model.
Any intentional re-enablement needs an explicit feature-profile decision.

Focus navigation, gamepad/camera/reticle UI, scene warmup and much of the new
HUD are client-side. Inventory their adapters and exercise them during live
acceptance; do not add a server service solely because a new module exists.
Design gym, movement authoring, landscape QA and modular-ship prototype calls
are tracked as development/optional tooling. Composite asteroid **player**
recipe/mined-state calls in F02 are independently present outside the QA tool,
so that gameplay gap is not dismissed as a prototype.
Exploration's privileged `RevealAllRequest` and `ResetKnownRequest` also lack
handlers; track them as optional administrative tooling rather than part of
ordinary hydration/detail acceptance.

## Work order and acceptance

1. Fix F01 and establish the F21 exact-build stage/contract baseline. Keep
   the confirmed Macho 489 result separate from birthday, authentication,
   native-hook and live handshake acceptance.
2. Complete core interaction loops F02–F05, including explicit missing
   commands/notices, persistence, reconnect behavior and mining-to-pickup
   inventory accounting. Their absence blocks meaningful gameplay acceptance.
3. Complete F06–F14 using the target catalogs and existing server authority;
   add target-derived response/notice fixtures and transactional tests, then
   exercise the actual UI workflows in an isolated legacy world.
4. Resolve enablement/authority for F15–F19, implement the selected features
   or record intentional unavailability, and finish F20's discovery/world
   integration. Include mutable state in the P6 migration/rollback design.
5. Run the broader P1–P6/V1–V6 port gates. Preserve older profiles and never
   promote 3640684 merely because the exploration payload or a schema subset
   decodes successfully.

The original audit added planned work only. Subsequent authorized implementation
changes are described in the implementation record; the findings above are
retained as historical evidence, not a fresh report of missing services.
