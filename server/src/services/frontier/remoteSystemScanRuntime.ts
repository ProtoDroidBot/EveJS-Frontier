"use strict";

/**
 * Scanner-source-neutral remote solar-system survey jobs.
 *
 * Network Nodes are the first caller, but no scan job or result contract is
 * coupled to a Network Node.  A future scanning Smart Assembly or fitted
 * Creation module can provide the same resolved source profile.
 */

const crypto = require("crypto");
const path = require("path");

const TABLE = "remoteSystemScans";
const STATE_VERSION = 1;
const TERMINAL_STATES = new Set(["complete", "cancelled", "failed"]);
const RUNNABLE_STATES = new Set(["queued", "warming", "scanning"]);
const MODES = new Set(["survey", "deep"]);
const LAYERS = new Set(["sites", "resources", "entities"]);
const MAX_JOBS = 2_000;
const MAX_SIGNALS = 20_000;
const activeExecutions = new Map<string, Promise<any>>();
const activeWarmups = new Map<number, Promise<any>>();

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toFinite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  const numeric = Math.trunc(toFinite(value, fallback));
  return Number.isSafeInteger(numeric) ? numeric : fallback;
}

function positiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, toFinite(value, minimum)));
}

function countBand(value) {
  const count = Math.max(0, toInt(value, 0));
  if (count === 0) return "0";
  if (count === 1) return "1";
  if (count <= 4) return "2-4";
  if (count <= 9) return "5-9";
  if (count <= 24) return "10-24";
  return "25+";
}

function sha(value, length = 24) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function emptyState() {
  return { version: STATE_VERSION, nextSequence: 1, jobs: {}, operationKeys: {}, signals: [] };
}

function normalizeState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    version: STATE_VERSION,
    nextSequence: Math.max(1, positiveInt(source.nextSequence, 1)),
    jobs: source.jobs && typeof source.jobs === "object" && !Array.isArray(source.jobs)
      ? clone(source.jobs) : {},
    operationKeys: source.operationKeys && typeof source.operationKeys === "object" &&
      !Array.isArray(source.operationKeys) ? clone(source.operationKeys) : {},
    signals: Array.isArray(source.signals) ? clone(source.signals) : [],
  };
}

function publicJob(job, includeResult = false) {
  if (!job) return null;
  const result: Record<string, any> = {
    scanID: job.scanID,
    state: job.state,
    scannerSourceID: job.scannerSourceID,
    scannerSourceClass: job.scannerSourceClass,
    sourceSystemID: job.sourceSystemID,
    targetSystemID: job.targetSystemID,
    mode: job.mode,
    layers: clone(job.layers),
    rangeJumps: job.rangeJumps,
    routeDistanceJumps: job.routeDistanceJumps,
    startedAtMs: job.startedAtMs,
    updatedAtMs: job.updatedAtMs,
    completedAtMs: job.completedAtMs || null,
    completesAtMs: job.completesAtMs || null,
    cost: clone(job.cost),
    errorMsg: job.errorMsg || null,
  };
  if (includeResult && job.result) result.result = clone(job.result);
  return result;
}

function createRemoteSystemScanRuntime(options: Record<string, any> = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const randomUUID = typeof options.randomUUID === "function"
    ? options.randomUUID : () => crypto.randomUUID().toLowerCase();
  const config = options.config || require(path.join(__dirname, "../../config"));
  const worldData = options.worldData || require(path.join(__dirname, "../../space/worldData"));
  const scanIndex = options.scanIndex || require(path.join(__dirname, "./systemScanIndex"));
  const signatureEvents = options.signatureEvents || require(path.join(__dirname, "./systemSignatureEventRuntime"));
  const repository = options.repository || (() => {
    const { createTableRepository } = require(path.join(
      __dirname, "../../gameStore/tableRepository",
    ));
    return createTableRepository("service:frontier", { strict: true });
  })();

  function readState() {
    repository.ensureTable(TABLE);
    const result = repository.read(TABLE, "/");
    return normalizeState(result && result.success ? result.data : null);
  }

  function pruneState(state) {
    const atMs = now();
    for (const [scanID, job] of Object.entries<any>(state.jobs)) {
      if (!job || !TERMINAL_STATES.has(job.state) || toFinite(job.expiresAtMs, Infinity) > atMs) continue;
      delete state.jobs[scanID];
      if (job.operationScopeKey && state.operationKeys[job.operationScopeKey] === scanID) {
        delete state.operationKeys[job.operationScopeKey];
      }
    }
    const ordered = Object.values<any>(state.jobs)
      .sort((left, right) => toFinite(left.startedAtMs, 0) - toFinite(right.startedAtMs, 0));
    while (ordered.length > MAX_JOBS) {
      const removableIndex = ordered.findIndex((job) => TERMINAL_STATES.has(job.state));
      if (removableIndex < 0) break;
      const [job] = ordered.splice(removableIndex, 1);
      delete state.jobs[job.scanID];
      if (job.operationScopeKey && state.operationKeys[job.operationScopeKey] === job.scanID) {
        delete state.operationKeys[job.operationScopeKey];
      }
    }
  }

  function writeState(state) {
    pruneState(state);
    state.version = STATE_VERSION;
    if (state.signals.length > MAX_SIGNALS) {
      state.signals.splice(0, state.signals.length - MAX_SIGNALS);
    }
    const result = repository.write(TABLE, "/", state);
    return result && result.success;
  }

  function appendSignal(state, job, kind, detail = null) {
    const signal: Record<string, any> = {
      sequence: state.nextSequence++,
      atMs: now(),
      kind,
      scanID: job.scanID,
      state: job.state,
      scannerSourceClass: job.scannerSourceClass,
      sourceSystemID: job.sourceSystemID,
      targetSystemID: job.targetSystemID,
      confidence: job.result && job.result.confidence || null,
    };
    if (detail) signal.detail = clone(detail);
    state.signals.push(signal);
    return signal;
  }

  function updateJob(scanID, updater, signalKind = null, detail = null) {
    const state = readState();
    const job = state.jobs[scanID];
    if (!job) return { success: false as const, errorMsg: "REMOTE_SCAN_NOT_FOUND" };
    const next = updater(job) || job;
    next.updatedAtMs = now();
    state.jobs[scanID] = next;
    if (signalKind) appendSignal(state, next, signalKind, detail);
    return writeState(state)
      ? { success: true as const, data: clone(next) }
      : { success: false as const, errorMsg: "REMOTE_SCAN_PERSIST_FAILED" };
  }

  function configuredMaxRange() {
    return Math.max(0, Math.min(25, toInt(config.frontierNetworkNodeScanRangeJumps, 3)));
  }

  function listReachableSystems(sourceSystemID, maxRangeJumps = configuredMaxRange()) {
    const source = positiveInt(sourceSystemID, 0);
    const maximum = Math.max(0, Math.min(configuredMaxRange(), toInt(maxRangeJumps, configuredMaxRange())));
    if (!source || !worldData.getSolarSystemByID(source)) return [];
    const distance = new Map<number, number>([[source, 0]]);
    const queue = [source];
    while (queue.length > 0) {
      const current = queue.shift();
      const hops = distance.get(current) || 0;
      if (hops >= maximum) continue;
      for (const gate of worldData.getStargatesForSystem(current) || []) {
        const destination = positiveInt(gate && gate.destinationSolarSystemID, 0);
        if (!destination || distance.has(destination) || !worldData.getSolarSystemByID(destination)) continue;
        distance.set(destination, hops + 1);
        queue.push(destination);
      }
    }
    return [...distance.entries()].map(([systemID, hops]) => {
      const record = worldData.getSolarSystemByID(systemID) || {};
      return {
        systemID,
        name: String(record.name || record.solarSystemName || `System ${systemID}`),
        securityStatus: Number.isFinite(Number(record.securityStatus ?? record.security))
          ? Number(record.securityStatus ?? record.security) : null,
        hops,
      };
    }).sort((left, right) => left.hops - right.hops || left.name.localeCompare(right.name) ||
      left.systemID - right.systemID);
  }

  function defaultResolveSource(context) {
    const energyRuntime = require(path.join(__dirname, "./networkNodeEnergyRuntime"));
    const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
    const status = energyRuntime.getNetworkNodeEnergyStatus(
      context.characterID, context.scannerSourceID,
    );
    if (!status || !status.success) return status || {
      success: false as const, errorMsg: "REMOTE_SCAN_SOURCE_UNAVAILABLE",
    };
    if (status.data.online !== true) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_SOURCE_OFFLINE" };
    }
    const item = itemStore.findItemById(context.scannerSourceID);
    const sourceSystemID = positiveInt(item && (item.locationID || item.spaceState && item.spaceState.systemID), 0);
    if (!sourceSystemID) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_SOURCE_UNAVAILABLE" };
    }
    return {
      success: true as const,
      data: {
        scannerSourceID: context.scannerSourceID,
        scannerSourceClass: "network_node",
        sourceSystemID,
        energyAvailable: Math.max(0, toFinite(status.data.energyAvailable, 0)),
        scannerProfileID: "network-node-system-survey-v1",
        scannerStrength: {
          gravimetric: Math.max(0.01, toFinite(config.frontierNetworkNodeScanGravimetricStrength, 1)),
          electromagnetic: Math.max(0.01, toFinite(config.frontierNetworkNodeScanElectromagneticStrength, 1)),
          thermal: Math.max(0.01, toFinite(config.frontierNetworkNodeScanThermalStrength, 1)),
        },
      },
    };
  }
  const resolveSource = typeof options.resolveSource === "function"
    ? options.resolveSource : defaultResolveSource;

  function scanCosts(mode) {
    return {
      energy: Math.max(0, toFinite(mode === "deep"
        ? config.frontierRemoteScanDeepEnergyCost
        : config.frontierRemoteScanSurveyEnergyCost, mode === "deep" ? 75 : 25)),
      committed: true,
    };
  }

  function getNetworkNodeScanConfiguration(characterID, scannerSourceID, actorSession = null,
    requestedRangeJumps = configuredMaxRange()) {
    if (config.frontierRemoteScanningEnabled === false) {
      return { success: false as const, errorMsg: "REMOTE_SCANNING_DISABLED" };
    }
    const source = resolveSource({
      characterID: positiveInt(characterID, 0),
      scannerSourceID: positiveInt(scannerSourceID, 0),
      actorSession,
    });
    if (!source || !source.success) return source;
    const maxRangeJumps = configuredMaxRange();
    const selectedRangeJumps = Math.max(0, Math.min(maxRangeJumps,
      toInt(requestedRangeJumps, maxRangeJumps)));
    return {
      success: true as const,
      data: {
        scannerSourceID: source.data.scannerSourceID,
        scannerSourceClass: source.data.scannerSourceClass,
        scannerProfileID: source.data.scannerProfileID,
        sourceSystemID: source.data.sourceSystemID,
        rangeUnit: "stargate_hops",
        minRangeJumps: 0,
        maxRangeJumps,
        selectedRangeJumps,
        modes: config.frontierRemoteScanDeepWarmupEnabled === false ? ["survey"] : ["survey", "deep"],
        layers: [...LAYERS],
        entityClasses: ["ships", "bases", "transient_travel"],
        actorClassification: "redacted",
        cooldownMs: Math.max(0, toInt(config.frontierRemoteScanCooldownMs, 5_000)),
        costs: { survey: scanCosts("survey"), deep: scanCosts("deep") },
        reachableSystems: listReachableSystems(source.data.sourceSystemID, selectedRangeJumps),
      },
    };
  }

  function normalizeRequest(rawRequest) {
    const operationKey = String(rawRequest && rawRequest.operationKey || "").trim().toLowerCase();
    const targetSystemID = positiveInt(rawRequest && rawRequest.targetSystemID, 0);
    const mode = String(rawRequest && rawRequest.mode || "survey").trim().toLowerCase();
    const maxRangeJumps = configuredMaxRange();
    const rangeJumps = rawRequest && rawRequest.rangeJumps === undefined
      ? maxRangeJumps : toInt(rawRequest && rawRequest.rangeJumps, -1);
    const requestedLayers = rawRequest && rawRequest.layers === undefined
      ? [...LAYERS] : rawRequest.layers;
    const layers = Array.isArray(requestedLayers)
      ? [...new Set(requestedLayers.map((value) => String(value || "").trim().toLowerCase()))]
      : [];
    if (!operationKey || operationKey.length > 128 || !/^[a-z0-9][a-z0-9._:/-]*$/u.test(operationKey)) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_OPERATION_KEY_INVALID" };
    }
    if (!targetSystemID || !worldData.getSolarSystemByID(targetSystemID)) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_SYSTEM_NOT_FOUND" };
    }
    if (!MODES.has(mode)) return { success: false as const, errorMsg: "REMOTE_SCAN_MODE_INVALID" };
    if (mode === "deep" && config.frontierRemoteScanDeepWarmupEnabled === false) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_DEEP_DISABLED" };
    }
    if (rangeJumps < 0 || rangeJumps > maxRangeJumps) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_RANGE_INVALID" };
    }
    if (layers.length === 0 || layers.some((layer) => !LAYERS.has(layer))) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_LAYERS_INVALID" };
    }
    return { success: true as const, data: { operationKey, targetSystemID, mode, rangeJumps, layers } };
  }

  function sourceContext(characterID, scannerSourceID, actorSession) {
    if (config.frontierRemoteScanningEnabled === false) {
      return { success: false as const, errorMsg: "REMOTE_SCANNING_DISABLED" };
    }
    const numericCharacterID = positiveInt(characterID, 0);
    const numericSourceID = positiveInt(scannerSourceID, 0);
    if (!numericCharacterID || !numericSourceID) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_SOURCE_INVALID" };
    }
    return resolveSource({ characterID: numericCharacterID, scannerSourceID: numericSourceID, actorSession });
  }

  function resolutionTier(confidence) {
    if (confidence >= 0.82) return "deep";
    if (confidence >= 0.62) return "identified";
    if (confidence >= 0.38) return "coarse";
    return "trace";
  }

  function channelStrength(contribution, channel) {
    if (contribution.channelIntensity) {
      return Math.max(0, toFinite(contribution.channelIntensity[channel], 0));
    }
    return Math.max(0, toFinite(contribution.baseSignature, 1) *
      toFinite(contribution.channelMultiplier && contribution.channelMultiplier[channel], 1));
  }

  function cellCoordinates(position, extent, depth) {
    const divisions = 2 ** depth;
    const size = (extent * 2) / divisions;
    const coordinate = (value) => Math.max(0, Math.min(divisions - 1,
      Math.floor((clamp(value, -extent, extent) + extent) / size)));
    return {
      x: coordinate(position.x), y: coordinate(position.y), z: coordinate(position.z), size,
    };
  }

  function aggregateHeatMap(snapshot, job, source) {
    const contributions = snapshot.contributions || [];
    const maxCells = Math.max(1, Math.min(1024, toInt(config.frontierRemoteScanMaxHeatCells, 256)));
    const maximumCoordinate = contributions.reduce((maximum, contribution) => Math.max(
      maximum,
      Math.abs(toFinite(contribution.position && contribution.position.x, 0)),
      Math.abs(toFinite(contribution.position && contribution.position.y, 0)),
      Math.abs(toFinite(contribution.position && contribution.position.z, 0)),
    ), 100_000_000);
    const extent = 2 ** Math.ceil(Math.log2(Math.max(1, maximumCoordinate * 1.05)));
    let depth = Math.max(1, Math.min(8, toInt(job.mode === "deep"
      ? config.frontierRemoteScanDeepOctreeDepth
      : config.frontierRemoteScanSurveyOctreeDepth, job.mode === "deep" ? 6 : 4)));
    let grouped: Map<string, any>;
    do {
      grouped = new Map();
      for (const contribution of contributions) {
        const coordinates = cellCoordinates(contribution.position || { x: 0, y: 0, z: 0 }, extent, depth);
        const key = `${coordinates.x}:${coordinates.y}:${coordinates.z}`;
        let cell = grouped.get(key);
        if (!cell) {
          cell = { ...coordinates, key, contributions: [], powers: {
            gravimetric: 0, electromagnetic: 0, thermal: 0,
          }, counts: { ships: 0, bases: 0, transientTravel: 0 } };
          grouped.set(key, cell);
        }
        cell.contributions.push(contribution);
        for (const channel of ["gravimetric", "electromagnetic", "thermal"]) {
          const strength = channelStrength(contribution, channel) *
            Math.max(0.01, toFinite(source.scannerStrength && source.scannerStrength[channel], 1)) *
            clamp(toFinite(contribution.scanAttenuation, 1), 0, 1);
          cell.powers[channel] += strength * strength;
        }
        if (contribution.kind === "ship") cell.counts.ships += 1;
        else if (contribution.kind === "base") cell.counts.bases += 1;
        else if (contribution.kind === "transient_travel") cell.counts.transientTravel += 1;
      }
      if (grouped.size > maxCells) depth -= 1;
    } while (grouped.size > maxCells && depth > 0);

    const attenuation = 1 / (1 + (job.routeDistanceJumps * 0.35));
    const modeStrength = job.mode === "deep" ? 1 : 0.72;
    const cells = [...grouped.values()].map((cell) => {
      const center = {
        x: -extent + ((cell.x + 0.5) * cell.size),
        y: -extent + ((cell.y + 0.5) * cell.size),
        z: -extent + ((cell.z + 0.5) * cell.size),
      };
      const rawChannels = Object.fromEntries(["gravimetric", "electromagnetic", "thermal"]
        .map((channel) => [channel, Math.sqrt(cell.powers[channel]) * attenuation * modeStrength]));
      const channels = Object.fromEntries(Object.entries<any>(rawChannels)
        .map(([channel, value]) => [channel, Number(clamp(
          Math.log1p(value) / Math.log(101), 0, 1,
        ).toFixed(6))]));
      const signal = Math.max(...Object.values<number>(channels));
      const confidence = clamp(signal * modeStrength * attenuation + (job.mode === "deep" ? 0.18 : 0.08), 0.02, 0.99);
      return {
        cellID: sha(`${snapshot.systemID}:${snapshot.revision}:${depth}:${cell.key}`),
        approximateCenter: center,
        uncertaintyRadiusMeters: Math.sqrt(3) * cell.size / 2,
        confidence: Number(confidence.toFixed(6)),
        resolutionTier: resolutionTier(confidence),
        channels,
        entities: {
          ships: countBand(cell.counts.ships),
          bases: countBand(cell.counts.bases),
          transientTravel: countBand(cell.counts.transientTravel),
        },
        observedAtMs: Math.max(...cell.contributions.map((entry) => toFinite(entry.observedAtMs, snapshot.builtAtMs))),
        sourceRevision: snapshot.revision,
        _keys: cell.contributions.map((entry) => entry.contributorKey),
      };
    }).sort((left, right) => right.confidence - left.confidence || left.cellID.localeCompare(right.cellID));
    const byContributor = new Map();
    for (const cell of cells) {
      for (const key of cell._keys) byContributor.set(key, cell);
    }
    return { cells, byContributor, truncated: grouped.size > maxCells };
  }

  function buildResult(snapshot, job, source, warmMetadata: Record<string, any> = {}) {
    const heat = aggregateHeatMap(snapshot, job, source);
    const maxSites = Math.max(1, Math.min(512, toInt(config.frontierRemoteScanMaxSites, 128)));
    const maxResources = Math.max(1, Math.min(512, toInt(config.frontierRemoteScanMaxResources, 128)));
    const siteContributions = snapshot.contributions.filter((entry) => entry.kind === "dungeon");
    const resourceContributions = snapshot.contributions.filter((entry) => entry.kind === "resource_field");
    const observation = (contribution) => {
      const cell = heat.byContributor.get(contribution.contributorKey);
      const confidence = cell ? cell.confidence : 0.02;
      return { cell, confidence, tier: resolutionTier(confidence) };
    };
    const sites = job.layers.includes("sites") ? siteContributions.map((entry) => {
      const resolved = observation(entry);
      const metadata = entry.siteMetadata || {};
      return {
        signatureCode: sha(`site:${entry.contributorKey}`),
        cellID: resolved.cell && resolved.cell.cellID || null,
        approximateCenter: resolved.cell && resolved.cell.approximateCenter || null,
        uncertaintyRadiusMeters: resolved.cell && resolved.cell.uncertaintyRadiusMeters || null,
        confidence: resolved.confidence,
        resolutionTier: resolved.tier,
        family: resolved.tier === "trace" ? "unknown" : metadata.family || "unknown",
        siteKind: ["identified", "deep"].includes(resolved.tier) ? metadata.siteKind || null : null,
        displayType: resolved.tier === "deep" ? metadata.displayType || null : null,
        difficulty: resolved.tier === "deep" ? metadata.difficulty || null : null,
      };
    }).sort((left, right) => right.confidence - left.confidence ||
      left.signatureCode.localeCompare(right.signatureCode)).slice(0, maxSites) : [];
    const resources = job.layers.includes("resources") ? resourceContributions
      .map((entry) => {
        const resolved = observation(entry);
        const summary = entry.resourceSummary || {};
        const revealTypes = ["identified", "deep"].includes(resolved.tier);
        return {
          signatureCode: sha(`resource:${entry.contributorKey}`),
          cellID: resolved.cell && resolved.cell.cellID || null,
          confidence: resolved.confidence,
          resolutionTier: resolved.tier,
          family: resolved.tier === "trace" ? "unknown" : summary.family || "resource",
          potential: {
            typeIDs: revealTypes ? clone(summary.potentialTypeIDs || []) : [],
            originalQuantityBand: summary.originalQuantityBand || "unknown",
            originalMemberCountBand: summary.originalMemberCountBand || "unknown",
          },
          remaining: {
            typeIDs: resolved.tier === "deep" ? clone(summary.remainingTypeIDs || []) : [],
            quantityBand: summary.remainingQuantityBand || "unknown",
            activeMemberCountBand: summary.activeMemberCountBand || "unknown",
            depleted: resolved.tier === "deep" ? summary.depleted === true : null,
          },
          observed: {
            channels: resolved.cell ? clone(resolved.cell.channels) : null,
            asOfMs: entry.observedAtMs,
          },
        };
      }).sort((left, right) => right.confidence - left.confidence ||
        left.signatureCode.localeCompare(right.signatureCode)).slice(0, maxResources) : [];
    const heatMapCells = job.layers.includes("entities")
      ? heat.cells.map((cell) => {
        const copy = { ...cell };
        delete copy._keys;
        return copy;
      }) : [];
    const overallConfidence = heat.cells.length > 0
      ? heat.cells.reduce((sum, cell) => sum + cell.confidence, 0) / heat.cells.length
      : clamp((job.mode === "deep" ? 0.7 : 0.45) /
        (1 + job.routeDistanceJumps * 0.35), 0.02, 0.99);
    const truncatedLayers: string[] = [];
    if (siteContributions.length > maxSites) truncatedLayers.push("sites");
    if (resourceContributions.length > maxResources) truncatedLayers.push("resources");
    if (heat.truncated) truncatedLayers.push("entities");
    const result: Record<string, any> = {
      scanID: job.scanID,
      targetSystemID: job.targetSystemID,
      targetSystemName: String((worldData.getSolarSystemByID(job.targetSystemID) || {}).name ||
        (worldData.getSolarSystemByID(job.targetSystemID) || {}).solarSystemName || `System ${job.targetSystemID}`),
      state: "complete",
      scannerProfileID: source.scannerProfileID,
      startedAtMs: job.startedAtMs,
      completedAtMs: now(),
      asOfMs: snapshot.builtAtMs,
      staleAfterMs: snapshot.builtAtMs + Math.max(1, toInt(config.frontierRemoteScanResultTtlMs, 3_600_000)),
      routeDistanceJumps: job.routeDistanceJumps,
      confidence: Number(overallConfidence.toFixed(6)),
      actorClassification: "redacted",
      entityClasses: ["ships", "bases", "transient_travel"],
      warmedByScan: warmMetadata.warmedByScan === true,
      worldRevisionBefore: warmMetadata.worldRevisionBefore ?? snapshot.revision,
      worldRevisionAfter: warmMetadata.worldRevisionAfter ?? snapshot.revision,
      sites,
      resources,
      heatMapCells,
      sourceRevisions: {
        sites: toInt(snapshot.revisions && snapshot.revisions.dungeon, 0) >>> 0,
        resources: toInt(snapshot.revisions && snapshot.revisions.mining, 0) >>> 0,
        entities: (
          (toInt(snapshot.revisions && snapshot.revisions.inventory, 0) >>> 0) ^
          (toInt(snapshot.revisions && snapshot.revisions.structure, 0) >>> 0) ^
          (toInt(snapshot.revisions && snapshot.revisions.npc, 0) >>> 0) ^
          (toInt(snapshot.revisions && snapshot.revisions.live, 0) >>> 0)
        ) >>> 0,
        transientTravel: toInt(snapshot.revisions && snapshot.revisions.transient, 0) >>> 0,
      },
      incompleteLayers: clone(warmMetadata.incompleteLayers || []),
      truncated: truncatedLayers.length > 0,
      truncatedLayers,
    };
    const maxPayloadBytes = Math.max(4_096, toInt(
      config.frontierRemoteScanMaxPayloadBytes, 524_288,
    ));
    const markPayloadTruncated = (layer) => {
      if (!result.truncatedLayers.includes(layer)) result.truncatedLayers.push(layer);
      result.truncated = true;
    };
    while (Buffer.byteLength(JSON.stringify(result), "utf8") > maxPayloadBytes) {
      const candidates = [
        ["entities", result.heatMapCells],
        ["resources", result.resources],
        ["sites", result.sites],
      ].filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
        .sort((left, right) => right[1].length - left[1].length);
      if (candidates.length === 0) break;
      const [layer, rows] = candidates[0];
      rows.pop();
      markPayloadTruncated(layer);
    }
    return result;
  }

  async function warmSystem(systemID) {
    if (typeof options.warmSystem === "function") return options.warmSystem(systemID);
    const runtime = require(path.join(__dirname, "../../space/runtime"));
    return runtime.ensureSceneReady(systemID, {
      purpose: "remote-scan",
      remoteScan: true,
      attachSession: false,
    });
  }

  function sharedWarmup(systemID) {
    if (activeWarmups.has(systemID)) return activeWarmups.get(systemID);
    const maxConcurrentWarmups = Math.max(1, Math.min(64, toInt(
      config.frontierRemoteScanMaxConcurrentWarmups, 4,
    )));
    if (activeWarmups.size >= maxConcurrentWarmups) {
      return Promise.reject(Object.assign(
        new Error("remote scan warm-up capacity is busy"),
        { code: "REMOTE_SCAN_WARMUP_BUSY" },
      ));
    }
    const timeoutMs = Math.max(1, toInt(config.frontierRemoteScanDeepWarmupTimeoutMs, 15_000));
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const promise = Promise.race([
      Promise.resolve().then(() => warmSystem(systemID)),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(Object.assign(
          new Error("remote scan warm-up timed out"), { code: "REMOTE_SCAN_WARMUP_TIMEOUT" },
        )), timeoutMs);
      }),
    ]).finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      activeWarmups.delete(systemID);
    });
    activeWarmups.set(systemID, promise);
    return promise;
  }

  async function executeScan(scanID) {
    if (activeExecutions.has(scanID)) return activeExecutions.get(scanID);
    const execution = (async () => {
      let state = readState();
      let job = state.jobs[scanID];
      if (!job || TERMINAL_STATES.has(job.state)) return job ? publicJob(job) : null;
      job.state = job.mode === "deep" ? "warming" : "scanning";
      job.updatedAtMs = now();
      appendSignal(state, job, job.mode === "deep" ? "remote_scan.warming" : "remote_scan.started");
      if (!writeState(state)) throw Object.assign(new Error("persist failed"), { code: "REMOTE_SCAN_PERSIST_FAILED" });
      try {
        const source = resolveSource({
          characterID: job.actorCharacterID,
          scannerSourceID: job.scannerSourceID,
          actorSession: job.actorSessionSnapshot,
        });
        if (!source || !source.success) throw Object.assign(new Error("source unavailable"), {
          code: source && source.errorMsg || "REMOTE_SCAN_SOURCE_UNAVAILABLE",
        });
        const before = scanIndex.getSystemScanSnapshot(job.targetSystemID, {
          actorSession: job.actorSessionSnapshot,
        });
        if (!before.success) throw Object.assign(new Error("index unavailable"), { code: before.errorMsg });
        let scene = null;
        let warmedByScan = false;
        if (job.mode === "deep") {
          scene = await sharedWarmup(job.targetSystemID);
          if (!scene) throw Object.assign(new Error("warm-up unavailable"), { code: "REMOTE_SCAN_WARMUP_FAILED" });
          warmedByScan = true;
          const latest = readState().jobs[scanID];
          if (!latest || latest.cancelRequested === true) {
            updateJob(scanID, (entry) => ({ ...entry, state: "cancelled", completedAtMs: now(),
              cost: { ...entry.cost, committed: false } }), "remote_scan.cancelled");
            return publicJob(readState().jobs[scanID]);
          }
          updateJob(scanID, (entry) => ({ ...entry, state: "scanning" }), "remote_scan.started");
        }
        const after = scanIndex.getSystemScanSnapshot(job.targetSystemID, {
          actorSession: job.actorSessionSnapshot,
          forceRebuild: true,
          liveScene: scene,
        });
        if (!after.success) throw Object.assign(new Error("index unavailable"), { code: after.errorMsg });
        state = readState();
        job = state.jobs[scanID];
        if (!job || job.cancelRequested === true) {
          if (job) {
            job.state = "cancelled";
            job.completedAtMs = now();
            job.cost.committed = false;
            appendSignal(state, job, "remote_scan.cancelled");
            writeState(state);
          }
          return job ? publicJob(job) : null;
        }
        const result = buildResult(after.data, job, source.data, {
          warmedByScan,
          worldRevisionBefore: before.data.revision,
          worldRevisionAfter: after.data.revision,
          incompleteLayers: [],
        });
        job.state = "complete";
        job.result = result;
        job.completedAtMs = result.completedAtMs;
        job.updatedAtMs = result.completedAtMs;
        job.expiresAtMs = result.staleAfterMs;
        appendSignal(state, job, "remote_scan.completed", {
          resultSize: Buffer.byteLength(JSON.stringify(result), "utf8"),
          truncated: result.truncated,
        });
        writeState(state);
        for (const contribution of after.data.contributions.filter((entry) =>
          entry.kind === "transient_travel" && entry.bloomMetadata && entry.bloomMetadata.observationID)) {
          const cell = aggregateHeatMap({ ...after.data, contributions: [contribution] }, job, source.data).cells[0];
          if (cell && cell.confidence >= 0.38) {
            signatureEvents.recordSignatureBloomDetected(contribution.bloomMetadata.observationID, {
              confidence: cell.confidence,
              scannerSourceClass: job.scannerSourceClass,
            });
          }
        }
        return publicJob(job);
      } catch (error) {
        const code = String(error && error.code || "REMOTE_SCAN_FAILED");
        updateJob(scanID, (entry) => ({
          ...entry,
          state: "failed",
          errorMsg: /^REMOTE_SCAN_[A-Z0-9_]+$/u.test(code) ? code : "REMOTE_SCAN_FAILED",
          completedAtMs: now(),
          cost: { ...entry.cost, committed: false },
          expiresAtMs: now() + Math.max(1, toInt(config.frontierRemoteScanResultTtlMs, 3_600_000)),
        }), "remote_scan.failed", { errorCode: code });
        return publicJob(readState().jobs[scanID]);
      }
    })().finally(() => activeExecutions.delete(scanID));
    activeExecutions.set(scanID, execution);
    return execution;
  }

  function startRemoteSystemScan(characterID, scannerSourceID, rawRequest,
    actorSession: Record<string, any> | null = null) {
    const request = normalizeRequest(rawRequest);
    if (!request.success) return request;
    const source = sourceContext(characterID, scannerSourceID, actorSession);
    if (!source || !source.success) return source;
    const operationScopeKey = `${positiveInt(characterID)}:${source.data.scannerSourceID}:${request.data.operationKey}`;
    let state = readState();
    pruneState(state);
    const existingID = state.operationKeys[operationScopeKey];
    if (existingID && state.jobs[existingID]) {
      const existing = state.jobs[existingID];
      if (RUNNABLE_STATES.has(existing.state)) queueMicrotask(() => executeScan(existing.scanID));
      return { success: true as const, created: false, data: publicJob(existing) };
    }
    const reachable = listReachableSystems(source.data.sourceSystemID, request.data.rangeJumps);
    const target = reachable.find((entry) => entry.systemID === request.data.targetSystemID);
    if (!target) return { success: false as const, errorMsg: "REMOTE_SCAN_OUT_OF_RANGE" };
    const cost = scanCosts(request.data.mode);
    const outstandingCost = Object.values<any>(state.jobs)
      .filter((job) => job.scannerSourceID === source.data.scannerSourceID &&
        RUNNABLE_STATES.has(job.state) && job.cost && job.cost.committed !== false)
      .reduce((sum, job) => sum + Math.max(0, toFinite(job.cost.energy, 0)), 0);
    if (cost.energy + outstandingCost > toFinite(source.data.energyAvailable, 0)) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_INSUFFICIENT_ENERGY" };
    }
    const cooldownMs = Math.max(0, toInt(config.frontierRemoteScanCooldownMs, 5_000));
    const latest = Object.values<any>(state.jobs)
      .filter((job) => job.scannerSourceID === source.data.scannerSourceID &&
        job.state !== "cancelled" && job.state !== "failed")
      .sort((left, right) => toFinite(right.startedAtMs, 0) - toFinite(left.startedAtMs, 0))[0];
    if (latest && latest.startedAtMs + cooldownMs > now()) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_COOLDOWN", params: {
        retryAfterMs: latest.startedAtMs + cooldownMs - now(),
      } };
    }
    const scanID = String(randomUUID()).trim().toLowerCase();
    if (!scanID) return { success: false as const, errorMsg: "REMOTE_SCAN_FAILED" };
    const startedAtMs = now();
    const job = {
      scanID,
      operationScopeKey,
      operationKey: request.data.operationKey,
      actorCharacterID: positiveInt(characterID),
      actorSessionSnapshot: {
        characterID: positiveInt(characterID),
        corporationID: positiveInt(actorSession && (actorSession.corporationID || actorSession.corpid), 0) || null,
      },
      scannerSourceID: source.data.scannerSourceID,
      scannerSourceClass: source.data.scannerSourceClass,
      scannerProfileID: source.data.scannerProfileID,
      sourceSystemID: source.data.sourceSystemID,
      targetSystemID: request.data.targetSystemID,
      mode: request.data.mode,
      layers: request.data.layers,
      rangeJumps: request.data.rangeJumps,
      routeDistanceJumps: target.hops,
      state: "queued",
      startedAtMs,
      updatedAtMs: startedAtMs,
      completesAtMs: null,
      completedAtMs: null,
      expiresAtMs: startedAtMs + Math.max(1, toInt(config.frontierRemoteScanResultTtlMs, 3_600_000)),
      cost,
      cancelRequested: false,
      errorMsg: null,
      result: null,
    };
    state.jobs[scanID] = job;
    state.operationKeys[operationScopeKey] = scanID;
    appendSignal(state, job, "remote_scan.requested");
    appendSignal(state, job, "remote_scan.queued");
    if (!writeState(state)) return { success: false as const, errorMsg: "REMOTE_SCAN_PERSIST_FAILED" };
    queueMicrotask(() => executeScan(scanID));
    return { success: true as const, created: true, data: publicJob(job) };
  }

  function ownedJob(characterID, scannerSourceID, scanID, actorSession) {
    const source = sourceContext(characterID, scannerSourceID, actorSession);
    if (!source || !source.success) return source;
    const state = readState();
    const normalizedScanID = String(scanID || "").trim().toLowerCase();
    const job = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      .test(normalizedScanID) && Object.hasOwn(state.jobs, normalizedScanID)
      ? state.jobs[normalizedScanID] : null;
    if (!job || job.actorCharacterID !== positiveInt(characterID) ||
        job.scannerSourceID !== source.data.scannerSourceID) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_NOT_FOUND" };
    }
    return { success: true as const, state, job };
  }

  function getRemoteSystemScan(characterID, scannerSourceID, scanID, actorSession = null) {
    const owned = ownedJob(characterID, scannerSourceID, scanID, actorSession);
    if (!owned.success) return owned;
    if (RUNNABLE_STATES.has(owned.job.state)) queueMicrotask(() => executeScan(owned.job.scanID));
    return { success: true as const, data: publicJob(owned.job) };
  }

  function getRemoteSystemScanResult(characterID, scannerSourceID, scanID, actorSession = null) {
    const owned = ownedJob(characterID, scannerSourceID, scanID, actorSession);
    if (!owned.success) return owned;
    if (RUNNABLE_STATES.has(owned.job.state)) {
      queueMicrotask(() => executeScan(owned.job.scanID));
      return { success: false as const, errorMsg: "REMOTE_SCAN_NOT_READY" };
    }
    if (owned.job.state === "failed") {
      return { success: false as const, errorMsg: owned.job.errorMsg || "REMOTE_SCAN_FAILED" };
    }
    if (owned.job.state !== "complete" || !owned.job.result) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_NOT_READY" };
    }
    return { success: true as const, data: clone(owned.job.result) };
  }

  function cancelRemoteSystemScan(characterID, scannerSourceID, scanID, actorSession = null) {
    const owned = ownedJob(characterID, scannerSourceID, scanID, actorSession);
    if (!owned.success) return owned;
    if (TERMINAL_STATES.has(owned.job.state)) {
      return owned.job.state === "cancelled"
        ? { success: true as const, changed: false, data: publicJob(owned.job) }
        : { success: false as const, errorMsg: "REMOTE_SCAN_ALREADY_COMPLETE" };
    }
    owned.job.cancelRequested = true;
    if (owned.job.state === "queued") {
      owned.job.state = "cancelled";
      owned.job.completedAtMs = now();
      owned.job.cost.committed = false;
      appendSignal(owned.state, owned.job, "remote_scan.cancelled");
    }
    owned.job.updatedAtMs = now();
    return writeState(owned.state)
      ? { success: true as const, changed: true, data: publicJob(owned.job) }
      : { success: false as const, errorMsg: "REMOTE_SCAN_PERSIST_FAILED" };
  }

  function listSignals(options: Record<string, any> = {}) {
    const afterSequence = Math.max(0, toInt(options.afterSequence, 0));
    const limit = Math.max(1, Math.min(500, toInt(options.limit, 100)));
    return readState().signals.filter((signal) => signal.sequence > afterSequence).slice(0, limit);
  }

  return {
    getNetworkNodeScanConfiguration,
    listReachableSystems,
    startRemoteSystemScan,
    getRemoteSystemScan,
    getRemoteSystemScanResult,
    cancelRemoteSystemScan,
    executeScan,
    listSignals,
    _testing: { readState, writeState, buildResult, aggregateHeatMap, normalizeRequest, sourceContext },
  };
}

const singleton = createRemoteSystemScanRuntime();

module.exports = {
  TABLE,
  createRemoteSystemScanRuntime,
  ...singleton,
};
