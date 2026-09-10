"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const RaffleRuntime = require(path.join(__dirname, "./raffleRuntime"));
const runtime = new RaffleRuntime();
function getRaffleRuntime() {
    return runtime;
}
function resetRaffleRuntime() {
    runtime.reset();
    return runtime;
}
module.exports = {
    getRaffleRuntime,
    resetRaffleRuntime,
};
//# sourceMappingURL=raffleRuntimeSingleton.js.map