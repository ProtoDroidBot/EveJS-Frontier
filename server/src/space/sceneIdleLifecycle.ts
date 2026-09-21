"use strict";

/**
 * Scene residency bookkeeping is intentionally independent from the reason a
 * scene was loaded.  A player entering the system refreshes the activity
 * clock; remote scans, startup preloading, and background consumers do not.
 */

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getSessionCount(scene) {
  return scene && scene.sessions instanceof Map ? scene.sessions.size : 0;
}

function initializeSceneIdleLifecycle(scene, nowMs = Date.now()) {
  if (!scene || typeof scene !== "object") return null;
  const normalizedNowMs = toFiniteNumber(nowMs, Date.now());
  if (!(toFiniteNumber(scene._loadedAtWallclockMs, 0) > 0)) {
    scene._loadedAtWallclockMs = normalizedNowMs;
  }
  if (!(toFiniteNumber(scene._lastPlayerActivityAtMs, 0) > 0)) {
    scene._lastPlayerActivityAtMs = scene._loadedAtWallclockMs;
  }
  return getSceneIdleLifecycleState(scene, normalizedNowMs, 0);
}

function recordScenePlayerActivity(scene, nowMs = Date.now()) {
  if (!scene || typeof scene !== "object") return null;
  const normalizedNowMs = toFiniteNumber(nowMs, Date.now());
  initializeSceneIdleLifecycle(scene, normalizedNowMs);
  scene._lastPlayerActivityAtMs = Math.max(
    toFiniteNumber(scene._lastPlayerActivityAtMs, normalizedNowMs),
    normalizedNowMs,
  );
  return getSceneIdleLifecycleState(scene, normalizedNowMs, 0);
}

function getSceneIdleLifecycleState(scene, nowMs = Date.now(), idleUnloadMs = 0) {
  if (!scene || typeof scene !== "object") {
    return {
      loaded: false,
      sessionCount: 0,
      hasPlayerSessions: false,
      enabled: false,
      eligible: false,
      reason: "scene-missing",
      idleForMs: 0,
      idleUnloadMs: Math.max(0, toFiniteNumber(idleUnloadMs, 0)),
    };
  }

  const normalizedNowMs = toFiniteNumber(nowMs, Date.now());
  const timeoutMs = Math.max(0, toFiniteNumber(idleUnloadMs, 0));
  const loadedAtMs = toFiniteNumber(scene._loadedAtWallclockMs, normalizedNowMs);
  const lastPlayerActivityAtMs = Math.max(
    loadedAtMs,
    toFiniteNumber(scene._lastPlayerActivityAtMs, loadedAtMs),
  );
  const sessionCount = getSessionCount(scene);
  const idleForMs = Math.max(0, normalizedNowMs - lastPlayerActivityAtMs);
  let reason = "idle-timeout-pending";
  let eligible = timeoutMs > 0 && sessionCount === 0 && idleForMs >= timeoutMs;

  if (timeoutMs <= 0) reason = "idle-unload-disabled";
  else if (sessionCount > 0) reason = "player-sessions-present";
  else if (eligible) reason = "idle-timeout-expired";

  return {
    loaded: true,
    loadedAtMs,
    lastPlayerActivityAtMs,
    sessionCount,
    hasPlayerSessions: sessionCount > 0,
    enabled: timeoutMs > 0,
    eligible,
    reason,
    idleForMs,
    idleUnloadMs: timeoutMs,
  };
}

module.exports = {
  initializeSceneIdleLifecycle,
  recordScenePlayerActivity,
  getSceneIdleLifecycleState,
};
