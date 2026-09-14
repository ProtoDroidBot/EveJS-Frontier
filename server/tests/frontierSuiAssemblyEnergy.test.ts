import assert = require("node:assert/strict");
import { test } from "node:test";
import { createSuiAssemblyChain } from "../src/services/frontier/suiAssemblyChain";
import { createAssemblySyncWorker, createSuiAssemblyEnergyMutationRunner, runSuiAssemblyEnergyMutation } from "../src/services/frontier/suiAssemblySync";

function fixture(options: { invalidValue?: string; missing?: boolean; repeatedCursor?: boolean; size?: string } = {}) {
  let executions = 0;
  const pages: any[] = [];
  const client: any = {
    async getObject() {
      return { data: { content: { dataType: "moveObject", fields: {
        assembly_energy: { fields: { id: { id: "0x99" }, size: options.size ?? "2" } },
      } } } };
    },
    async getDynamicFields(request: any) {
      pages.push(request);
      return { data: [{ name: { type: "u64", value: request.cursor ? "77917" : "90184" } }],
        hasNextPage: !request.cursor || !!options.repeatedCursor, nextCursor: "cursor-1" };
    },
    async getDynamicFieldObject({ name }: any) {
      if (options.missing) return { error: { code: "dynamicFieldNotFound" } };
      return { data: { content: { dataType: "moveObject", fields: {
        name: name.value, value: options.invalidValue ?? (name.value === "77917" ? "500" : "1"),
      } } } };
    },
  };
  const chain = createSuiAssemblyChain({ client, tenant: "dev",
    world: { packageId: "0x1", objectRegistryId: "0x2", adminAclId: "0x3", energyConfigId: "0x4", fuelConfigId: "0x5" },
    async execute() { executions++; },
  });
  return { chain, pages, executions: () => executions };
}

test("reads every deployed energy table page without submitting balance changes", async () => {
  const f = fixture();
  assert.deepEqual(await f.chain.readEnergyRequirements(), [
    { typeID: 77917, energyRequired: 500 }, { typeID: 90184, energyRequired: 1 },
  ]);
  assert.deepEqual(f.pages.map(page => page.cursor), [null, "cursor-1"]);
  assert.equal(f.executions(), 0);
});

test("incomplete, unsafe or changing energy tables fail before returning a replacement", async () => {
  await assert.rejects(fixture({ missing: true }).chain.readEnergyRequirements(), /Cannot read energy requirement/);
  await assert.rejects(fixture({ invalidValue: "9007199254740992" }).chain.readEnergyRequirements(), /Cannot read energy requirement/);
  await assert.rejects(fixture({ size: "3" }).chain.readEnergyRequirements(), /changed during reading/);
  await assert.rejects(fixture({ repeatedCursor: true }).chain.readEnergyRequirements(), /pagination did not advance/);
});

test("energy connection mutations wait until captured snapshots finish anchoring", async () => {
  const events: string[] = [];
  let finishAnchor: () => void;
  const gate = new Promise<void>(resolve => { finishAnchor = resolve; });
  const worker = createAssemblySyncWorker({ report() {}, async reconcile() {
    events.push("capture");
    await gate;
    events.push("anchor");
  } });
  const scan = worker.runOnce();
  const runner = createSuiAssemblyEnergyMutationRunner({ runExclusive: worker.runExclusive,
    getContext: () => ({ synced: { network: "localnet" }, async assertCurrent() { events.push("validate"); } }),
    hasPrepared: () => false,
  });
  const mutation = runner(() => { events.push("connection"); return 42; });
  assert.deepEqual(events, ["capture"]);
  finishAnchor();
  await scan;
  assert.equal(await mutation, 42);
  assert.deepEqual(events, ["capture", "anchor", "validate", "connection"]);
  await worker.stop();
});

test("energy mutations reject missing or changed deployments and outstanding signatures", async () => {
  let context: any = null;
  let prepared = false;
  let called = false;
  const operation = () => { called = true; };
  const runner = createSuiAssemblyEnergyMutationRunner({ runExclusive: operation => operation(),
    getContext: () => context, hasPrepared: () => prepared,
  });
  const errorCode = (code: string) => (error: any) => error.code === code;
  await assert.rejects(runSuiAssemblyEnergyMutation(operation), errorCode("DEPLOYMENT_UNAVAILABLE"));
  await assert.rejects(runner(operation), errorCode("DEPLOYMENT_UNAVAILABLE"));
  context = { synced: { network: "localnet" }, async assertCurrent() { throw new Error("changed"); } };
  await assert.rejects(runner(operation), errorCode("DEPLOYMENT_UNAVAILABLE"));
  context.assertCurrent = async () => {};
  prepared = true;
  await assert.rejects(runner(operation), errorCode("SPONSOR_BUSY"));
  prepared = false;
  context.executor = { hasPending: () => true };
  await assert.rejects(runner(operation), errorCode("SPONSOR_BUSY"));
  assert.equal(called, false);
});
