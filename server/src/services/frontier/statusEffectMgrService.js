"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const BaseService = require("../baseService");
const { buildDict, unwrapMarshalValue, } = require("../_shared/serviceHelpers");
const environmentalEffects = require("./environmentalEffectsService");
// Build 3474408 accepted-shape evidence:
//
// * frontier/status_effect/client/service.pyc forwards get_effect_config as a
//   keyword call and returns the result unchanged.
// * frontier/hud/heat/integration.pyc treats the result as a mapping and reads
//   raiment_type_id / raiment_nominal_max_bonus with `or 0` / `or 0.0`.
// * frontier/hud/status_effects/insider.pyc seeds its per-effect mapping with
//   exact `.get` fallbacks: three 0.0 grace values, two 1.0 trait intervals,
//   false for has_medical_traits, and an empty severity_curve mapping.
//
// Those observations prove fields and client-accepted fallback values; they do
// not reveal CCP's production server payload.  EveJS locally chooses to return
// their union as a complete neutral client-side policy. Environmental status
// progression is server-authoritative; raiment bonuses remain unavailable. An
// empty mapping would satisfy the normal heat consumer, but would needlessly
// omit fields other client tooling directly indexes.
const LOCAL_NEUTRAL_STATUS_EFFECT_CONFIG_ENTRIES = Object.freeze([
    Object.freeze(["grace_increment", 0.0]),
    Object.freeze(["grace_decrement", 0.0]),
    Object.freeze(["grace_severity_bonus", 0.0]),
    Object.freeze(["trait_interval_low", 1.0]),
    Object.freeze(["trait_interval_high", 1.0]),
    Object.freeze(["has_medical_traits", false]),
    Object.freeze(["severity_curve", null]),
    Object.freeze(["raiment_type_id", 0]),
    Object.freeze(["raiment_nominal_max_bonus", 0.0]),
]);
function buildNeutralStatusEffectConfig() {
    return buildDict(LOCAL_NEUTRAL_STATUS_EFFECT_CONFIG_ENTRIES.map(([key, value]) => [
        key,
        key === "severity_curve" ? buildDict([]) : value,
    ]));
}
function getSessionCharacterID(session) {
    return Number(session && (session.characterID || session.charid)) || 0;
}
function extractEffectKey(args, kwargs) {
    const unwrappedKwargs = unwrapMarshalValue(kwargs);
    const unwrappedArgs = unwrapMarshalValue(args);
    const rawKey = unwrappedKwargs && typeof unwrappedKwargs === "object"
        ? unwrappedKwargs.effect_key ?? unwrappedKwargs.effectKey
        : Array.isArray(unwrappedArgs)
            ? unwrappedArgs[0]
            : unwrappedArgs;
    return environmentalEffects.normalizeStatusEffectKey(rawKey);
}
function getEffectState(args, session, kwargs) {
    const characterID = getSessionCharacterID(session);
    const effectKey = extractEffectKey(args, kwargs);
    if (characterID <= 0 || !effectKey) {
        return null;
    }
    const state = environmentalEffects.snapshotCharacterState(characterID);
    return state && state.effects ? state.effects[effectKey] || null : null;
}
class StatusEffectMgrService extends BaseService {
    constructor() {
        super("statusEffectMgr");
    }
    Handle_get_grace_state(args, session, kwargs) {
        const effect = getEffectState(args, session, kwargs);
        return effect ? [effect.grace, effect.active] : [0.0, false];
    }
    Handle_get_grace_counter(args, session, kwargs) {
        const effect = getEffectState(args, session, kwargs);
        return effect ? effect.grace : 0.0;
    }
    Handle_get_effect_config() {
        return buildNeutralStatusEffectConfig();
    }
}
module.exports = StatusEffectMgrService;
module.exports._testing = {
    LOCAL_NEUTRAL_STATUS_EFFECT_CONFIG_ENTRIES,
    buildNeutralStatusEffectConfig,
    extractEffectKey,
};
//# sourceMappingURL=statusEffectMgrService.js.map