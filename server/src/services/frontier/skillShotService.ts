"use strict";

/** Macho RPC surface consumed by frontier.skillshot.client.controller. */

const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildObjectEx1,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const skillShotRuntime = require(path.join(__dirname, "./skillShotRuntime"));

const BEGIN_FIRE_ACK_CLASS = "frontier.skillshot.common.BeginFireAck";

function buildPythonDatetimePayload(milliseconds) {
  const date = new Date(Number(milliseconds));
  const normalized = Number.isFinite(date.getTime()) ? date : new Date();
  // The client marshaler accepts datetime.datetime, while its simulated game
  // clock also returns a UTC-naive datetime. Nested timezone/timedelta objects
  // abort BeginHeldBeam reply decoding before the beam session can start.
  return buildObjectEx1("datetime.datetime", [
    normalized.getUTCFullYear(),
    normalized.getUTCMonth() + 1,
    normalized.getUTCDate(),
    normalized.getUTCHours(),
    normalized.getUTCMinutes(),
    normalized.getUTCSeconds(),
    normalized.getUTCMilliseconds() * 1000,
  ]);
}

function buildBeginFireAck(data: Record<string, any> = {}) {
  const firstCycleMs = Number.isFinite(Number(data.tFirstCycleMs))
    ? Number(data.tFirstCycleMs)
    : Date.now();
  const hasRamp = Number.isFinite(Number(data.rampStartedAtMs));
  return buildObjectEx1(BEGIN_FIRE_ACK_CLASS, [
    buildPythonDatetimePayload(firstCycleMs),
    hasRamp ? buildPythonDatetimePayload(data.rampStartedAtMs) : null,
    hasRamp ? Math.trunc(Number(data.rampCurveID) || 0) : null,
    hasRamp ? Number(data.rampDurationMs) || 0 : null,
  ]);
}

function unwrapPositionalArgs(args) {
  const unwrapped = unwrapMarshalValue(args);
  return Array.isArray(unwrapped) ? unwrapped : [];
}

class SkillShotService extends BaseService {
  declare _runtime: any;

  constructor(dependencies: Record<string, any> = {}) {
    super("skillShot");
    this._runtime = dependencies.runtime || skillShotRuntime;
  }

  Handle_BeginFire(args, session) {
    const positional = unwrapPositionalArgs(args);
    const result = this._runtime.beginFire(session, positional[0]);
    return result && result.success === true
      ? buildBeginFireAck(result.data)
      : null;
  }

  Handle_TurretStateUpdate(args, session) {
    const positional = unwrapPositionalArgs(args);
    this._runtime.turretStateUpdate(session, positional[0]);
    return null;
  }

  Handle_EndFire(_args, session) {
    this._runtime.endFire(session);
    return null;
  }

  Handle_BeginHeldBeam(args, session) {
    const positional = unwrapPositionalArgs(args);
    const result = this._runtime.beginHeldBeam(session, positional[0]);
    return result && result.success === true
      ? buildBeginFireAck(result.data)
      : null;
  }

  Handle_HeldBeamAimUpdate(args, session) {
    const positional = unwrapPositionalArgs(args);
    this._runtime.heldBeamAimUpdate(session, positional[0]);
    return null;
  }

  Handle_EndHeldBeam(args, session) {
    const positional = unwrapPositionalArgs(args);
    this._runtime.endHeldBeam(session, positional[0]);
    return null;
  }
}

module.exports = SkillShotService;
module.exports.BEGIN_FIRE_ACK_CLASS = BEGIN_FIRE_ACK_CLASS;
module.exports.buildBeginFireAck = buildBeginFireAck;
module.exports.buildPythonDatetimePayload = buildPythonDatetimePayload;
