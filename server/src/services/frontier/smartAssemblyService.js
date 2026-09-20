"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const BaseService = require("../baseService");
const { buildDict, buildList } = require("../_shared/serviceHelpers");
const { throwWrappedUserError } = require("../../common/machoErrors");
const log = require("../../utils/logger");
const crypto = require("crypto");
const ASSEMBLY_STATUS_OFFLINE = 1;
const ASSEMBLY_STATUS_ONLINE = 2;
const ERROR_MESSAGES = Object.freeze({
    ASSEMBLY_ACTIVATING: "Wait for this assembly's anchoring or onlining timer to finish.",
    NETWORK_NODE_CONNECTION_REQUIRED: "Connect this assembly to a Network Node within 80 km before bringing it online.",
    NETWORK_NODE_OFFLINE: "The connected Network Node must be online and fueled.",
    NETWORK_NODE_ENERGY_EXCEEDED: "The Network Node does not have enough available energy for this assembly.",
    NETWORK_NODE_FUEL_REQUIRED: "Deposit fuel in this Network Node before bringing it online.",
    NETWORK_NODE_ENERGY_CONFIG_UNAVAILABLE: "Energy requirements are still synchronizing. Try again shortly.",
    NETWORK_NODE_ENERGY_STATE_UNAVAILABLE: "The Network Node's energy usage is still synchronizing. Try again shortly.",
    ASSEMBLY_ACCESS_DENIED: "You do not own this assembly.",
    ASSEMBLY_ACCESS_CAPABILITY_AMPLIFIED: "A delegated grant cannot exceed the capabilities that were requested.",
    ASSEMBLY_ACCESS_CAPABILITY_INVALID: "The requested assembly capability is invalid or unsupported.",
    ASSEMBLY_ACCESS_CHAIN_PROOF_CONFLICT: "That smart-assembly access grant has a conflicting chain confirmation.",
    ASSEMBLY_ACCESS_CHAIN_PROOF_INVALID: "The smart-assembly access grant was not confirmed by the deployed Sui world.",
    ASSEMBLY_ACCESS_CHAIN_UNAVAILABLE: "The deployed Sui world is not available to confirm this access grant.",
    ASSEMBLY_ACCESS_DELEGATION_INVALID: "The requested assembly-access delegation exceeds its parent grant.",
    ASSEMBLY_ACCESS_GRANT_EXPIRY_INVALID: "The requested assembly-access expiry is invalid.",
    ASSEMBLY_ACCESS_GRANT_ID_CONFLICT: "That assembly-access grant ID is already used for different access.",
    ASSEMBLY_ACCESS_GRANT_ID_INVALID: "The assembly-access grant ID is invalid.",
    ASSEMBLY_ACCESS_GRANT_NOT_ACTIVE: "That assembly-access grant is no longer active.",
    ASSEMBLY_ACCESS_GRANT_NOT_FOUND: "That assembly-access grant no longer exists.",
    ASSEMBLY_ACCESS_IDEMPOTENCY_CONFLICT: "That idempotency key is already bound to different assembly access.",
    ASSEMBLY_ACCESS_IDEMPOTENCY_INVALID: "A valid idempotency key is required.",
    ASSEMBLY_ACCESS_MANAGE_DENIED: "You cannot manage access to this assembly.",
    ASSEMBLY_ACCESS_OWNER_IMPLICIT: "The assembly owner already has full access.",
    ASSEMBLY_ACCESS_PERSIST_FAILED: "The assembly-access policy could not be saved.",
    ASSEMBLY_ACCESS_RECIPIENT_INVALID: "The assembly-access recipient is invalid.",
    ASSEMBLY_ACCESS_REQUEST_CANCEL_DENIED: "Only the requester can withdraw this access request.",
    ASSEMBLY_ACCESS_REQUEST_EXPIRY_INVALID: "The requested access-request expiry is invalid.",
    ASSEMBLY_ACCESS_REQUEST_ID_CONFLICT: "That access-request ID is already in use.",
    ASSEMBLY_ACCESS_REQUEST_ID_INVALID: "The access-request ID is invalid.",
    ASSEMBLY_ACCESS_REQUEST_NOT_FOUND: "That assembly-access request no longer exists.",
    ASSEMBLY_ACCESS_REQUEST_NOT_PENDING: "That assembly-access request has already been decided.",
    ASSEMBLY_ACCESS_REVOKE_DENIED: "You cannot revoke that assembly-access grant.",
    ASSEMBLY_ACCESS_SUBJECT_INVALID: "The requesting assembly-access identity is invalid.",
    ASSEMBLY_ACCESS_SUBJECT_NOT_FOUND: "The requesting assembly-access identity no longer exists.",
    ASSEMBLY_ACCESS_SUBJECT_STALE: "The NPC assembly-access identity belongs to an earlier incarnation.",
    ASSEMBLY_CUSTODY_CAPACITY_EXCEEDED: "The destination assembly does not have enough shared-storage capacity.",
    ASSEMBLY_CUSTODY_CHAIN_PROOF_INVALID: "The Sui custody transaction was not confirmed for this exact transfer.",
    ASSEMBLY_CUSTODY_CHAIN_REQUIRED: "Cross-owner custody is available only on Sui-backed Smart Assemblies.",
    ASSEMBLY_CUSTODY_ITEM_INVALID: "Only a valid stackable item can cross this custody boundary.",
    ASSEMBLY_CUSTODY_REQUEST_INVALID: "The cross-owner custody request is invalid.",
    ASSEMBLY_CUSTODY_SOURCE_CHANGED: "The source item changed while the Sui transaction was confirming.",
    ASSEMBLY_CUSTODY_SOURCE_MISMATCH: "The item is not in the authorized source inventory.",
    ASSEMBLY_CUSTODY_STORAGE_ONLY: "Cross-owner custody currently requires a Smart Storage Unit.",
    CUSTODY_IDEMPOTENCY_CONFLICT: "That custody operation ID is already bound to another transfer.",
    INVALID_CUSTODY_RECEIPT: "The custody operation receipt is invalid.",
    PERSISTENCE_FLUSH_ERROR: "The custody transfer could not be durably committed.",
    ASSEMBLY_GUI_SESSION_BINDING_REQUIRED: "The assembly GUI session could not be bound securely.",
    ASSEMBLY_GUI_SESSION_EXPIRY_INVALID: "The requested assembly GUI session expiry is invalid.",
    ASSEMBLY_GUI_SESSION_INVALID: "The assembly GUI session expired or is invalid.",
    ASSEMBLY_GUI_SESSION_MISMATCH: "The assembly GUI session does not match this action.",
    ASSEMBLY_GUI_SESSION_STALE: "Assembly access changed; reopen the assembly window.",
    ASSEMBLY_NOT_CHAIN_ANCHORED: "This assembly does not require a chain state transition.",
    ASSEMBLY_NOT_FOUND: "The assembly is no longer available.",
    ASSEMBLY_NOT_IN_CURRENT_SYSTEM: "You must be in the assembly's solar system.",
    ASSEMBLY_NOT_SMART_CATAPULT: "That assembly is not a Smart Catapult.",
    ASSEMBLY_NOT_SMART_GATE: "That assembly is not a smart gate.",
    ASSEMBLY_TRANSACTION_MISMATCH: "The assembly transaction no longer matches this action.",
    ASSEMBLY_TRANSACTION_NOT_FOUND: "The assembly transaction expired. Try the action again.",
    ASSEMBLY_UNDER_CONSTRUCTION: "Construction must finish before this assembly can be onlined.",
    ASSEMBLY_OCCUPIED: "This assembly has an active industry job or occupied berth.",
    CARGO_CONTAINER_TYPE_NOT_FOUND: "Dismantle cargo containers are unavailable.",
    DISMANTLE_ITEM_EXCEEDS_CONTAINER_CAPACITY: "An item is too large for a dismantle cargo container.",
    INVALID_DISMANTLE_CONTENTS: "The assembly contains invalid inventory rows.",
    INVALID_ASSEMBLY_SIGNATURE: "The signed assembly transaction could not be verified.",
    INVALID_ASSEMBLY_STATE: "The requested assembly state is invalid.",
    SMART_CATAPULT_DESTINATION_REQUIRED: "Set a destination solar system before bringing this Smart Catapult online.",
    SMART_CATAPULT_DESTINATION_UNAVAILABLE: "The selected destination solar system is unavailable.",
    SMART_CATAPULT_DESTINATION_UPDATE_FAILED: "The Smart Catapult destination could not be updated.",
    SMART_CATAPULT_JUMP_FAILED: "The Smart Catapult jump could not be completed.",
    SMART_CATAPULT_MUST_BE_OFFLINE: "Take this Smart Catapult offline before changing its destination.",
    SMART_CATAPULT_OFFLINE: "This Smart Catapult must be online before jumping.",
    SMART_CATAPULT_OUT_OF_RANGE: "The selected solar system is outside this Smart Catapult's range.",
    SMART_CATAPULT_SAME_SYSTEM: "A Smart Catapult destination must be another solar system.",
    ASSEMBLY_OFFLINE: "This assembly must be online to process requests.",
    ASSEMBLY_OWNER_INVALID: "This assembly has no valid access-policy owner.",
    ASSEMBLY_REQUEST_ACTOR_MISMATCH: "That assembly is not a participant in this request.",
    ASSEMBLY_REQUEST_CLAIM_EXPIRY_INVALID: "The requested claim lease is invalid.",
    ASSEMBLY_REQUEST_CLAIM_TOKEN_INVALID: "The request claim is stale or invalid.",
    ASSEMBLY_REQUEST_CHAIN_LINK_FAILED: "The request could not be securely linked to the deployed Sui world.",
    ASSEMBLY_REQUEST_CHAIN_PROOF_CONFLICT: "The request has a conflicting Sui chain attestation.",
    ASSEMBLY_REQUEST_CHAIN_PROOF_INVALID: "The request's Sui chain attestation is invalid or no longer authorized.",
    ASSEMBLY_REQUEST_CHAIN_PROOF_REQUIRED: "This request requires a verified Sui chain attestation.",
    ASSEMBLY_REQUEST_CHAIN_SIGNER_UNAUTHORIZED: "The queue signer is not authorized by the deployed Sui world.",
    ASSEMBLY_REQUEST_CHAIN_UNAVAILABLE: "The deployed Sui world is not currently available to verify this request.",
    ASSEMBLY_REQUEST_COMPLETION_CONFLICT: "This request was already completed with a different result.",
    ASSEMBLY_REQUEST_EXPIRY_INVALID: "The requested expiry is invalid.",
    ASSEMBLY_REQUEST_ID_CONFLICT: "That request ID is already used for a different request.",
    ASSEMBLY_REQUEST_ID_INVALID: "The request ID is invalid.",
    ASSEMBLY_REQUEST_NOT_CANCELLABLE: "This request can no longer be cancelled.",
    ASSEMBLY_REQUEST_NOT_CLAIMABLE: "This request can no longer be claimed.",
    ASSEMBLY_REQUEST_NOT_CLAIMED: "This request must be claimed before it can be completed.",
    ASSEMBLY_REQUEST_NOT_FOUND: "The assembly request no longer exists.",
    ASSEMBLY_REQUEST_OWNER_MISMATCH: "Smart assemblies owned by different characters cannot exchange requests.",
    ASSEMBLY_REQUEST_PAYLOAD_INVALID: "The assembly request contains unsupported data.",
    ASSEMBLY_REQUEST_PAYLOAD_TOO_LARGE: "The assembly request data is too large.",
    ASSEMBLY_REQUEST_PERSIST_FAILED: "The assembly request could not be saved.",
    ASSEMBLY_REQUEST_PRIORITY_FLAGS_INVALID: "The request contains unknown priority flags.",
    ASSEMBLY_REQUEST_PRIORITY_INVALID: "The request priority is invalid.",
    ASSEMBLY_REQUEST_ROLE_INVALID: "The request queue role is invalid.",
    ASSEMBLY_REQUEST_SELF_TARGET: "A smart assembly cannot request work from itself.",
    ASSEMBLY_REQUEST_STATE_INVALID: "The request state filter is invalid.",
    ASSEMBLY_REQUEST_TYPE_INVALID: "The assembly request type is invalid.",
    SMART_GATE_ALREADY_LINKED: "One of those Heavy Gates is already linked.",
    SMART_GATE_DESTINATION_OFFLINE: "The destination Heavy Gate must be online before jumping.",
    SMART_GATE_DESTINATION_REQUIRED: "Link this Heavy Gate to a destination before bringing it online.",
    SMART_GATE_DESTINATION_UNAVAILABLE: "The destination Heavy Gate has no usable arrival point.",
    SMART_GATE_JUMP_FAILED: "The Heavy Gate jump could not be completed.",
    SMART_GATE_LINK_MISMATCH: "The Heavy Gate link is no longer reciprocal.",
    SMART_GATE_MUST_BE_OFFLINE: "Both Heavy Gates must be offline before changing their link.",
    SMART_GATE_NOT_LINKED: "This Heavy Gate is not linked.",
    SMART_GATE_OFFLINE: "This Heavy Gate must be online before jumping.",
    SMART_GATE_OUT_OF_RANGE: "The selected Heavy Gate is outside this gate's jump range.",
    SMART_GATE_SAME_SYSTEM: "Heavy Gates must link across different solar systems.",
    SMART_GATE_SELF_LINK: "A Heavy Gate cannot link to itself.",
    SMART_GATE_TYPE_MISMATCH: "Heavy Gates can only link to another gate of the same type.",
    SHIP_NOT_IN_SPACE: "You need an active ship in space to use this gate or Smart Catapult.",
    CONSTRUCTION_TEMPLATE_NOT_FOUND: "That Construction Template no longer exists.",
    CONSTRUCTION_TEMPLATE_LIMIT_REACHED: "You have reached the Construction Template limit.",
    CONSTRUCTION_TEMPLATE_REVISION_CONFLICT: "That Construction Template changed. Refresh it before saving.",
    CONSTRUCTION_TEMPLATE_PREVIEW_INVALID: "That Construction Template preview expired. Preview it again.",
    CONSTRUCTION_TEMPLATE_CHANGED: "The Construction Template changed after it was previewed.",
    CONSTRUCTION_TEMPLATE_PREVIEW_FAILED: "The Construction Template cannot be placed at that anchor.",
    CONSTRUCTION_SITE_TYPE_NOT_FOUND: "This Smart Assembly has no authored construction-site type and cannot be placed.",
    DIRECT_ASSEMBLY_PORTABLE_ONLY: "Only Portable Assemblies support direct placement. Smart Assemblies must be built through construction sites.",
    DIRECT_ASSEMBLY_NETWORK_NODE_REQUIRES_SITE: "Portable Assemblies placed in a Network Node build zone must be built through a construction site.",
    CONSTRUCTION_PLAN_NOT_FOUND: "That Construction Template deployment plan no longer exists.",
    CONSTRUCTION_PLAN_WRONG_SYSTEM: "Return to the deployment plan's solar system before resuming it.",
    CONSTRUCTION_PLAN_AUTHORIZATION_INVALID: "That Construction Template authorization is stale or invalid.",
    CONSTRUCTION_PLAN_ALREADY_COMPLETE: "That Construction Template deployment is already complete.",
});
function throwAssemblyError(result) {
    const reason = String(result && result.errorMsg || "ASSEMBLY_STATE_CHANGE_FAILED");
    throwWrappedUserError("CustomNotify", {
        notify: ERROR_MESSAGES[reason] || `Assembly state change failed: ${reason}`,
    });
}
function getDeploymentRuntime() {
    return require("./deploymentRuntime");
}
function getRequestRuntime() {
    return require("./smartAssemblyRequestRuntime");
}
function getAccessRuntime() {
    return require("./assemblyAccessRuntime");
}
function getConstructionTemplateRuntime() {
    return require("./smartAssemblyConstructionTemplateRuntime");
}
function requestOptions(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function requestOwnerOptions(session, value = {}) {
    return {
        ...requestOptions(value),
        ownerID: Number(session && (session.characterID || session.charid)) || 0,
        // Cross-owner delivery is reserved for trusted server runtimes. A caller
        // cannot opt into it through a native player RPC payload.
        allowCrossOwner: false,
    };
}
function authorizedRequestOptions(session, assemblyID, capability, value = {}) {
    // Preserve the request runtime as the authoritative not-found check. This
    // also keeps isolated protocol adapters usable when they replace that
    // runtime without materializing inventory fixtures.
    if (!getDeploymentRuntime().getAssemblyRecord(assemblyID)) {
        return requestOwnerOptions(session, value);
    }
    const access = getAccessRuntime().resolveAccess(playerAccessActor(session), assemblyID, [capability]);
    if (!access || access.success !== true)
        throwAssemblyError(access);
    return {
        ...requestOptions(value),
        ownerID: Number(access.data.assembly && access.data.assembly.ownerID) || 0,
        // A grant authorizes use of its source/target assembly; it never disables
        // the request bus's separate cross-owner delivery policy.
        allowCrossOwner: false,
    };
}
function buildRequestRecord(record) {
    return buildDict(Object.entries(record || {}));
}
function buildAccessValue(value) {
    if (Array.isArray(value))
        return buildList(value.map(buildAccessValue));
    if (value && typeof value === "object") {
        return buildDict(Object.entries(value).map(([key, entry]) => [key, buildAccessValue(entry)]));
    }
    return value;
}
function playerAccessActor(session) {
    return {
        kind: "player",
        actorID: Number(session && (session.characterID || session.charid)) || 0,
        tribeID: Number(session && (session.tribeID || session.tribeId || session.corporationID || session.corpid)) || 0,
    };
}
const accessSessionBindings = new WeakMap();
function getAccessSessionBinding(session) {
    if (!session || typeof session !== "object")
        return "";
    let binding = accessSessionBindings.get(session);
    if (!binding) {
        binding = crypto.randomUUID().toLowerCase();
        accessSessionBindings.set(session, binding);
    }
    return binding;
}
function requireRequestResult(result) {
    if (!result || result.success !== true)
        throwAssemblyError(result);
    return result;
}
function mapRequestResult(result, mapper) {
    return result && typeof result.then === "function"
        ? result.then(value => mapper(requireRequestResult(value)))
        : mapper(requireRequestResult(result));
}
class SmartAssemblyService extends BaseService {
    constructor() {
        super("smartAssemblyService");
    }
    Handle_get_my_assemblies(_args, session) {
        return buildList(getDeploymentRuntime().listMyAssemblies(session).map((record) => (buildDict(Object.entries(record)))));
    }
    Handle_get_construction_template_protocol() {
        const runtime = getConstructionTemplateRuntime();
        return buildAccessValue({
            version: 1,
            artifact_name: "Construction Template",
            placement_modes: ["auto", "directAssembly", "constructionSite"],
            direct_assembly_policy: "portable-outside-network-node",
            portable_network_node_policy: "construction-site",
            smart_assembly_policy: "construction-site",
            node_limit: runtime.CONSTRUCTION_TEMPLATE_NODE_LIMIT,
            preview_ttl_ms: runtime.CONSTRUCTION_TEMPLATE_PREVIEW_TTL_MS,
            supports_player_execution: true,
            supports_npc_execution: true,
            blueprint_term_reserved_for_manufacturing: true,
        });
    }
    Handle_list_construction_templates(_args, session) {
        const runtime = getConstructionTemplateRuntime();
        return buildAccessValue(runtime.listConstructionTemplates(runtime.playerPrincipal(session)));
    }
    Handle_get_construction_template(args, session) {
        const runtime = getConstructionTemplateRuntime();
        const record = runtime.getConstructionTemplate(runtime.playerPrincipal(session), args && args[0]);
        if (!record)
            throwAssemblyError({ errorMsg: "CONSTRUCTION_TEMPLATE_NOT_FOUND" });
        return buildAccessValue(record);
    }
    Handle_save_construction_template(args, session) {
        const runtime = getConstructionTemplateRuntime();
        const input = requestOptions(args && args[0]);
        const options = requestOptions(args && args[1]);
        const result = runtime.saveConstructionTemplate(runtime.playerPrincipal(session), input, {
            ...options,
            templateID: options.templateID ?? input.templateID ?? input.template_id,
            expectedRevision: options.expectedRevision ?? options.expected_revision,
        });
        if (!result.success && result.errorMsg)
            throwAssemblyError(result);
        return buildAccessValue(result);
    }
    Handle_delete_construction_template(args, session) {
        const runtime = getConstructionTemplateRuntime();
        const result = runtime.deleteConstructionTemplate(runtime.playerPrincipal(session), args && args[0]);
        if (!result.success)
            throwAssemblyError(result);
        return buildAccessValue(result.data);
    }
    Handle_preview_construction_template(args, session) {
        const runtime = getConstructionTemplateRuntime();
        const result = runtime.previewConstructionTemplate(session, args && args[0], requestOptions(args && args[1]), requestOptions(args && args[2]));
        if (!result.success && result.errorMsg !== "CONSTRUCTION_TEMPLATE_PREVIEW_FAILED") {
            throwAssemblyError(result);
        }
        return buildAccessValue(result);
    }
    Handle_execute_construction_template(args, session) {
        const result = getConstructionTemplateRuntime().createConstructionPlanFromPreview(session, args && args[0]);
        if (!result.success)
            throwAssemblyError(result);
        return buildAccessValue(result.data);
    }
    Handle_list_construction_plans(_args, session) {
        const runtime = getConstructionTemplateRuntime();
        // Rehydrate restart-persisted queues as soon as the owner reconnects and
        // opens the Construction Template UI. Live queues also self-schedule.
        runtime.resumePlayerConstructionPlans(session);
        return buildAccessValue(runtime.listConstructionPlans(runtime.playerPrincipal(session)));
    }
    Handle_get_construction_plan(args, session) {
        const runtime = getConstructionTemplateRuntime();
        const record = runtime.getConstructionPlan(runtime.playerPrincipal(session), args && args[0]);
        if (!record)
            throwAssemblyError({ errorMsg: "CONSTRUCTION_PLAN_NOT_FOUND" });
        return buildAccessValue(record);
    }
    Handle_resume_construction_plan(args, session) {
        const result = getConstructionTemplateRuntime().resumePlayerConstructionPlan(session, args && args[0]);
        if (!result.success)
            throwAssemblyError(result);
        return buildAccessValue(result.data);
    }
    Handle_pause_construction_plan(args, session) {
        const result = getConstructionTemplateRuntime().pauseConstructionPlan(session, args && args[0]);
        if (!result.success)
            throwAssemblyError(result);
        return buildAccessValue(result.data);
    }
    Handle_cancel_construction_plan(args, session) {
        const result = getConstructionTemplateRuntime().cancelConstructionPlan(session, args && args[0]);
        if (!result.success)
            throwAssemblyError(result);
        return buildAccessValue(result.data);
    }
    Handle_authorize_construction_plan_action(args, session) {
        const result = getConstructionTemplateRuntime().commitConstructionPlanAction(session, args && args[0], args && args[1], args && args[2], args && args[3]);
        if (!result.success)
            throwAssemblyError(result);
        return buildAccessValue(result.data);
    }
    Handle_get_request_protocol() {
        const runtime = getRequestRuntime();
        return buildDict([
            ["version", 2],
            ["priorities", buildDict(Object.entries(runtime.ASSEMBLY_REQUEST_PRIORITY))],
            ["priority_flags", buildDict(Object.entries(runtime.ASSEMBLY_REQUEST_PRIORITY_FLAG))],
            ["priority_flag_mask", runtime.ASSEMBLY_REQUEST_PRIORITY_FLAG_MASK],
        ]);
    }
    Handle_get_access_protocol() {
        const runtime = getAccessRuntime();
        return buildAccessValue({
            version: 1,
            capabilities: runtime.ASSEMBLY_ACCESS_CAPABILITY,
            recipient_kinds: ["player", "npc", "tribe", "faction"],
            smart_chain_authority: "local_projection_pending_chain",
        });
    }
    Handle_request_assembly_access(args, session) {
        const result = getAccessRuntime().requestAccess(playerAccessActor(session), Number(args && args[0]) || 0, args && args[1], requestOptions(args && args[2]));
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_get_assembly_access_requests(args, session) {
        const result = getAccessRuntime().listRequests(playerAccessActor(session), Number(args && args[0]) || 0, requestOptions(args && args[1]));
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_get_assembly_access_grants(args, session) {
        const result = getAccessRuntime().listGrants(playerAccessActor(session), Number(args && args[0]) || 0, requestOptions(args && args[1]));
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_approve_assembly_access(args, session) {
        const result = getAccessRuntime().approveRequest(playerAccessActor(session), Number(args && args[0]) || 0, args && args[1], requestOptions(args && args[2]));
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_deny_assembly_access(args, session) {
        const result = getAccessRuntime().denyRequest(playerAccessActor(session), Number(args && args[0]) || 0, args && args[1], args && args[2]);
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_cancel_assembly_access_request(args, session) {
        const result = getAccessRuntime().cancelRequest(playerAccessActor(session), Number(args && args[0]) || 0, args && args[1], args && args[2]);
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_share_assembly_access(args, session) {
        const result = getAccessRuntime().shareAccess(playerAccessActor(session), Number(args && args[0]) || 0, args && args[1], args && args[2], requestOptions(args && args[3]));
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_revoke_assembly_access(args, session) {
        const result = getAccessRuntime().revokeGrant(playerAccessActor(session), Number(args && args[0]) || 0, args && args[1], { reason: args && args[2] });
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_relinquish_assembly_access(args, session) {
        const result = getAccessRuntime().relinquishGrant(playerAccessActor(session), Number(args && args[0]) || 0, args && args[1], args && args[2]);
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_confirm_assembly_access_chain(args, _session) {
        const result = getAccessRuntime().confirmGrantChainAuthority(args && args[0], requestOptions(args && args[1]));
        return mapRequestResult(result, value => buildAccessValue(value.data));
    }
    Handle_transfer_cross_owner_inventory(args, session) {
        const request = requestOptions(args && args[0]);
        const actor = playerAccessActor(session);
        const result = require("./assemblyCrossOwnerInventoryRuntime")
            .executeCrossOwnerInventoryTransfer(actor, {
            ...request,
            activeShipID: Number(session && (session.shipid || session.shipID || session._space?.shipID)) || 0,
            solarSystemID: Number(session && (session.solarsystemid2 || session.solarsystemid || session._space?.systemID)) || 0,
        });
        return mapRequestResult(result, value => buildAccessValue(value.data));
    }
    Handle_get_assembly_access(args, session) {
        const result = getAccessRuntime().resolveAccess(playerAccessActor(session), Number(args && args[0]) || 0, args && args[1] || []);
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_get_assembly_access_events(args, session) {
        const result = getAccessRuntime().listEvents(playerAccessActor(session), Number(args && args[0]) || 0, requestOptions(args && args[1]));
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_open_shared_assembly_gui(args, session) {
        const result = getAccessRuntime().issueGuiSession(playerAccessActor(session), Number(args && args[0]) || 0, {
            ...requestOptions(args && args[1]),
            sessionBinding: getAccessSessionBinding(session),
        });
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_validate_shared_assembly_gui(args, session) {
        const result = getAccessRuntime().validateGuiSession(args && args[1], playerAccessActor(session), Number(args && args[0]) || 0, args && args[2], { sessionBinding: getAccessSessionBinding(session) });
        return buildAccessValue(requireRequestResult(result).data);
    }
    Handle_get_accessible_assemblies(_args, session) {
        const actor = playerAccessActor(session);
        const capability = getAccessRuntime().ASSEMBLY_ACCESS_CAPABILITY.GUI_VIEW;
        const records = getDeploymentRuntime().listAssemblies()
            .map((assembly) => {
            const access = getAccessRuntime().resolveAccess(actor, assembly.itemID, [capability]);
            return access && access.success === true ? {
                ...assembly,
                access_capabilities: access.data.capabilities,
                access_policy_revision: access.data.policyRevision,
                access_is_owner: access.data.isOwner,
            } : null;
        })
            .filter(Boolean);
        return buildAccessValue(records);
    }
    _beginStateTransition(args, session, targetStatus) {
        const itemID = Number(args && args[0]) || 0;
        const result = getDeploymentRuntime().beginAssemblyStateTransition(session, itemID, targetStatus);
        if (!result || result.success !== true || !result.data) {
            log.info(`[smartAssemblyService] State transition rejected char=${session && session.characterID} ` +
                `item=${itemID} target=${targetStatus} reason=${result && result.errorMsg || "UNKNOWN"}`);
            throwAssemblyError(result);
        }
        return buildDict([
            ["transaction_data", result.data.transactionData],
            ["transaction_uuid", result.data.transactionUUID],
        ]);
    }
    _commitStateTransition(args, session, targetStatus) {
        const itemID = Number(args && args[0]) || 0;
        const result = getDeploymentRuntime().commitAssemblyStateTransition(session, itemID, args && args[1], args && args[2], targetStatus);
        if (!result || result.success !== true) {
            log.info(`[smartAssemblyService] Signed state transition rejected ` +
                `char=${session && session.characterID} item=${itemID} ` +
                `target=${targetStatus} reason=${result && result.errorMsg || "UNKNOWN"}`);
            return false;
        }
        return true;
    }
    Handle_set_online(args, session) {
        return this._beginStateTransition(args, session, ASSEMBLY_STATUS_ONLINE);
    }
    Handle_set_online_signature(args, session) {
        return this._commitStateTransition(args, session, ASSEMBLY_STATUS_ONLINE);
    }
    Handle_set_offline(args, session) {
        return this._beginStateTransition(args, session, ASSEMBLY_STATUS_OFFLINE);
    }
    Handle_set_offline_signature(args, session) {
        return this._commitStateTransition(args, session, ASSEMBLY_STATUS_OFFLINE);
    }
    Handle_on_interaction(args, session) {
        const itemID = Number(args && args[0]) || 0;
        const result = getDeploymentRuntime().recordAssemblyInteraction(session, itemID);
        if (!result || result.success !== true) {
            throwAssemblyError(result);
        }
        return null;
    }
    Handle_create_request(args, session) {
        const sourceAssemblyID = Number(args && args[0]) || 0;
        const options = authorizedRequestOptions(session, sourceAssemblyID, getAccessRuntime().ASSEMBLY_ACCESS_CAPABILITY.OPERATE, args && args[3]);
        const result = getRequestRuntime().createRequest(sourceAssemblyID, Number(args && args[1]) || 0, args && args[2], options);
        return mapRequestResult(result, value => buildRequestRecord(value.data));
    }
    Handle_get_requests(args, session) {
        const assemblyID = Number(args && args[0]) || 0;
        const result = requireRequestResult(getRequestRuntime().listRequests(assemblyID, authorizedRequestOptions(session, assemblyID, getAccessRuntime().ASSEMBLY_ACCESS_CAPABILITY.GUI_VIEW, args && args[1])));
        return buildList(result.data.map(buildRequestRecord));
    }
    Handle_get_request_signals(args, session) {
        const assemblyID = Number(args && args[0]) || 0;
        const result = requireRequestResult(getRequestRuntime().listSignals(assemblyID, authorizedRequestOptions(session, assemblyID, getAccessRuntime().ASSEMBLY_ACCESS_CAPABILITY.GUI_VIEW, args && args[1])));
        return buildDict([
            ["next_sequence", result.data.nextSequence],
            ["oldest_sequence", result.data.oldestSequence],
            ["truncated", result.data.truncated],
            ["signals", buildList(result.data.signals.map(buildRequestRecord))],
        ]);
    }
    Handle_claim_request(args, session) {
        const assemblyID = Number(args && args[0]) || 0;
        const result = getRequestRuntime().claimRequest(assemblyID, args && args[1], authorizedRequestOptions(session, assemblyID, getAccessRuntime().ASSEMBLY_ACCESS_CAPABILITY.OPERATE, args && args[2]));
        return mapRequestResult(result, value => buildRequestRecord(value.data));
    }
    Handle_renew_request_claim(args, session) {
        const assemblyID = Number(args && args[0]) || 0;
        const result = requireRequestResult(getRequestRuntime().renewClaim(assemblyID, args && args[1], args && args[2], authorizedRequestOptions(session, assemblyID, getAccessRuntime().ASSEMBLY_ACCESS_CAPABILITY.OPERATE, args && args[3])));
        return buildRequestRecord(result.data);
    }
    Handle_release_request(args, session) {
        const assemblyID = Number(args && args[0]) || 0;
        const result = requireRequestResult(getRequestRuntime().releaseClaim(assemblyID, args && args[1], args && args[2], authorizedRequestOptions(session, assemblyID, getAccessRuntime().ASSEMBLY_ACCESS_CAPABILITY.OPERATE)));
        return buildRequestRecord(result.data);
    }
    _fulfillRequest(args, session) {
        const assemblyID = Number(args && args[0]) || 0;
        const result = getRequestRuntime().fulfillRequest(assemblyID, args && args[1], args && args[2], args && args[3], authorizedRequestOptions(session, assemblyID, getAccessRuntime().ASSEMBLY_ACCESS_CAPABILITY.OPERATE));
        return mapRequestResult(result, value => buildRequestRecord(value.data));
    }
    Handle_fulfill_request(args, session) {
        return this._fulfillRequest(args, session);
    }
    Handle_fulfil_request(args, session) {
        return this._fulfillRequest(args, session);
    }
    Handle_fail_request(args, session) {
        const assemblyID = Number(args && args[0]) || 0;
        const result = getRequestRuntime().failRequest(assemblyID, args && args[1], args && args[2], args && args[3], authorizedRequestOptions(session, assemblyID, getAccessRuntime().ASSEMBLY_ACCESS_CAPABILITY.OPERATE));
        return mapRequestResult(result, value => buildRequestRecord(value.data));
    }
    Handle_cancel_request(args, session) {
        const assemblyID = Number(args && args[0]) || 0;
        const result = getRequestRuntime().cancelRequest(assemblyID, args && args[1], authorizedRequestOptions(session, assemblyID, getAccessRuntime().ASSEMBLY_ACCESS_CAPABILITY.OPERATE, { reason: args && args[2] }));
        return mapRequestResult(result, value => buildRequestRecord(value.data));
    }
    Handle_dismantle_assembly(args, session) {
        const itemID = Number(args && args[0]) || 0;
        const result = getDeploymentRuntime().dismantleAssembly(session, itemID);
        if (!result || result.success !== true) {
            log.info(`[smartAssemblyService] Dismantle rejected char=${session && session.characterID} ` +
                `item=${itemID} reason=${result && result.errorMsg || "UNKNOWN"}`);
            throwAssemblyError(result);
        }
        return null;
    }
    Handle_get_available_systems(args, session) {
        const gateID = Number(args && args[0]) || 0;
        const result = getDeploymentRuntime().getAvailableCatapultSystems(session, gateID);
        if (!result || result.success !== true || !result.data) {
            throwAssemblyError(result);
        }
        return buildList(result.data.systems);
    }
    Handle_set_destination_system(args, session) {
        const gateID = Number(args && args[0]) || 0;
        const destinationSolarSystemID = Number(args && args[1]) || 0;
        const result = getDeploymentRuntime().setCatapultDestination(session, gateID, destinationSolarSystemID);
        if (!result || result.success !== true) {
            log.info(`[smartAssemblyService] Catapult destination rejected char=${session && session.characterID} ` +
                `source=${gateID} system=${destinationSolarSystemID} ` +
                `reason=${result && result.errorMsg || "UNKNOWN"}`);
            throwAssemblyError(result);
        }
        return null;
    }
    Handle_clear_destination(args, session) {
        const gateID = Number(args && args[0]) || 0;
        const result = getDeploymentRuntime().clearCatapultDestination(session, gateID);
        if (!result || result.success !== true) {
            log.info(`[smartAssemblyService] Catapult destination clear rejected ` +
                `char=${session && session.characterID} source=${gateID} ` +
                `reason=${result && result.errorMsg || "UNKNOWN"}`);
            throwAssemblyError(result);
        }
        return null;
    }
    Handle_system_jump(args, session) {
        const gateID = Number(args && args[0]) || 0;
        const result = getDeploymentRuntime().jumpWithCatapult(session, gateID);
        if (!result || result.success !== true) {
            log.info(`[smartAssemblyService] Catapult jump rejected char=${session && session.characterID} ` +
                `source=${gateID} reason=${result && result.errorMsg || "UNKNOWN"}`);
            throwAssemblyError(result);
        }
        return true;
    }
    Handle_link_gates(args, session) {
        const gateID = Number(args && args[0]) || 0;
        const destinationGateID = Number(args && args[1]) || 0;
        const result = getDeploymentRuntime().beginGateLinkTransition(session, gateID, destinationGateID);
        if (!result || result.success !== true || !result.data) {
            log.info(`[smartAssemblyService] Gate link rejected char=${session && session.characterID} ` +
                `source=${gateID} destination=${destinationGateID} ` +
                `reason=${result && result.errorMsg || "UNKNOWN"}`);
            throwAssemblyError(result);
        }
        return buildDict([
            ["transaction_data", result.data.transactionData],
            ["transaction_uuid", result.data.transactionUUID],
        ]);
    }
    Handle_link_gates_signature(args, session) {
        const gateID = Number(args && args[0]) || 0;
        const result = getDeploymentRuntime().commitGateLinkTransition(session, gateID, args && args[1], args && args[2]);
        if (!result || result.success !== true) {
            log.info(`[smartAssemblyService] Signed gate link rejected ` +
                `char=${session && session.characterID} source=${gateID} ` +
                `reason=${result && result.errorMsg || "UNKNOWN"}`);
            return false;
        }
        return true;
    }
    Handle_gate_jump(args, session) {
        const gateID = Number(args && args[0]) || 0;
        const result = getDeploymentRuntime().beginGateJumpTransition(session, gateID);
        if (!result || result.success !== true || !result.data) {
            log.info(`[smartAssemblyService] Gate jump rejected char=${session && session.characterID} ` +
                `source=${gateID} reason=${result && result.errorMsg || "UNKNOWN"}`);
            throwAssemblyError(result);
        }
        return buildDict([
            ["transaction_data", result.data.transactionData],
            ["transaction_uuid", result.data.transactionUUID],
        ]);
    }
    Handle_gate_jump_signature(args, session) {
        const gateID = Number(args && args[0]) || 0;
        const result = getDeploymentRuntime().commitGateJumpTransition(session, gateID, args && args[1], args && args[2]);
        if (!result || result.success !== true) {
            log.info(`[smartAssemblyService] Signed gate jump rejected ` +
                `char=${session && session.characterID} source=${gateID} ` +
                `reason=${result && result.errorMsg || "UNKNOWN"}`);
            throwAssemblyError(result);
        }
        return true;
    }
    Handle_unlink_gate(args, session) {
        const gateID = Number(args && args[0]) || 0;
        const result = getDeploymentRuntime().beginGateUnlinkTransition(session, gateID);
        if (!result || result.success !== true || !result.data) {
            log.info(`[smartAssemblyService] Gate unlink rejected char=${session && session.characterID} ` +
                `source=${gateID} reason=${result && result.errorMsg || "UNKNOWN"}`);
            throwAssemblyError(result);
        }
        return buildDict([
            ["transaction_data", result.data.transactionData],
            ["transaction_uuid", result.data.transactionUUID],
        ]);
    }
    Handle_unlink_gate_signature(args, session) {
        const gateID = Number(args && args[0]) || 0;
        const result = getDeploymentRuntime().commitGateUnlinkTransition(session, gateID, args && args[1], args && args[2]);
        if (!result || result.success !== true) {
            log.info(`[smartAssemblyService] Signed gate unlink rejected ` +
                `char=${session && session.characterID} source=${gateID} ` +
                `reason=${result && result.errorMsg || "UNKNOWN"}`);
            return false;
        }
        return true;
    }
}
module.exports = SmartAssemblyService;
//# sourceMappingURL=smartAssemblyService.js.map