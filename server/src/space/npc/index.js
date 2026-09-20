"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const npcService = require("./npcService");
const npcRuntime = require("./npcRuntime");
const npcFitting = require("./npcFittingService");
const npcResources = require("./npcResourceJobService");
const npcConstruction = require("./npcConstructionJobService");
const npcConstructionTemplates = require("./npcConstructionTemplateJobService");
const npcIndustry = require("./npcIndustryJobService");
const npcAssemblyAccess = require("./npcAssemblyAccessService");
const npcStargateMaintenance = require("./npcStargateMaintenanceService");
const npcTransponderMembership = require("./npcTransponderMembership");
const npcSupport = require("./npcSupportCoordinator");
module.exports = {
    ...npcService,
    runtime: npcRuntime,
    fitting: npcFitting,
    resources: npcResources,
    construction: npcConstruction,
    constructionTemplates: npcConstructionTemplates,
    industry: npcIndustry,
    assemblyAccess: npcAssemblyAccess,
    stargateMaintenance: npcStargateMaintenance,
    transponderMembership: npcTransponderMembership,
    support: npcSupport,
};
//# sourceMappingURL=index.js.map