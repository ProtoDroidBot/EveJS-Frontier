import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPythonInvocation,
  resolveFrontierPython,
  windowsExternalPythonEnvironment,
  windowsExternalPythonSetup,
} from "../lib/frontier-python.mjs";

import {
  isInventoryMember,
  isPublicProtoMember,
  parseArgs,
} from "../../frontier-contracts/export-frontier-contracts.mjs";

test("contract exporter parses build and destination options", () => {
  const options = parseArgs([
    "--build",
    "3450341",
    "--out",
    "./tmp/contracts",
    "--force",
  ]);

  assert.equal(options.build, 3450341);
  assert.equal(options.outDir, path.resolve("./tmp/contracts"));
  assert.equal(options.force, true);
});

test("contract exporter recognizes public protobuf bytecode", () => {
  assert.equal(
    isPublicProtoMember(
      "eveProto/generated/eve_public/chat/local_pb2.pyc",
    ),
    true,
  );
  assert.equal(
    isPublicProtoMember("eveProto/generated/eve/wallet/wallet_pb2.pyc"),
    false,
  );
});

test("contract exporter inventories selected Frontier client modules", () => {
  assert.equal(
    isInventoryMember("frontier/landscape/common/resource_config.pyc"),
    true,
  );
  assert.equal(
    isInventoryMember("frontier/smart_assemblies/client/proto_messenger.pyc"),
    true,
  );
  assert.equal(isInventoryMember("eve/client/script/ui/shared/mapView.pyc"), false);
});

test("Linux static extraction still requires native client loaders", () => {
  const configuredWine = process.env.EVEJS_FRONTIER_WINE;
  delete process.env.EVEJS_FRONTIER_WINE;
  try {
    assert.throws(
      () => resolveFrontierPython("/nonexistent/client", "/nonexistent/tools", {
        platform: "linux",
      }),
      /embedded-Python execution is unsupported on linux/,
    );
  } finally {
    if (configuredWine !== undefined) {
      process.env.EVEJS_FRONTIER_WINE = configuredWine;
    }
  }
});

test("external Windows Python keeps its standard library ahead of client modules", () => {
  const buildRoot = path.join("C:", "Frontier", "stillness");
  const environment = windowsExternalPythonEnvironment(buildRoot);
  assert.equal(
    Object.keys(environment).some((key) => key.toUpperCase() === "PYTHONPATH"),
    false,
  );

  const setup = windowsExternalPythonSetup();
  const appendIndex = setup.findIndex((line) => line.includes("sys.path.extend"));
  const ctypesIndex = setup.indexOf("import ctypes");
  assert.notEqual(appendIndex, -1);
  assert.ok(ctypesIndex > appendIndex);
});

test("explicit Wine runner maps POSIX script and output paths to drive Z", () => {
  const invocation = buildPythonInvocation({
    kind: "external-python312-wine",
    command: "/tools/wine-wrapper",
    argsPrefix: ["/tools/python.exe", "-c", "runner bootstrap"],
    env: {},
    description: "test Wine runner",
  }, "/repo/tools/dump.py", ["--request", "/tmp/request.json", "--out", "/tmp/snapshot"]);
  assert.deepEqual(invocation.args, [
    "/tools/python.exe", "-c", "runner bootstrap", "Z:\\repo\\tools\\dump.py",
    "--request", "Z:\\tmp\\request.json", "--out", "Z:\\tmp\\snapshot",
  ]);
});

test("native Python runners preserve absolute script paths", () => {
  const invocation = buildPythonInvocation({
    kind: "external-python312-portable",
    command: "python3.12",
    argsPrefix: [],
    env: {},
    description: "test portable runner",
  }, "/repo/tools/dump.py", ["--out", "/tmp/snapshot"]);
  assert.deepEqual(invocation.args, ["/repo/tools/dump.py", "--out", "/tmp/snapshot"]);
});

test("Wine resolver rejects a wrapper that exits successfully without Python", () => {
  const previousWine = process.env.EVEJS_FRONTIER_WINE;
  const previousPython = process.env.EVEJS_FRONTIER_PYTHON312;
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-wine-probe-"));
  try {
    const emptyScript = path.join(fixture, "not-python.mjs");
    fs.writeFileSync(emptyScript, "// Intentionally does not run Python.\n");
    process.env.EVEJS_FRONTIER_WINE = process.execPath;
    process.env.EVEJS_FRONTIER_PYTHON312 = emptyScript;
    assert.throws(
      () => resolveFrontierPython(fixture, fixture, { platform: "linux" }),
      /without the expected Python 3.12 success marker/,
    );
  } finally {
    if (previousWine === undefined) delete process.env.EVEJS_FRONTIER_WINE;
    else process.env.EVEJS_FRONTIER_WINE = previousWine;
    if (previousPython === undefined) delete process.env.EVEJS_FRONTIER_PYTHON312;
    else process.env.EVEJS_FRONTIER_PYTHON312 = previousPython;
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
