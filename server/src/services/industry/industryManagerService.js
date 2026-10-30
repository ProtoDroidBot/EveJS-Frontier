"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const { buildDict, buildList, unwrapMarshalValue, } = require(path.join(__dirname, "../_shared/serviceHelpers"));
const { buildJobPayload, parseIndustryRequest, } = require(path.join(__dirname, "./industryPayloads"));
const { cancelIndustryJob, deliverIndustryJob, getJobByID, getJobCountsByInstaller, installIndustryJob, listJobsByOwner, } = require(path.join(__dirname, "./industryRuntimeState"));
const legacy = require("./legacyIndustryRuntime");
function toInt(value, fallback = 0) {
    const numeric = Number(unwrapMarshalValue(value));
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}
function normalizeCompleteManyJobs(rawJobs) {
    const jobs = unwrapMarshalValue(rawJobs);
    return Array.isArray(jobs) ? jobs : [];
}
function extractCompleteManyJobID(entry) {
    const normalized = unwrapMarshalValue(entry);
    if (Array.isArray(normalized)) {
        return toInt(normalized[0], 0);
    }
    if (normalized && typeof normalized === "object") {
        return toInt(normalized.jobID, 0);
    }
    return toInt(normalized, 0);
}
class IndustryManagerService extends BaseService {
    constructor() {
        super("industryManager");
    }
    Handle_GetJob(args, session) {
        const jobID = args && args.length > 0 ? args[0] : null;
        const job = getJobByID(jobID);
        return buildJobPayload(legacy.isLegacyIndustryJob(job)
            ? legacy.getLegacyIndustryJobByID(jobID, session) : job || {});
    }
    Handle_GetJobsByOwner(args, session) {
        const ownerID = args && args.length > 0 ? args[0] : null;
        const includeCompleted = Boolean(args && args.length > 1 ? args[1] : false);
        return buildList(listJobsByOwner(ownerID, includeCompleted).map(job => buildJobPayload(legacy.isLegacyIndustryJob(job) ? legacy.getLegacyIndustryJobByID(job.jobID, session) : job)));
    }
    Handle_InstallJob(args, session) {
        const request = parseIndustryRequest(args && args.length > 0 ? args[0] : null);
        const result = installIndustryJob(session, request);
        return result && result.data ? result.data.jobID : null;
    }
    Handle_CompleteJob(args, session) {
        const jobID = args && args.length > 0 ? args[0] : null;
        if (legacy.isLegacyIndustryJob(getJobByID(jobID))) {
            return buildJobPayload(legacy.completeLegacyIndustryJob(session, jobID).data);
        }
        const result = deliverIndustryJob(session, jobID);
        return result && result.data ? buildJobPayload(result.data) : null;
    }
    Handle_CompleteManyJobs(args, session) {
        const jobs = normalizeCompleteManyJobs(args && args.length > 0 ? args[0] : []);
        const delivered = [];
        for (const entry of jobs) {
            const jobID = extractCompleteManyJobID(entry);
            if (jobID <= 0) {
                continue;
            }
            if (legacy.isLegacyIndustryJob(getJobByID(jobID))) {
                delivered.push(buildJobPayload(legacy.completeLegacyIndustryJob(session, jobID).data));
                continue;
            }
            const result = deliverIndustryJob(session, jobID);
            if (result && result.data) {
                delivered.push(buildJobPayload(result.data));
            }
        }
        return buildList(delivered);
    }
    Handle_CancelJob(args, session) {
        const jobID = args && args.length > 0 ? args[0] : null;
        if (legacy.isLegacyIndustryJob(getJobByID(jobID))) {
            return buildJobPayload(legacy.cancelLegacyIndustryJob(session, jobID).data);
        }
        const result = cancelIndustryJob(session, jobID);
        return result && result.data ? buildJobPayload(result.data) : null;
    }
    Handle_GetJobCounts(args, session) {
        const installerID = args && args.length > 0
            ? args[0]
            : session && (session.characterID || session.charid);
        return buildDict(Object.entries(getJobCountsByInstaller(installerID)).map(([activityID, count]) => [Number(activityID) || 0, Number(count) || 0]));
    }
}
module.exports = IndustryManagerService;
//# sourceMappingURL=industryManagerService.js.map