# Frontier Smart Industry job lanes

Smart Industry facilities expose multiple independently occupied production lanes. A lane may run or discontinue one job at a time. The facility's selected recipe, input escrow, and output escrow remain shared, and every paid-run transition is committed through the item-table transaction so concurrent lanes cannot consume the same stack.

## Server configuration

`frontierSmartIndustryJobLaneCount` controls how many lanes are enabled on non-portable Smart Industry assemblies. It defaults to `4` and accepts whole numbers from `1` through `16`.

Creation-hosted Industry modules and portable Industry assemblies always expose exactly one enabled lane. Their lane count is not changed by this setting. Non-portable Smart Industry assemblies use the configured count.

`frontierSmartIndustryJobLaneCountByTypeID` optionally overrides the global count for individual compatible Smart Industry type IDs. A type ID absent from the map falls back to `frontierSmartIndustryJobLaneCount`.

It can be set in `evejs.config.local.json`:

```json
{
  "frontierSmartIndustryJobLaneCount": 4,
  "frontierSmartIndustryJobLaneCountByTypeID": {
    "87119": 2,
    "88063": 8
  }
}
```

The equivalent environment variables are `EVEJS_FRONTIER_SMART_INDUSTRY_JOB_LANE_COUNT` and `EVEJS_FRONTIER_SMART_INDUSTRY_JOB_LANE_COUNT_BY_TYPE_ID`; the latter accepts the same JSON object. Lowering a global or per-type count prevents new work on disabled lanes. Already persisted paid runs remain visible and continue settling so configuration changes—or changing a facility into a single-lane host—cannot strand or erase products.

The recognized compatible type IDs are sourced from the build-3502403 Industry facility catalog rather than a separate hand-maintained list. Invalid or non-Industry type IDs are rejected by config validation. Portable facilities and Creation-hosted modules remain authoritative single-lane facilities even if their type IDs appear in the override map.

## Access policy

Each lane persists its own owner-managed access policy:

- `owner`: only the facility owner.
- `tribe`: members of one or more configured tribe/corporation IDs.
- `allowlist`: configured character IDs and, optionally, tribe/corporation IDs.
- `public`: any character that passes the ordinary live-space facility checks.

The facility owner always retains use and management access. Lane access does not bypass the same-system, in-space, active-ship, local-visibility, construction-state, activation-state, or 5 km interaction checks. Creation-hosted Industry modules remain bound to the owner and active Creation ship.

Shared recipe and escrow mutations remain owner-only. A delegated lane user may start or discontinue a job on that lane using the owner's already loaded recipe and escrow; they do not gain inventory, blueprint, dismantle, or module-removal authority.

## Native RPC contract

Existing build-3502403 calls remain lane-1 compatible:

- `get_facility_details(facility_id)` adds `job_lane_count` and `job_lanes`, while its existing `production` member mirrors lane 1.
- `start_production(facility_id, blueprint_id, blueprint_hash, runs=None, lane_id=1)` starts one paid run on the selected lane.
- `discontinue_production(facility_id, lane_id=1)` marks that lane for discontinuation after its paid run.
- `get_job_lanes(facility_id)` returns lane state, access, and caller capabilities.
- `set_job_lane_access(facility_id, lane_id, policy)` updates one lane's access policy.

Lane entries expose `lane_id`, `enabled`, `can_use`, `can_manage`, `access`, and `production`. Access contains `mode`, `character_ids`, and `tribe_ids`.

`OnFrontierIndustryJobLaneChanged(facility_id, lane_id, change)` invalidates lane state in patched clients. The retail protobuf production notices cannot represent a lane, so only lane 1 is mirrored to those legacy notices and to the existing Sui Industry production field.

## Client behavior

The verified Python 3.12 bytecode adapter adds a lane selector to the native Production panel when the server exposes multiple enabled lanes. Selecting a lane swaps the displayed production state and routes Start/Discontinue to that lane. Creation-hosted and portable facilities receive only lane 1, so they retain the ordinary single-lane presentation. The adapter also exposes:

- `industry.get_job_lanes(facility_id)`
- `industry.select_job_lane(facility_id, lane_id)`
- `industry.set_job_lane_access(facility_id, lane_id, mode, character_ids=None, tribe_ids=None)`

The final method is available to ROOT/custom client surfaces for detailed per-lane administration. Lanes the caller cannot use are displayed disabled.

## Lifecycle safeguards

- Blueprint replacement and escrow-empty operations require every lane to be stopped.
- Creation module removal and Smart Assembly dismantling are blocked while any lane is active.
- The background worker discovers a facility when any lane is running and settles all due lanes.
- Job IDs are unique within a facility, not merely within a lane.
- Lane 1 is duplicated in the legacy `production`/`productionRecipe` fields so older clients and existing chain projections continue to function.

## Durable NPC execution

Persistent NPCs use `industry.production` jobs in `server/src/space/npc/npcIndustryJobService.ts`. A job may reserve and operate several enabled lanes on one facility, but all lanes must use the same loaded blueprint because recipe and escrow are facility-wide. Run counts are bounded and lane IDs must be unique.

The NPC path uses the ordinary Industry access and production runtimes. Owner NPCs may load a blueprint; delegated NPCs require the lane policy plus assembly `operate`, and cross-owner escrow movement separately requires `inventory.deposit` or `inventory.withdraw`. Input/output ownership changes are journalled with idempotent custody receipts. Committed output-transfer receipts provide the per-job collection total, avoiding stale-baseline coupling between independently scheduled lanes and preventing duplicate collection after a crash. Collection is rejected until the NPC ship has enough effective fitted cargo capacity.

Each lane stores an `executorKey` derived from the durable NPC job ID and lane ID. This is the recovery correlation for a crash after a paid run commits but before the NPC behavior checkpoint. On restart, the NPC adopts only the matching lane execution; it will not claim or overwrite another actor's production.

Construction templates may add an Industry child job after the facility is realized:

```json
{
  "loadout": {
    "industryLanes": [
      { "laneID": 1, "blueprintID": 1026, "runs": 4 },
      { "laneID": 2, "blueprintID": 1026, "runs": 4 }
    ],
    "collectIndustryOutputs": true
  }
}
```

The child job is idempotent by construction-template job and node ID. Missing materials suspend the child and publish one `industry-material-request` rather than partially starting its lanes.

The multi-lane scheduler remains a server/client feature. The split
`smart_industry` package and registry are live on the current Localnet, but its
existing production sidecar is a single compatibility record and therefore
mirrors only lane 1. No lane-aware Sui schema was published for this work.
Representing lanes 2–N on chain requires an explicit compatible extension or a
versioned Industry contract update; it must not be implied by the current
deployment.
