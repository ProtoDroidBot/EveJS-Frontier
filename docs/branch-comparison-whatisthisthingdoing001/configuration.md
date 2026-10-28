# Configuration changes

The declared server configuration expands from **224 to 280 entries**: **56 additions and one changed default**. This table covers every changed entry in `CONFIG_ENTRY_DEFINITIONS` and every changed key in the committed local override. Values are from the pinned commits, not from an operator's effective environment.

Source defaults and local overrides are distinct. In particular, `smartAssemblyBaseDappUrl` defaults to `http://localhost:5174` in code but the committed local file selects `https://dev.dapps.evefrontier.com`. Existing unrelated development/authentication settings are unchanged by this diff. Additional feature-specific environment variables read directly by individual modules are described in the subsystem reports.

Sources: [server configuration](../../server/src/config/index.ts), [committed local configuration](../../evejs.config.local.json).

| Setting | Change | Upstream default | Branch default | Committed branch override | Environment variable |
| --- | --- | --- | --- | --- | --- |
| `adaptiveTickRateCpuHighPercent` | Added | `absent` | `75` | `75` | `EVEJS_ADAPTIVE_TICK_RATE_CPU_HIGH_PERCENT` |
| `adaptiveTickRateCpuLowPercent` | Added | `absent` | `35` | `35` | `EVEJS_ADAPTIVE_TICK_RATE_CPU_LOW_PERCENT` |
| `adaptiveTickRateEnabled` | Added | `absent` | `false` | `false` | `EVEJS_ADAPTIVE_TICK_RATE_ENABLED` |
| `adaptiveTickRateInitialIntervalMs` | Added | `absent` | `100` | `100` | `EVEJS_ADAPTIVE_TICK_RATE_INITIAL_INTERVAL_MS` |
| `adaptiveTickRateMaxIntervalMs` | Added | `absent` | `250` | `250` | `EVEJS_ADAPTIVE_TICK_RATE_MAX_INTERVAL_MS` |
| `adaptiveTickRateMemoryHighPercent` | Added | `absent` | `80` | `80` | `EVEJS_ADAPTIVE_TICK_RATE_MEMORY_HIGH_PERCENT` |
| `adaptiveTickRateMemoryLimitMb` | Added | `absent` | `0` | `0` | `EVEJS_ADAPTIVE_TICK_RATE_MEMORY_LIMIT_MB` |
| `adaptiveTickRateMemoryLowPercent` | Added | `absent` | `60` | `60` | `EVEJS_ADAPTIVE_TICK_RATE_MEMORY_LOW_PERCENT` |
| `adaptiveTickRateMinIntervalMs` | Added | `absent` | `50` | `50` | `EVEJS_ADAPTIVE_TICK_RATE_MIN_INTERVAL_MS` |
| `adaptiveTickRateSampleIntervalMs` | Added | `absent` | `2000` | `2000` | `EVEJS_ADAPTIVE_TICK_RATE_SAMPLE_INTERVAL_MS` |
| `adaptiveTickRateStepMs` | Added | `absent` | `10` | `10` | `EVEJS_ADAPTIVE_TICK_RATE_STEP_MS` |
| `asteroidBeltStartupReset` | Changed | `true` | `false` | `false` | `EVEJS_ASTEROID_BELT_STARTUP_RESET` |
| `frontierCloneDeathTransitionDelaySeconds` | Added | `absent` | `5` | `5` | `EVEJS_FRONTIER_CLONE_DEATH_TRANSITION_DELAY_SECONDS` |
| `frontierEnvironmentalDamageDelaySeconds` | Added | `absent` | `30` | `30` | `EVEJS_FRONTIER_ENVIRONMENTAL_DAMAGE_DELAY_SECONDS` |
| `frontierEnvironmentalFeralizationThresholdRatio` | Added | `absent` | `1` | `1` | `EVEJS_FRONTIER_ENVIRONMENTAL_FERALIZATION_THRESHOLD_RATIO` |
| `frontierEnvironmentalHeatCriticalThresholdKelvin` | Added | `absent` | `1500` | `1500` | `EVEJS_FRONTIER_ENVIRONMENTAL_HEAT_CRITICAL_THRESHOLD_KELVIN` |
| `frontierEnvironmentalHeatWarningThresholdKelvin` | Added | `absent` | `500` | `500` | `EVEJS_FRONTIER_ENVIRONMENTAL_HEAT_WARNING_THRESHOLD_KELVIN` |
| `frontierEnvironmentalHitpointDamagePerEffectPerSecond` | Added | `absent` | `1` | `1` | `EVEJS_FRONTIER_ENVIRONMENTAL_HITPOINT_DAMAGE_PER_EFFECT_PER_SECOND` |
| `frontierEnvironmentalRiftDriftMultiplier` | Added | `absent` | `2` | `2` | `EVEJS_FRONTIER_ENVIRONMENTAL_RIFT_DRIFT_MULTIPLIER` |
| `frontierEnvironmentalRiftRadiusMeters` | Added | `absent` | `100_000` | `100000` | `EVEJS_FRONTIER_ENVIRONMENTAL_RIFT_RADIUS_METERS` |
| `frontierEnvironmentalTemporalDriftThresholdRatio` | Added | `absent` | `1` | `1` | `EVEJS_FRONTIER_ENVIRONMENTAL_TEMPORAL_DRIFT_THRESHOLD_RATIO` |
| `frontierEnvironmentalVitalityDamagePerEffectPerSecond` | Added | `absent` | `1` | `1` | `EVEJS_FRONTIER_ENVIRONMENTAL_VITALITY_DAMAGE_PER_EFFECT_PER_SECOND` |
| `frontierNetworkNodeScanElectromagneticStrength` | Added | `absent` | `1` | `1` | `EVEJS_FRONTIER_NETWORK_NODE_SCAN_ELECTROMAGNETIC_STRENGTH` |
| `frontierNetworkNodeScanGravimetricStrength` | Added | `absent` | `1` | `1` | `EVEJS_FRONTIER_NETWORK_NODE_SCAN_GRAVIMETRIC_STRENGTH` |
| `frontierNetworkNodeScanRangeJumps` | Added | `absent` | `3` | `3` | `EVEJS_FRONTIER_NETWORK_NODE_SCAN_RANGE_JUMPS` |
| `frontierNetworkNodeScanThermalStrength` | Added | `absent` | `1` | `1` | `EVEJS_FRONTIER_NETWORK_NODE_SCAN_THERMAL_STRENGTH` |
| `frontierRemoteScanCooldownMs` | Added | `absent` | `5_000` | `5000` | `EVEJS_FRONTIER_REMOTE_SCAN_COOLDOWN_MS` |
| `frontierRemoteScanDeepEnergyCost` | Added | `absent` | `75` | `75` | `EVEJS_FRONTIER_REMOTE_SCAN_DEEP_ENERGY_COST` |
| `frontierRemoteScanDeepOctreeDepth` | Added | `absent` | `6` | `6` | `EVEJS_FRONTIER_REMOTE_SCAN_DEEP_OCTREE_DEPTH` |
| `frontierRemoteScanDeepWarmupEnabled` | Added | `absent` | `true` | `true` | `EVEJS_FRONTIER_REMOTE_SCAN_DEEP_WARMUP_ENABLED` |
| `frontierRemoteScanDeepWarmupTimeoutMs` | Added | `absent` | `15_000` | `15000` | `EVEJS_FRONTIER_REMOTE_SCAN_DEEP_WARMUP_TIMEOUT_MS` |
| `frontierRemoteScanEnergyHoldMs` | Added | `absent` | `3_600_000` | `3600000` | `EVEJS_FRONTIER_REMOTE_SCAN_ENERGY_HOLD_MS` |
| `frontierRemoteScanIndexTtlMs` | Added | `absent` | `15_000` | `15000` | `EVEJS_FRONTIER_REMOTE_SCAN_INDEX_TTL_MS` |
| `frontierRemoteScanMaxConcurrentWarmups` | Added | `absent` | `4` | `4` | `EVEJS_FRONTIER_REMOTE_SCAN_MAX_CONCURRENT_WARMUPS` |
| `frontierRemoteScanMaxHeatCells` | Added | `absent` | `256` | `256` | `EVEJS_FRONTIER_REMOTE_SCAN_MAX_HEAT_CELLS` |
| `frontierRemoteScanMaxPayloadBytes` | Added | `absent` | `524_288` | `524288` | `EVEJS_FRONTIER_REMOTE_SCAN_MAX_PAYLOAD_BYTES` |
| `frontierRemoteScanMaxResources` | Added | `absent` | `128` | `128` | `EVEJS_FRONTIER_REMOTE_SCAN_MAX_RESOURCES` |
| `frontierRemoteScanMaxSites` | Added | `absent` | `128` | `128` | `EVEJS_FRONTIER_REMOTE_SCAN_MAX_SITES` |
| `frontierRemoteScanResultTtlMs` | Added | `absent` | `3_600_000` | `3600000` | `EVEJS_FRONTIER_REMOTE_SCAN_RESULT_TTL_MS` |
| `frontierRemoteScanSurveyEnergyCost` | Added | `absent` | `25` | `25` | `EVEJS_FRONTIER_REMOTE_SCAN_SURVEY_ENERGY_COST` |
| `frontierRemoteScanSurveyOctreeDepth` | Added | `absent` | `4` | `4` | `EVEJS_FRONTIER_REMOTE_SCAN_SURVEY_OCTREE_DEPTH` |
| `frontierRemoteScanningEnabled` | Added | `absent` | `true` | `true` | `EVEJS_FRONTIER_REMOTE_SCANNING_ENABLED` |
| `frontierScanningDetectionRangeMeters` | Added | `absent` | `100_000_000` | `100000000` | `EVEJS_FRONTIER_SCANNING_DETECTION_RANGE_METERS` |
| `frontierScanningRenderOutOfRangeSignatures` | Added | `absent` | `true` | `true` | `EVEJS_FRONTIER_SCANNING_RENDER_OUT_OF_RANGE_SIGNATURES` |
| `frontierScanningRenderResolvedObjects` | Added | `absent` | `true` | `true` | `EVEJS_FRONTIER_SCANNING_RENDER_RESOLVED_OBJECTS` |
| `frontierScanningResolutionRangeMeters` | Added | `absent` | `100_000_000` | `100000000` | `EVEJS_FRONTIER_SCANNING_RESOLUTION_RANGE_METERS` |
| `frontierScanningResolutionSnrThreshold` | Added | `absent` | `1` | `1` | `EVEJS_FRONTIER_SCANNING_RESOLUTION_SNR_THRESHOLD` |
| `frontierSignatureBloomElectromagneticHalfLifeMs` | Added | `absent` | `180_000` | `180000` | `EVEJS_FRONTIER_SIGNATURE_BLOOM_ELECTROMAGNETIC_HALF_LIFE_MS` |
| `frontierSignatureBloomGravimetricHalfLifeMs` | Added | `absent` | `300_000` | `300000` | `EVEJS_FRONTIER_SIGNATURE_BLOOM_GRAVIMETRIC_HALF_LIFE_MS` |
| `frontierSignatureBloomRetentionMs` | Added | `absent` | `1_800_000` | `1800000` | `EVEJS_FRONTIER_SIGNATURE_BLOOM_RETENTION_MS` |
| `frontierSignatureBloomThermalHalfLifeMs` | Added | `absent` | `120_000` | `120000` | `EVEJS_FRONTIER_SIGNATURE_BLOOM_THERMAL_HALF_LIFE_MS` |
| `frontierSmartIndustryJobLaneCount` | Added | `absent` | `4` | `4` | `EVEJS_FRONTIER_SMART_INDUSTRY_JOB_LANE_COUNT` |
| `frontierSmartIndustryJobLaneCountByTypeID` | Added | `absent` | `{}` | `{}` | `EVEJS_FRONTIER_SMART_INDUSTRY_JOB_LANE_COUNT_BY_TYPE_ID` |
| `npcPilotIdentitiesEnabled` | Added | `absent` | `true` | `true` | `EVEJS_NPC_PILOT_IDENTITIES_ENABLED` |
| `smartAssemblyBaseDappUrl` | Added | `absent` | `"http://localhost:5174"` | `"https://dev.dapps.evefrontier.com"` | `EVEJS_SMART_ASSEMBLY_BASE_DAPP_URL` |
| `solarSystemSceneIdleUnloadMs` | Added | `absent` | `3_600_000` | `3600000` | `EVEJS_SOLAR_SYSTEM_SCENE_IDLE_UNLOAD_MS` |
| `suiNpcCharacterProvisioningEnabled` | Added | `absent` | `true` | `true` | `EVEJS_SUI_NPC_CHARACTER_PROVISIONING_ENABLED` |

## Meaning and validation

### adaptiveTickRateCpuHighPercent

Process CPU level at or above which the controller lowers the tick rate.

Accepted values: Number from 0 through 100, above the low CPU threshold.

Declared bounds: minValue 0, maxValue 100.

### adaptiveTickRateCpuLowPercent

Process CPU level at or below which CPU is considered to have headroom. 100 percent represents one fully utilized logical CPU core; worker activity can make the measured value exceed 100.

Accepted values: Number from 0 through 100, below the high CPU threshold.

Declared bounds: minValue 0, maxValue 100.

### adaptiveTickRateEnabled

Enables CPU- and memory-aware adjustment of the authoritative space-runtime tick interval. High resource pressure lowers the tick rate; sustained headroom raises it again within the configured bounds.

Accepted values: true or false.

### adaptiveTickRateInitialIntervalMs

Space-runtime tick interval used at startup and as the fixed interval when adaptive tick rate is disabled. 100ms preserves the historical 10-ticks-per-second cadence.

Accepted values: Number within the configured minimum and maximum interval bounds.

Declared bounds: minValue 10, maxValue 5000.

### adaptiveTickRateMaxIntervalMs

Slowest allowed adaptive space-runtime cadence in milliseconds. 250ms is 4 ticks per second.

Accepted values: Number from 10 through 5000, no less than the minimum interval.

Declared bounds: minValue 10, maxValue 5000.

### adaptiveTickRateMemoryHighPercent

Process RSS level at or above which the controller lowers the tick rate.

Accepted values: Number from 0 through 100, above the low memory threshold.

Declared bounds: minValue 0, maxValue 100.

### adaptiveTickRateMemoryLimitMb

Memory budget used to turn process RSS into a pressure percentage. Set to 0 to automatically use the lower of the V8 heap limit and any process/container memory constraint exposed by Node.js.

Accepted values: 0 for automatic detection, or a positive memory budget in MiB.

Declared bounds: minValue 0.

### adaptiveTickRateMemoryLowPercent

Process RSS level at or below which memory is considered to have headroom.

Accepted values: Number from 0 through 100, below the high memory threshold.

Declared bounds: minValue 0, maxValue 100.

### adaptiveTickRateMinIntervalMs

Fastest allowed adaptive space-runtime cadence in milliseconds. 50ms is 20 ticks per second.

Accepted values: Number from 10 through 1000, no greater than the maximum interval.

Declared bounds: minValue 10, maxValue 1000.

### adaptiveTickRateSampleIntervalMs

Minimum time between process CPU and memory samples used by the adaptive tick-rate controller.

Accepted values: Number from 250 through 60000 milliseconds.

Declared bounds: minValue 250, maxValue 60000.

### adaptiveTickRateStepMs

Milliseconds added to or removed from the tick interval on each resource sample that crosses a threshold.

Accepted values: Number from 1 through 1000.

Declared bounds: minValue 1, maxValue 1000.

### asteroidBeltStartupReset

Administrative override that clears persisted belt asteroid depletion state during server startup. Disabled by default because mined-out asteroids now retain their depletion time across restarts and respawn after 24 hours. Generated ice sites keep their own lifecycle.

Accepted values: true or false.

Committed local value also changes from `true` to `false`.

### frontierCloneDeathTransitionDelaySeconds

Delay between a confirmed hull or shell death and the session change that opens the Frontier intermediary death report. The death notification is sent immediately so the stock client can begin its explosion or shell-expiration presentation before clone locations appear.

Accepted values: Non-negative number of seconds. 0 opens the death report immediately.

Declared bounds: minValue 0.

### frontierEnvironmentalDamageDelaySeconds

Continuous time an individual environmental effect must remain active before that effect deals vitality or ship hitpoint damage. Each heat, feralization, and temporal-drift effect tracks this grace period independently.

Accepted values: Non-negative number of seconds. 0 applies damage immediately.

Declared bounds: minValue 0.

### frontierEnvironmentalFeralizationThresholdRatio

Fraction of a ship's nominal maximum feralization that activates the feralization effect and starts its damage-delay timer.

Accepted values: Positive ratio. 1 activates at 100% of nominal maximum; 0.5 activates at 50%.

Declared bounds: minValue 0.

### frontierEnvironmentalHeatCriticalThresholdKelvin

Hull temperature at which the Frontier heat effect becomes active and its damage-delay timer starts.

Accepted values: Positive temperature in kelvin above the heat warning threshold.

Declared bounds: minValue 0.

### frontierEnvironmentalHeatWarningThresholdKelvin

Hull temperature at which the Frontier heat effect becomes armed and starts building grace. The critical threshold must remain greater than this warning threshold.

Accepted values: Non-negative temperature in kelvin below the critical threshold.

Declared bounds: minValue 0.

### frontierEnvironmentalHitpointDamagePerEffectPerSecond

Raw thermal ship damage dealt per second by each environmental effect after its configured damage delay. Damage uses the normal shield, armor, structure, resistance, notification, persistence, and destruction paths.

Accepted values: Non-negative hitpoint damage per active effect per second. 0 disables ship damage.

Declared bounds: minValue 0.

### frontierEnvironmentalRiftDriftMultiplier

Multiplier applied to nominal maximum temporal drift at the center of a Crude Matter rift.

Accepted values: Positive multiplier.

Declared bounds: minValue 0.

### frontierEnvironmentalRiftRadiusMeters

Surface-distance radius around Crude Matter rifts over which temporal drift is generated.

Accepted values: Positive radius in meters.

Declared bounds: minValue 0.

### frontierEnvironmentalTemporalDriftThresholdRatio

Fraction of a ship's nominal maximum temporal drift that activates the temporal-drift effect and starts its damage-delay timer.

Accepted values: Positive ratio. 1 activates at 100% of nominal maximum; 0.5 activates at 50%.

Declared bounds: minValue 0.

### frontierEnvironmentalVitalityDamagePerEffectPerSecond

Shell vitality removed per second by each environmental effect after its configured damage delay.

Accepted values: Non-negative vitality damage per active effect per second. 0 disables vitality damage.

Declared bounds: minValue 0.

### frontierNetworkNodeScanElectromagneticStrength

Temporary Network Node remote-scanner strength for electromagnetic aggregate signals.

Accepted values: Positive multiplier.

Declared bounds: minValue 0.

### frontierNetworkNodeScanGravimetricStrength

Temporary Network Node remote-scanner strength for gravimetric aggregate signals.

Accepted values: Positive multiplier.

Declared bounds: minValue 0.

### frontierNetworkNodeScanRangeJumps

Maximum configurable remote scanning reach from a Network Node, measured along stargate connections in solar-system hops.

Accepted values: Integer from 0 through 25 stargate hops.

Declared bounds: minValue 0, maxValue 25.

### frontierNetworkNodeScanThermalStrength

Temporary Network Node remote-scanner strength for thermal aggregate signals.

Accepted values: Positive multiplier.

Declared bounds: minValue 0.

### frontierRemoteScanCooldownMs

Minimum delay between new remote scan jobs from the same scanner source.

Accepted values: Non-negative milliseconds.

Declared bounds: minValue 0.

### frontierRemoteScanDeepEnergyCost

Transient Network Node energy headroom required to start a deep survey.

Accepted values: Non-negative energy units.

Declared bounds: minValue 0.

### frontierRemoteScanDeepOctreeDepth

Maximum sparse spatial subdivision depth for deep survey heat maps.

Accepted values: Integer from 1 through 8.

Declared bounds: minValue 1, maxValue 8.

### frontierRemoteScanDeepWarmupEnabled

Allows a deep remote survey to warm a dormant target system without attaching the scanning character.

Accepted values: true or false.

### frontierRemoteScanDeepWarmupTimeoutMs

Hard timeout for target-system loading initiated by a remote survey.

Accepted values: Positive milliseconds.

Declared bounds: minValue 1.

### frontierRemoteScanEnergyHoldMs

Duration that a remote scan reserves its energy cost on the source Network Node power grid. The hold remains for the full duration even when the scan completes or is cancelled.

Accepted values: Positive milliseconds.

Declared bounds: minValue 1.

### frontierRemoteScanIndexTtlMs

Maximum age of a cold per-system contribution-index snapshot before it is rebuilt.

Accepted values: Non-negative milliseconds.

Declared bounds: minValue 0.

### frontierRemoteScanMaxConcurrentWarmups

Maximum number of distinct solar systems that remote scans may load concurrently.

Accepted values: Integer from 1 through 64.

Declared bounds: minValue 1, maxValue 64.

### frontierRemoteScanMaxHeatCells

Maximum sparse occupied heat-map cells serialized in one remote result.

Accepted values: Integer from 1 through 1024.

Declared bounds: minValue 1, maxValue 1024.

### frontierRemoteScanMaxPayloadBytes

Maximum serialized size of one completed remote scan result before weakest observations are removed.

Accepted values: Integer bytes greater than or equal to 4096.

Declared bounds: minValue 4_096.

### frontierRemoteScanMaxResources

Maximum aggregate resource-field observations serialized in one remote result.

Accepted values: Integer from 1 through 512.

Declared bounds: minValue 1, maxValue 512.

### frontierRemoteScanMaxSites

Maximum redacted dungeon-site observations serialized in one remote result.

Accepted values: Integer from 1 through 512.

Declared bounds: minValue 1, maxValue 512.

### frontierRemoteScanResultTtlMs

Durable retention and staleness lifetime for a completed remote scan result.

Accepted values: Positive milliseconds.

Declared bounds: minValue 1.

### frontierRemoteScanSurveyEnergyCost

Transient Network Node energy headroom required to start a cold survey.

Accepted values: Non-negative energy units.

Declared bounds: minValue 0.

### frontierRemoteScanSurveyOctreeDepth

Maximum sparse spatial subdivision depth for cold survey heat maps.

Accepted values: Integer from 1 through 8.

Declared bounds: minValue 1, maxValue 8.

### frontierRemoteScanningEnabled

Enables server-authoritative remote solar-system surveys. Network Nodes are the temporary dApp source; the scan contracts remain source-neutral.

Accepted values: true or false.

### frontierScanningDetectionRangeMeters

Maximum distance at which Frontier directional scanning returns a contact signature. The upper bound is the build-3502403 client scanner's authored 100,000 km limit.

Accepted values: Positive distance in meters up to 100000000.

Declared bounds: minValue 0, maxValue 100_000_000.

### frontierScanningRenderOutOfRangeSignatures

Keeps contacts outside the configured resolution range in the Frontier scan response as unresolved signatures. Disable to omit those contacts instead.

Accepted values: true or false.

### frontierScanningRenderResolvedObjects

Uses Frontier's delayed scan-contact visibility path to add a resolved contact's real ballpark object. Disable to keep every directional-scan contact signature-only.

Accepted values: true or false.

### frontierScanningResolutionRangeMeters

Maximum distance at which a strong Frontier directional-scan contact may resolve into its real ballpark object. Contacts beyond this range can remain visible as unresolved signatures up to the detection range.

Accepted values: Positive distance in meters no greater than frontierScanningDetectionRangeMeters.

Declared bounds: minValue 0, maxValue 100_000_000.

### frontierScanningResolutionSnrThreshold

Signal-to-noise ratio required for a Frontier directional-scan contact to resolve. 1 preserves the client's 100% signal threshold; larger values require a stronger return.

Accepted values: Positive signal-to-noise ratio.

Declared bounds: minValue 0.

### frontierSignatureBloomElectromagneticHalfLifeMs

Default electromagnetic decay half-life for normalized travel signature blooms.

Accepted values: Positive milliseconds.

Declared bounds: minValue 1.

### frontierSignatureBloomGravimetricHalfLifeMs

Default gravimetric decay half-life for normalized travel signature blooms.

Accepted values: Positive milliseconds.

Declared bounds: minValue 1.

### frontierSignatureBloomRetentionMs

Minimum durable retention for a travel signature bloom when the publisher does not provide an expiry.

Accepted values: Positive milliseconds.

Declared bounds: minValue 1.

### frontierSignatureBloomThermalHalfLifeMs

Default thermal decay half-life for normalized travel signature blooms.

Accepted values: Positive milliseconds.

Declared bounds: minValue 1.

### frontierSmartIndustryJobLaneCount

Number of independently occupied production lanes exposed by non-portable Frontier Smart Industry assemblies. Creation-hosted Industry modules and portable Industry assemblies are always limited to lane 1. Each lane accepts at most one running or discontinuing job and has its own owner-managed access policy. Lane 1 remains the legacy client lane.

Accepted values: "Integer lane count from 1 through 16.",     validateValue(value) {       if (!Number.isInteger(value)) {         throw new Error("frontierSmartIndustryJobLaneCount must be a whole number.");       }       return value;     }

Declared bounds: minValue 1, maxValue 16.

### frontierSmartIndustryJobLaneCountByTypeID

Optional per-type lane counts for compatible Frontier Smart Industry facilities. Keys are Smart Industry type IDs and values are lane counts. Missing type IDs fall back to frontierSmartIndustryJobLaneCount. Creation-hosted Industry modules and portable Industry assemblies remain limited to lane 1 even when their type ID is present.

Accepted values: JSON object mapping compatible Smart Industry type IDs to integer lane counts from 1 through 16.

### npcPilotIdentitiesEnabled

Persist faction-keyed NPC pilot identities in Frontier mode, independently of ship lifetimes.

Accepted values: Boolean. Only applies to the Frontier compatibility profile.

### smartAssemblyBaseDappUrl

Base URL advertised as smartAssemblyBaseDappUrl through MachoNet for the in-game Smart Assembly browser. The client appends /client/root/, /client/behaviour/, or /client/networknode/monitor/ and its own query parameters. Restart the game client after changing this value.

Accepted values: 'Absolute HTTP(S) base URL without a query or fragment, for example "http://localhost:5174". Trailing slashes are removed before advertising it.'

### solarSystemSceneIdleUnloadMs

Unloads any loaded solar-system scene after this much time without player activity, regardless of why the scene was loaded. Cooldown changes memory residency only: structures retain their durable operational state, NPC positions are virtualized before dematerialization, and resumed entities receive collision-safe placement. Set to 0 to disable automatic scene unloading.

Accepted values: Non-negative milliseconds; 0 disables automatic unloading.

Declared bounds: minValue 0.

### suiNpcCharacterProvisioningEnabled

Reconcile persistent NPC Characters and PlayerProfiles on the configured Sui Localnet in the background.

Accepted values: Boolean. Requires Frontier mode and NPC pilot identities.
