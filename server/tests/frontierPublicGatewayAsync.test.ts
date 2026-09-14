"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter, once } = require("node:events");
const gateway = require("../src/_secondary/express/publicGatewayLocal");
const { RequestEnvelope, ResponseEnvelope, gatewayServiceRegistry } = gateway._testing;

const REQUEST_TYPE = "eve_public.assembly.storageunit.api.PrepareDepositItemsRequest";
const RESPONSE_TYPE = "eve_public.assembly.storageunit.api.PrepareDepositItemsResponse";

function request(correlation: number) {
  return Buffer.from(RequestEnvelope.encode(RequestEnvelope.create({
    correlation_uuid: Buffer.alloc(16, correlation),
    authoritative_context: { identity: { character: { sequential: 140000003 } } },
    payload: { type_url: `type.googleapis.com/${REQUEST_TYPE}`, value: Buffer.alloc(0) },
  })).finish());
}

class TestStream extends EventEmitter {
  destroyed = false;
  closed = false;
  writes: Buffer[] = [];
  respond() {}
  write(buffer: Buffer) { this.writes.push(buffer); }
  end() { this.closed = true; this.emit("finished"); }
}

test("Requests.Send waits for asynchronous handlers before ending and preserves request order", async (t) => {
  let completeFirst: (value: any) => void;
  let calls = 0;
  const success = { statusCode: 200, statusMessage: "", responseTypeName: RESPONSE_TYPE, responsePayloadBuffer: Buffer.alloc(0) };
  t.mock.method(gatewayServiceRegistry, "handleRequest", () => {
    calls++;
    return calls === 1 ? new Promise(resolve => { completeFirst = resolve; }) : Promise.resolve(success);
  });
  const stream = new TestStream();
  assert.equal(gateway.handleGatewayStream(stream, { ":path": "/eve_public.gateway.Requests/Send" }), true);
  const finished = once(stream, "finished");
  stream.emit("data", Buffer.concat([gateway.createGrpcFrame(request(1)), gateway.createGrpcFrame(request(2))]));
  stream.emit("end");
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(stream.closed, false);
  assert.equal(stream.writes.length, 0);
  completeFirst(success);
  await finished;
  assert.equal(calls, 2);
  assert.equal(stream.writes.length, 2);
  for (let index = 0; index < stream.writes.length; index++) {
    const response = ResponseEnvelope.decode(stream.writes[index].subarray(5));
    assert.equal(response.status_code, 200);
    assert.deepEqual(Buffer.from(response.correlation_uuid), Buffer.alloc(16, index + 1));
    assert.equal(response.payload.type_url, `type.googleapis.com/${RESPONSE_TYPE}`);
  }
});

test("Requests.Send returns an error envelope for a rejected asynchronous mutation", async (t) => {
  t.mock.method(gatewayServiceRegistry, "handleRequest", async () => { throw new Error("chain read failed"); });
  const stream = new TestStream();
  gateway.handleGatewayStream(stream, { ":path": "/eve_public.gateway.Requests/Send" });
  const finished = once(stream, "finished");
  stream.emit("data", gateway.createGrpcFrame(request(3)));
  stream.emit("end");
  await finished;
  assert.equal(stream.writes.length, 1);
  const response = ResponseEnvelope.decode(stream.writes[0].subarray(5));
  assert.equal(response.status_code, 500);
  assert.match(response.status_message, /chain read failed/);
});
