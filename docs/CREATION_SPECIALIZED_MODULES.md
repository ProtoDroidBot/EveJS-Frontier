# Frontier Creation specialized-module inventory

This inventory is based on client/SDE build `3502403` and the Python 3.12
client contracts. The server treats `creationModules.jsonl`, `types.jsonl`,
`typeDogma.jsonl`, and `spaceComponentsByType.jsonl` as the authoritative
module and payload definitions.

| Type | SDE behavior | Server behavior |
| --- | --- | --- |
| Emergency Printer (95302) | `industry` | Adds its own Creation-industry facility/tab. Blueprint, escrow, and production are independently persisted. Removal is blocked while a job is active or either escrow side is non-empty. |
| Material Processor (95486) | `industry` | Adds its own Creation-industry facility/tab with independent persisted blueprint, escrow, and production state. |
| Cutting Laser (95317) | `held_beam` / multipurpose utility | Resolves the first authoritative swept collision without a target lock. List-612 asteroid and Frontier salvageable-wreckage collisions enter the shared mining inventory/depletion/ledger path at `13 m3 * 60% * held-beam ramp`; other physical collisions use the lens's authored combat damage. |
| Crude Extractor (95503) | `held_beam` / extraction utility | Resolves the first authoritative swept collision without a target lock. Only list-601 Crude Rift resources enter the shared mining path, at `2.7 m3 * 90%` per cycle. It has no authored combat damage, so ships and scenery terminate the beam and receive endpoint FX but take no damage. |
| Needle (95778) | `held_beam` / multipurpose utility | Resolves the first authoritative swept collision without a target lock. List-612 asteroid and Frontier salvageable-wreckage collisions enter the shared mining path at `10.4 m3 * 48% * held-beam ramp`; other physical collisions use the lens's authored combat damage. |
| Hull Repairer (95316) | `generic` / `structureRepair` | Uses the normal authoritative local-cycle runtime for capacitor, end-of-cycle structure repair, persistence, HUD timing, and effect presentation. |
| Leap (95319) | `generic` / active thrust | Applies the client-authored volatility/impulse thrust formula while active and prepays each cycle from the persistent FIFO fuel queue. |
| Directional Scanner (95322) | `directional_scan` | Uses Frontier scanning/resolution and its authored cone, range, duration, and sensor strengths. Activation is rejected while either the scanner is offline or its Creation hull is powered off. |
| Repeater (95679) | `generic` / control | Automates the existing skill-shot firing path through the patched build-3502403 auto-fire loop; it does not create a second weapon or damage path. Manual aimed shots remain available without it, while each marked automatic shot reuses normal aim/collision/damage authority and fails closed when the Repeater is absent or offline. |
| Approach Computer (95728) | `generic` / active control | Follows its locked in-range ship target while active and revalidates lock, target, and range every cycle. |
| Transfuser (95754) | `generic` / fuel transfer | Transfers FIFO fuel to a locked in-range ship using the authored per-cycle amount and efficiency, honoring target capacity with rollback-safe paired persistence. |
| Autohelm (95767) | `generic` / control | Authorizes the build-3502403 automatic Approach command. Powering it off, removing it, or powering down the Creation cancels only the still-current Autohelm-authored movement trace. The shipped client sends both Approach and Keep-at-range as `CmdFollowBall(target, 50)`, so the server cannot distinguish those two 50 m intents at the RPC boundary. |
| Thrust Overdrive (95810) | `generic` / active thrust | Multiplies its authored injection by the count of online thrusters, applies the resulting velocity boost, and prepays its per-cycle persistent fuel cost. |
| Launch Bay (95811) | `launch_bay` | Advertises `deploy`, accepts group-5142 Payload charges in flag 184, launches one persistent dynamic entity outside the hull, and inherits dungeon/grid scope. Its authored 20-second reload/deploy cooldown is enforced server-side and persisted atomically with each payload move, so reconnects and restarts cannot bypass it. Heat Traps remove up to their authored 150 K from the launching ship transactionally. |
| Transponder (95988) | `iff` | Broadcasts the configured tribe/code and supplies friendly/hostile IFF verdicts while both module and hull power are available. Its configured active mode persists through a reversible power loss and resumes when authority returns. Active effect 12972 also adds the authored +100 `signatureEm` bloom to passive EM scanning. |
| Fuel Blister (96013) | `reserve_fuel_tank` | Adds 250 fuel units while online. Its fuel is a reserve FIFO tier consumed after ordinary tanks. Offlining seals that share on the module; onlining restores it. Removing a sealed blister voids its inaccessible fuel atomically. |
| Transponder Beacon (96039) | `iff_beacon` | Installed-module beacon: immobilizes its host while active and exposes a matching-code warpable rally point. Module/hull power loss suspends visibility and immobilization for the remainder of its authored cycle; restoring power resumes them, while removing the module terminates the beacon. It is not a Launch Bay charge in build 3502403. |
| Blackstart Cell (96055) | `generic` / capacitor | Adds a 100 GJ capacitor reserve and recharges it without fuel at the authored 0.3 GJ/s solar rate, scaled by direct-starlight temperature. Recharge stops in shadow, warp, or a berth and stops when the cell's reserve share is full; it remains available on an otherwise powered-off Creation. Adding or onlining one preserves absolute charge rather than minting 100 GJ, while offlining or removing it clamps charge to the remaining capacity and discards energy held in its reserve. |

## Launch Bay payloads

The build-3502403 Launch Bay has capacity 48 m3 and charge group 5142
(`Payload`). The authored payload inventory is:

| Payload | Volume | Runtime result |
| --- | ---: | --- |
| Field Cairn (93141) | 48 m3 | Spawned as a persistent, scoped deployable with its authored 24-hour decay component. |
| Heat Trap (95812) | 16 m3 | Up to three may be loaded; each launch transfers up to 150 K and spawns the trap with the transferred temperature. The trap follows the client-authored exponential cooling recipe, publishes cooling/volatility changes, and may be scooped by its owner only after cooling below 350 K. Destruction discharges thermal damage to every damageable ship (including the owner and allies) within the authored 5 km radius using `max(0, currentK - 350K) * 9`, then reuses the shared damage, destruction, kill-attribution, and presentation paths. |
| Field Sentry (96099) | 48 m3 | Spawned as a persistent, scoped deployable with its authored behavior component (2465/2466) and 24-hour decay. It uses the authored hull-mounted projectile profile (162 kinetic damage, 1.6 s rate of fire, and a 25 km target-range cap) through the shared lock, weapon-FX, obstruction, damage, and kill-attribution path. Its owner-safe defensive policy engages only an attacker recorded against the sentry itself or the Creation that launched it. |

`Transponder Beacon` (96039) is group 203, volume 60 m3, and appears in
`creationModules.jsonl` as an installed `iff_beacon`. Consequently the 3.12
client's reload picker cannot place it in a Launch Bay. Supporting a second,
launchable beacon would require an authored group-5142 payload type (or a
coordinated client/SDE contract change); a server-only exception would leave
the UI unable to load it.

## Passive scanning and EM signature Dogma

The passive-scanning runtime consumes the ship's effective derived Dogma
attributes, rather than recognizing module names in the scanner. This keeps
the module/hull power rules in one place: offline modules and ordinary modules
on a powered-off Creation contribute neither scan authority nor signature
modification.

| Module | Build-3502403 authority consumed by the server |
| --- | --- |
| Ion Sensor (95321) | Effect 12938 adds 7.0 EM scan strength (6173) and multiplies EM angular resolution (6171) by 0.7. |
| Ion Tube (95678) | Effect 12945 adds 0.65 EM scan strength (6173). |
| Gravity Sensor (95718) | Effect 12908 adds 5.0 gravity scan strength (6139) and multiplies gravity angular resolution (6168) by 0.15. |
| Gravity Chamber (95680) | Effect 12946 adds 0.46 gravity scan strength (6139). |
| Command Pod (95323) | Effect 12919 adds 0.05 gravity scan strength (6139) and 45 to gravity angular resolution (6168). |
| EM Scrambler (95763) | Online effect 12957 applies -60% to `signatureEm` (6094), reducing the Creation's EM scan return from the neutral authored 100 to 40 before other modifiers. |
| Transponder (95988) | Active broadcast effect 12972 adds 100 to `signatureEm` (6094); a neutral Creation therefore broadcasts at 200 before other modifiers and generic active-module emissions. |

Attributes 6139/6173 are authored on a log10 scale. Attributes 6168/6171
are positive linear angular resolution values where lower is better and have
an authored Dogma default of 10. Creation hull rows use zero/absence to mean
"no sensor", so the server seeds that default only for a channel which has an
online modifier. `OnPassiveScanResults(updated_scans, removed, added)` carries
unresolved seven-field `CombinedScanResult` states; resolved contacts move
into the normal ballpark/contact path with the client's resolved-to-item fate.

The client package does not contain the server-side formula which maps those
Dogma values to signal/noise. The emulator therefore isolates one deterministic
approximation in `scanningRuntime`: passive strength `s` maps to multiplier
`10^(s - 5)`, preserving the authored tenfold gain per +1. EM target strength
uses effective `signatureEm / 100`; apparent signature radius uses the best
online channel's angular resolution. This mapping can be replaced without
changing the SDE-derived module authority above.

## IFF verdict contract

Build `3502403`'s Python 3.12 client consumes `OnIffVerdicts` as a
`dict[int, bool]`. The Frontier HUD bracket implementation maps `True` to
`HudColor.IFF_FRIENDLY` and `False` to `HudColor.IFF_UNFRIENDLY`; therefore
hostile/unfriendly rows are an authored client contract rather than a
server-only extension. The server emits no row for a ship with no active
transponder (unknown), `true` for a mutual tribe/code match, and `false` for
an actively broadcasting non-match.

## Held-beam utility authority

Build `3502403`'s Python 3.12 client registers Cutting Laser, Crude Extractor,
and Needle with the same `held_beam` SkillShot mode and sends only the fitted
module plus world-space aim. The server therefore uses the first swept
ballpark collision as the target; a conventional target lock is neither sent
nor required. Scenery and nearer resource props remain real obstructions.

The collision consequence is selected from authored SDE data:

- Cutting Laser and Needle lenses use specialization type list 612. That list
  includes the Frontier mineable asteroids and salvageable-wreckage resource
  props (95349, 95350, 95359, 95360, and 95361). It does not turn ordinary EVE
  wreck inventory into a salvager cycle.
- Crude Extractor lenses use specialization type list 601, containing Crude
  Rift resource types 77729, 78434, 92394, and 92414.
- `miningAmount` is scaled by `miningEfficiency` and the same authored
  held-beam ramp multiplier used for damage. Resource yield then reuses the
  normal cargo-capacity, depletion, persistence, presentation, and mining
  ledger transaction.
- Capacitor, lens volatility, and beam FX are consumed/emitted once by the
  SkillShot cycle before consequence routing. The mining consequence disables
  its normal crystal-volatility roll, preventing a double roll.
- A recognized resource collision never falls through to combat damage,
  including incompatible-lens, full-cargo, and depleted-resource failures.
  Those failures stop the held beam and emit `OnSkillShotFailed` instead of a
  misleading success event. Crude Extractor likewise never deals combat
  damage to a non-resource obstruction; Cutting Laser and Needle retain their
  explicitly authored dual-purpose combat behavior.

## Persistence and ordering

- Ordinary fuel is always inserted before reserve fuel, including after a
  partial burn and later refuel.
- Reserve markers and sealed Fuel Blister queues are retained by item-store
  normalization and server restarts.
- Launch moves, payload state, inherited interaction scope, the Launch Bay's
  next-ready timestamp, and Heat Trap transfer are rolled back if persistence
  or dynamic spawning fails. The persisted next-ready timestamp also guards
  reload and deploy after a reconnect or server restart.
- Creation Industry withdrawals may move escrow directly into a jetcan without
  staging through ship cargo. The move is atomic, post-commit presentation is
  non-retryable, and the affected Industry-tab snapshot is republished.
- Active Creation effects use the shared module lifecycle for capacitor, heat,
  HUD timing, and SpecialFx; Frontier-only thrust and fuel consequences run at
  the same authoritative cycle boundary.
- A live ballpark refresh hydrates the newly persisted fuel queue before it
  writes the entity back, preventing stale in-space state from reopening a
  sealed Fuel Blister.
