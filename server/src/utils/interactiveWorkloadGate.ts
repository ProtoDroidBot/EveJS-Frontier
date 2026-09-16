"use strict";

const DEFAULT_LOGIN_GRACE_MS = 2_000;
const ACTIVE_LOGIN_POLL_MS = 250;

let activeLoginCount = 0;
let loginActivityUntilMs = 0;

function toNonNegativeInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : fallback;
}

function noteLoginActivity(
  graceMs = DEFAULT_LOGIN_GRACE_MS,
  nowMs = Date.now(),
) {
  const normalizedNowMs = toNonNegativeInt(nowMs, Date.now());
  loginActivityUntilMs = Math.max(
    loginActivityUntilMs,
    normalizedNowMs + toNonNegativeInt(graceMs, DEFAULT_LOGIN_GRACE_MS),
  );
  return loginActivityUntilMs;
}

function beginLogin() {
  activeLoginCount += 1;
  noteLoginActivity();
  let ended = false;
  return () => {
    if (ended) {
      return;
    }
    ended = true;
    activeLoginCount = Math.max(0, activeLoginCount - 1);
    noteLoginActivity();
  };
}

function getBackgroundDeferralDelayMs(nowMs = Date.now()) {
  const normalizedNowMs = toNonNegativeInt(nowMs, Date.now());
  if (activeLoginCount > 0) {
    return ACTIVE_LOGIN_POLL_MS;
  }
  return Math.max(0, loginActivityUntilMs - normalizedNowMs);
}

function shouldDeferBackgroundWork(nowMs = Date.now()) {
  return getBackgroundDeferralDelayMs(nowMs) > 0;
}

function getSnapshot(nowMs = Date.now()) {
  return {
    activeLoginCount,
    loginActivityUntilMs,
    backgroundDeferralDelayMs: getBackgroundDeferralDelayMs(nowMs),
  };
}

function resetForTests() {
  activeLoginCount = 0;
  loginActivityUntilMs = 0;
}

module.exports = {
  ACTIVE_LOGIN_POLL_MS,
  DEFAULT_LOGIN_GRACE_MS,
  beginLogin,
  getBackgroundDeferralDelayMs,
  getSnapshot,
  noteLoginActivity,
  shouldDeferBackgroundWork,
  _testing: {
    resetForTests,
  },
};
