"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { startXmppStub } = require("../../services/chat/xmppStubServer");
const config = require("../../config");
const log = require("../../utils/logger");
const { getXmppConnectHost } = require("../../services/chat/xmppConfig");
module.exports = {
    enabled: true,
    serviceName: "xmppChatServer",
    exec() {
        startXmppStub();
        log.debug(`xmpp chat server running on tls://${getXmppConnectHost()}:${config.xmppServerPort}`);
    },
};
//# sourceMappingURL=server.js.map