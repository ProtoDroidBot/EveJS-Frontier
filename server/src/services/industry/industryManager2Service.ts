const BaseService = require("../baseService");
const { buildList } = require("../_shared/serviceHelpers");
const { buildJobPayload } = require("./industryPayloads");
const {
  getLegacyIndustryJobByID, listLegacyIndustryJobsByOwner,
  installLegacyIndustryJob, completeLegacyIndustryJob, cancelLegacyIndustryJob,
} = require("./legacyIndustryRuntime");

class IndustryManager2Service extends BaseService {
  constructor() { super("industryManager2"); }

  Handle_get_jobs_by_owner(args, session) {
    return buildList(listLegacyIndustryJobsByOwner(session, args?.[0], args?.[1] ?? false).map(buildJobPayload));
  }

  Handle_get_job(args, session) {
    return buildJobPayload(getLegacyIndustryJobByID(args?.[0], session));
  }

  Handle_install_job_for_character(args, session) {
    installLegacyIndustryJob(session, args?.[0], args?.[1]);
    return null;
  }

  Handle_complete_job(args, session) {
    completeLegacyIndustryJob(session, args?.[0]);
    return null;
  }

  Handle_cancel_job(args, session) {
    cancelLegacyIndustryJob(session, args?.[0]);
    return null;
  }
}

module.exports = IndustryManager2Service;
