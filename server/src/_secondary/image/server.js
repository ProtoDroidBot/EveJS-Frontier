"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const http = require("http");
const fs = require("fs");
const config = require("../../config");
const log = require("../../utils/logger");
const { resolveImageRequestAsync } = require("./imageRequestResolver");
function startImageServer() {
    const server = http.createServer(async (req, res) => {
        const url = String(req.url || "/");
        log.debug(`image request: ${url}`);
        try {
            const resolved = await resolveImageRequestAsync(url);
            const filePath = resolved.filePath;
            const contentType = resolved.contentType;
            const stat = await fs.promises.stat(filePath);
            if (!stat.isFile()) {
                res.writeHead(404);
                res.end();
                return;
            }
            res.writeHead(200, {
                "Content-Type": contentType,
                "Content-Length": stat.size,
                "Cache-Control": "public, max-age=300",
            });
            const stream = fs.createReadStream(filePath);
            stream.on("error", (error) => {
                log.warn(`[ImageServer] read error for ${url}: ${error.message}`);
                if (!res.headersSent)
                    res.writeHead(500);
                res.destroy(error);
            });
            stream.pipe(res);
        }
        catch (error) {
            if (error && error.code === "ENOENT") {
                res.writeHead(404);
                res.end();
                return;
            }
            log.warn(`[ImageServer] stat error for ${url}: ${error.message}`);
            res.writeHead(500);
            res.end();
        }
    });
    const url = new URL(config.imageServerUrl);
    const port = Number.parseInt(url.port, 10);
    const host = String(config.imageServerBindHost ||
        (url.hostname === "localhost" ? "127.0.0.1" : url.hostname)).trim();
    server.on("error", (err) => {
        log.err(`[ImageServer] listen error: ${err.message}`);
    });
    server.listen(port, host);
}
module.exports = {
    enabled: true,
    serviceName: "imageServer",
    exec() {
        startImageServer();
        log.debug(`http image server running on ${config.imageServerUrl}`);
    },
};
//# sourceMappingURL=server.js.map