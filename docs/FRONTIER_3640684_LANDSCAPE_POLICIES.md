# Temporary 3640684 landscape allocation and encounters

Implemented 2026-10-26 for the opt-in [temporary landscape profile](FRONTIER_3640684_TEMPORARY_LANDSCAPE.md).
These policies operate on the decoded target content while the
`3502403-MOD4-STUFF1` galaxy remains authoritative. Authored site and locator
positions are preserved. Full era 6 cycle 7 files will replace this arrangement.

## Source rules and temporary defaults

The exact client archive contains `locator_config`, `resource_config`,
`mass_sampling`, and dungeon trigger/event definitions. It does not contain
the server's global resource budget, substrate distribution, or complete NPC
group roster. The server therefore combines verified client rules with the
explicit defaults below. They are temporary gameplay choices, not a claim to
reproduce official encounter balance.

| Area | Verified client input | Temporary server choice |
| --- | --- | --- |
| Resources | Resource locator 91211; tag-dependent carrier lists; native locator-cap scaling; composite lognormal mass formula; dogma 6070 ore yield | 24,000 total ore units per resource-bearing site, uniform selection among eligible materials, deterministic sampling; 25–150 m radius bounds |
| NPC locator | Locator 91214, cap one per site; target NPC metadata | One Mycena, type 94167, at the selected locator |
| Threat locator | Locator 91213, cap two normally or one for the Trojan rule | Watcher, type 83566, activated when a player enters 75 km of the locator |
| Event locator | Locator 91212, same cap as threat | Mycena activated by the first committed mining event at the site's allocated resources; 75 km proximity when the site has no resources |
| Authored group 33025 | Entity binding uses behavior 1981 and group behavior 2086, matching target Watcher metadata | One Watcher replaces the unavailable roster; the plan records this substitution |
| Guard behavior | Authored aggression/orbit ranges, initial delay, spawn-once flag and respawn interval | Missing guard values use 75 km aggression, 5 km orbit and one spawn |

Resource caps follow the native tag precedence and piecewise scaling. They
reach eight selected locators for the normal rule and six for the Trojan rule;
small sites use fewer. Stocks are distributed with an exact integer total.
The native mass formula supplies relative weights because the global physical
mass budget is unavailable. Ore-unit budgets are not presented as mass.

Native material candidates are inner rocky belt carriers 91374–91376, outer
icy belt carriers 91377–91381, and the verified Trojan/default combinations.
Every carrier resolves its ore yield through target dogma. Mining uses the
existing voxel removal, dropped-regolith and scoop-pickup path. Authored
salvage keeps its own finite stock and presentation. There is no automatic
resource refill within a profile/policy revision.

NPCs use the existing native NPC controller, target hull dogma and weapon
behavior. The temporary allocations add no synthetic loadout, cargo, bounty
or loot table. Authored respawn intervals are respected; generated locator
encounters default to one spawn. An empty encounter is not re-rolled on re-entry.

## Trigger and scene behavior

Landscape planning now selects natural, broken and wild patterns. The target's
wild pattern in ecosystem 30 is retained; that ecosystem's disabled flag still
prevents encounter allocation.

The policy runtime supports entry, proximity, elapsed-time, attacked, mining,
resource depletion, entity destruction, group-cleared and explicit server
events. Trigger probabilities are deterministic. Delayed decisions and fired
triggers are persisted before their spawn effects, and failed effects are
retryable without another decision or duplicate NPC allocation. Room-mined-out
conditions require all relevant resources to be depleted.

Native room-entry, proximity, attacked, mined, mined-out and destruction IDs
are translated explicitly. Native spawn events resolve exact object/entity
bindings. Unknown or unresolved trigger actions produce diagnostics instead
of becoming unconditional spawns. The 79 dungeon patterns referenced by the
35 ecosystems contain only one native trigger: dungeon 14125's room-mined-out
trigger 85082, with no actions. No reward or completion action is invented for it.
The other scripts in the full 393-dungeon catalog remain outside this landscape
allocation policy's execution scope.

The runtime enforces an entry pattern's module-block flag during module
activation inside a 250 km temporary policy radius. All 35 supplied ecosystems
currently set that flag to zero. Cosmetic asset-manipulation/environment
overrides and unrelated mission scripting are retained metadata.

## Persistence, activation and replacement

The profile's source fingerprint is unchanged. Allocation policy version 1
has revision `bfb14bbbe16fe6658af22b82bd6b4caf0a669612b83745c4b7d060f00c20f917`.
Resource entity identities and voxel receipts include
both revisions. `temporaryLandscapeState` stores site allocation intents,
trigger decisions, NPC generations and respawn times. Native NPC records and
their operation journal carry the same identity, and restoration checks the
selected profile and policy before materializing them.

Re-entering a site restores remaining stock and surviving NPC identities.
Destroyed one-shot NPCs remain destroyed. Authored respawns create a new
generation only after the stored deadline. Removing or replacing the temporary
profile preserves the old records and prevents its NPCs from appearing under
another profile. Restart the server after any profile or policy change.

No additional activation setting is required beyond the two paths documented
in the [temporary profile setup](FRONTIER_3640684_TEMPORARY_LANDSCAPE.md).
Existing launch defaults remain unchanged. Policy changes must bump
`temporaryLandscapePolicyVersion.ts`; never reuse a revision for changed stock,
placement, encounter or lifecycle rules. Existing receipts are not reset.

## Verification

The final combined run passed **191 tests across 31 test files**, with zero
failures or skips. Server, tool and test TypeScript builds passed. Four additional
native NPC persistence regressions passed. The complete-data check covered all
19 active ecosystems that have placed sites: 18 produced resources in the
deterministic sample, totaling 94 ore allocations, 78 NPC allocations and 60
triggers. These are test-sample totals, not galaxy-wide population counts.
It also verified the disabled, unplaced wild ecosystem with a planning fixture.

Focused tests cover deterministic allocations, native material and cap rules,
trigger ordering, delayed activation, write/spawn failures, NPC death and
respawn, revision isolation, module-block boundaries, and restoration.
The optional complete-data test also checks every site-bearing ecosystem,
target references, wild-pattern selection, and actual resource-to-voxel
registration through the production scene adapter.

The native-code oracle matched 2,002 locator-cap inputs and 75 composite mass
parameter inputs. Evidence is saved under `_local/feature-audit-3640684/`:

- `landscape-policy-evidence.json`
- `landscape-policy-trigger-catalogs.json`
- `landscape-resource-native-oracle.json`
- `temporary-landscape-policy-full-verification.json`
- `temporary-landscape-policy-verification.json` and
  `temporary-landscape-policy-tests.log`

Run the server/test/tool builds followed by `npm run test:frontier-3640684`.
Set the three `FRONTIER_TEMPORARY_TEST_*` artifact paths from the temporary
profile setup to include the full-data check. Tests use disposable stores.
Live-client rendering, combat presentation and gameplay balance still require
native acceptance testing.
