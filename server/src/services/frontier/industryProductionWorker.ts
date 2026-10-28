const log = require("../../utils/logger");

// Constructing or requiring the worker never starts a timer or reads live data.
// The server explicitly starts it after the item store and services are ready.
function createIndustryProductionWorker(overrides: Record<string, any> = {}) {
  const deps = {
    getAllItems: () => require("../inventory/itemStore").getAllItems(),
    getProduction: facility => require("./industryRuntime").getProduction(facility),
    hasActiveProduction: facility => require("./industryRuntime").hasActiveProduction(facility),
    advanceProduction: (facilityID, options) => require("./industryRuntime").advanceProduction(facilityID, options),
    publishResult: (result, session) => require("./industryNotifications").publishIndustryProductionResult(result, session),
    now: Date.now,
    setInterval,
    clearInterval,
    intervalMs: 250,
    ...overrides,
  };
  const active = new Set<number>();
  let timer = null;
  function track(facility) {
    const facilityID = Number(facility?.itemID);
    if (!Number.isSafeInteger(facilityID) || facilityID <= 0) return;
    const state = deps.getProduction(facility)?.state;
    // Legacy worker unit adapters only override getProduction. Preserve that
    // seam while the live worker scans every configured/persisted lane.
    const hasActive = typeof overrides.hasActiveProduction === "function"
      ? overrides.hasActiveProduction(facility)
      : typeof overrides.getProduction === "function"
        ? state === "RUNNING" || state === "DISCONTINUING"
        : deps.hasActiveProduction(facility);
    if (hasActive) active.add(facilityID);
    else active.delete(facilityID);
  }
  function settle(facilityID, session = null, options: Record<string, any> = {}) {
    const result = deps.advanceProduction(facilityID, { nowMs: deps.now(), ...options });
    if (result?.data?.facility) track(result.data.facility);
    else if (result?.errorMsg === "FACILITY_NOT_FOUND") active.delete(Number(facilityID));
    // Failed catch-up can still contain earlier committed runs to notify.
    try { deps.publishResult(result, session); }
    catch (error) { log.warn(`[industry] Production notification failed: ${error.message}`); }
    return result;
  }
  function tick() {
    const nowMs = deps.now();
    for (const facilityID of active) {
      try {
        const result = settle(facilityID, null, { nowMs });
        if (result?.success === false) log.warn(`[industry] Production advance failed facility=${facilityID}: ${result.errorMsg}`);
      } catch (error) {
        // One bad facility must not prevent the other jobs or later retries.
        log.warn(`[industry] Production advance failed facility=${facilityID}: ${error.message}`);
      }
    }
  }
  function start() {
    if (timer !== null) return;
    for (const facility of Object.values(deps.getAllItems() || {})) track(facility);
    tick();
    timer = deps.setInterval(tick, Math.max(1, Number(deps.intervalMs) || 250));
    timer?.unref?.();
  }
  function stop() {
    if (timer !== null) deps.clearInterval(timer);
    timer = null;
    active.clear();
  }
  return { start, stop, tick, track, settle };
}

const worker = createIndustryProductionWorker();
module.exports = {
  createIndustryProductionWorker,
  startIndustryProductionWorker: worker.start,
  stopIndustryProductionWorker: worker.stop,
  trackIndustryProduction: worker.track,
  settleIndustryProduction: worker.settle,
};
