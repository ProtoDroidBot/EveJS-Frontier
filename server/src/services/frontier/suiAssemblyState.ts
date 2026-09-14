import { randomUUID } from "node:crypto";

export type SuiAssemblyStateRunner = <T>(assemblyID: number, operation: () => T) => Promise<T>;
export type SuiAssemblyStatesRunner = <T>(assemblyIDs: readonly number[], operation: () => T) => Promise<T>;
let runner: SuiAssemblyStateRunner | null = null;
let statesRunner: SuiAssemblyStatesRunner | null = null;

export function isSuiAssemblyStateAuthoritative(): boolean { return runner !== null; }

/** The worker registers before starting, so requests fail closed during startup. */
export function registerSuiAssemblyStateRunner(value: SuiAssemblyStateRunner) {
  runner = value;
  statesRunner = null;
  return () => { if (runner === value) { runner = null; statesRunner = null; } };
}

/** Single and multi-assembly requests must share one worker queue entry. */
export function registerSuiAssemblyStatesRunner(value: SuiAssemblyStatesRunner) {
  const single: SuiAssemblyStateRunner = (assemblyID, operation) => value([assemblyID], operation);
  runner = single;
  statesRunner = value;
  return () => { if (runner === single) { runner = null; statesRunner = null; } };
}

export function runWithSuiAssemblyState<T>(assemblyID: number, operation: () => T): T | Promise<T> {
  const current = runner;
  if (!current) return operation();
  if (!Number.isSafeInteger(assemblyID) || assemblyID <= 0) {
    return Promise.reject(Object.assign(new Error("Invalid assembly identity"), { code: "ASSEMBLY_STATE_UNAVAILABLE" }));
  }
  return current(assemblyID, () => {
    if (runner !== current) throw Object.assign(new Error("Assembly state worker changed"), { code: "ASSEMBLY_STATE_UNAVAILABLE" });
    return operation();
  });
}

/** Refresh all participating objects before a synchronous, atomic local commit. */
export function runWithSuiAssemblyStates<T>(assemblyIDs: readonly number[], operation: () => T): T | Promise<T> {
  const current = runner;
  if (!current) return operation();
  if (!Array.isArray(assemblyIDs) || assemblyIDs.length === 0 ||
      !assemblyIDs.every(id => Number.isSafeInteger(id) && id > 0)) {
    return Promise.reject(Object.assign(new Error("Invalid assembly identities"), { code: "ASSEMBLY_STATE_UNAVAILABLE" }));
  }
  const ids = [...new Set(assemblyIDs)];
  const batch = statesRunner;
  if (!batch) {
    // Nesting legacy single-object runners deadlocks their shared worker queue.
    if (ids.length === 1) return runWithSuiAssemblyState(ids[0], operation);
    return Promise.reject(Object.assign(new Error("Assembly batch state worker is unavailable"), { code: "ASSEMBLY_STATE_UNAVAILABLE" }));
  }
  return batch(ids, () => {
    if (runner !== current || statesRunner !== batch) {
      throw Object.assign(new Error("Assembly state worker changed"), { code: "ASSEMBLY_STATE_UNAVAILABLE" });
    }
    return operation();
  });
}

/** Persist explicit local lifecycle requests separately from observed chain state. */
export function recordSuiAssemblyStatusIntent(info: any, targetStatus: number): void {
  if (runner && [1, 2].includes(targetStatus)) {
    info.evejsSuiAssemblyStatusIntent = { id: randomUUID(), targetStatus };
  }
}

export function readSuiAssemblyStatusIntent(item: any): { id: string; targetStatus: 1 | 2 } | null {
  let info = item?.customInfo;
  try { if (typeof info === "string") info = JSON.parse(info); }
  catch { return null; }
  const intent = info?.evejsSuiAssemblyStatusIntent;
  return intent && typeof intent.id === "string" && [1, 2].includes(intent.targetStatus) ? intent : null;
}
