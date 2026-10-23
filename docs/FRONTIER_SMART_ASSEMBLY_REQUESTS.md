# Frontier smart-assembly request bus

Every completed smart assembly uses the same durable server-side request bus in
`smartAssemblyRequestRuntime.ts`. The bus is assembly-type agnostic: network
nodes, storage units, industry facilities, gates, turrets, and future assembly
types are identified by their shared `evejsFrontierConstruction` state rather
than a type-ID allowlist.

## Request lifecycle

1. An online source calls `createRequest(sourceID, targetID, requestType, options)`.
2. The destination sees the request through `listRequests` or the monotonic
   `listSignals` journal. Signal reads report the oldest retained sequence and
   whether the caller's cursor fell behind retention, allowing a safe queue
   resnapshot after a gap. In-process assembly runtimes may use
   `subscribeToSignals`; callbacks only run after the transition is durably
   committed and cannot roll it back.
3. The destination calls `claimRequest`, receiving a short-lived claim token.
4. It calls `fulfillRequest` or `failRequest` with that token. It may renew or
   release the claim while work is in progress.

Expired claims automatically return to `queued`. Expired requests become
terminal. Dismantling either participant cancels its pending requests. Client
request UUIDs are idempotency keys: replaying the same command returns the
existing request, while reusing an ID for different work is rejected. Exact
fulfil/fail retries are also idempotent, including after the destination goes
offline, while a different result for an already-completed claim is rejected.

Server assembly runtimes can register a named handler and call
`processNextRequest`. This claims and completes the highest-priority compatible
request in one worker flow. The native `smartAssemblyService` exposes matching
create/list/signal/claim/renew/release/fulfil/fail/cancel RPC handlers.

`logistics.transfer` is reserved for the autonomous server consumer described
below. Clients can create, inspect, and cancel these requests; they cannot
claim, renew, release, fail, or fulfil them. A generic registered handler cannot
consume this reserved type while the logistics worker owns it.

## Operational status signals

The same monotonic signal journal also carries idempotent `status_changed`
entries. A status record is keyed by assembly and signal type, stores its latest
revision durably, and emits only when its canonical value changes. Network Nodes
publish `network_node.resources` with independent `fuel` and `power` dimensions:

- fuel is `empty`, `low` (at or below 20% volume), or `normal`;
- power usage is `offline`, `low` (0-50%), `medium` (>50-80%), `high`
  (>80-100%), or `over_limit`;
- a rejected power reservation includes `NETWORK_NODE_ENERGY_EXCEEDED`, the
  requesting assembly, requested energy, and `POWER_LIMIT_EXCEEDED` in
  `activeFlags`.

Keeping both dimensions in one structured value means a low-fuel warning and a
high/over-limit power warning coexist instead of competing priority flags.
Consumers may read the current record with `getAssemblyOperationalStatus` and
use `listSignals` for ordered transitions and recovery after disconnects.

The persistent NPC integration and phased consumer rules are defined in
`doc/NPC_BEHAVIOR_PHASES.md` under “Cross-phase network-node signal contract.”
Signals wake or reprioritize durable work; NPC callbacks do not mutate fuel,
energy reservations, assembly state, or travel state directly. NPC consumers
must persist sequence/revision cursors, resnapshot when `listSignals` reports
`truncated`, and fetch exact canonical resource state before acting.

## Priority model

Urgency is a scalar (`BACKGROUND`, `NORMAL`, `HIGH`, or `CRITICAL`). Priority
flags are independent reasons or lanes, allocated once in the shared
`ASSEMBLY_REQUEST_PRIORITY_FLAG` registry:

- `SAFETY_CRITICAL`
- `PLAYER_INITIATED`
- `DEFENSE`
- `LOGISTICS`
- `PRODUCTION`
- `MAINTENANCE`
- `ENERGY`
- `NAVIGATION`
- `INTELLIGENCE`

Flags can be combined, but they do not change ordering. This prevents invalid
combinations such as separate LOW and HIGH flags and prevents assembly-specific
modules from assigning the same bit different meanings. Queue ordering is
urgency descending, then creation sequence ascending for deterministic FIFO
within an urgency.

Requests are same-owner by default. Internal trusted callers may explicitly
opt into cross-owner delivery, but the player RPC does not expose that option.

## NPC faction requests

Phase 3 NPC requests use a faction-registered, online command node as their
source. The server verifies that both source and target carry the same faction
registration before it enables the request bus's internal cross-owner path.
The request records the durable NPC character and confirmed Sui `NpcProfile`
as operator metadata; it does not impersonate a player session.

Faction membership cannot be asserted with a caller-provided boolean. The
server validates the current shared Sui transponder-commitment object and the
private code/salt bundle, then issues a random, short-lived in-memory receipt.
That receipt is bound to the NPC, faction, command node, target, request type,
and request UUID. Only the public commitment object ID, revision, and faction
scope enter the durable request. Plaintext codes, salts, commitment preimages,
and receipt tokens are never stored in the request table or NPC job state.

## Sui chain attestations

When the Sui assembly sync bridge is active, a request is not claimable until
it has a verified creation attestation. The attestation is a raw Sui
`PersonalMessage` signed by the world's Ed25519 server key. Before issuing or
accepting one, the bridge reads the deployed `ServerAddressRegistry` and checks
its dynamic table to ensure that the signer is currently authorized.

The signed BCS message binds all of the following:

- chain ID, world package, object registry, and server-address registry;
- request UUID and a SHA-256 commitment to every immutable request field;
- source and destination local assembly IDs;
- source and destination Sui object ID, version, and digest;
- issue/deadline times and the authorized server address.

Fulfilment, failure, and cancellation add a second signed receipt. Its outcome
commitment covers the exact terminal value and its `previousAttestationHash`
links it to the creation proof. The queue stores both proofs with the durable
request. A proof is checked again before claim or completion, so copying a
request between worlds, changing its payload, substituting an assembly object,
or replaying another outcome is rejected. Administrative assembly removal is
recorded as `revoked_locally`, because teardown cannot wait for an asynchronous
chain receipt.

This intentionally uses signatures rather than a zero-knowledge proof. There
is no private witness in a queue request: the required property is that an
authorized world server attested to a public request and exact on-chain object
references. A zk circuit would add proving and verification complexity without
hiding data or strengthening that authorization. The BCS message and Sui
intent signature are directly compatible with the world's existing Move
signature-verification convention if a future contract consumes these receipts
on chain.

## Autonomous item logistics

The server starts `assemblyLogisticsWorker.ts` after assembly synchronization
starts. It polls every second, serializes passes, and retries transient failures
after five seconds. No player login, ship, bound inventory RPC, or open assembly
window is required. Shutdown stops new passes and prevents delayed chain
callbacks from starting an inventory commit. Already committed work remains
recoverable from its receipt. The worker does not discover suppliers or create replenishment
policies: assembly/NPC logic chooses the supplier and calls the trusted helper:

```js
const { requestAssemblyItems } = require("./assemblyLogisticsRuntime");
const request = await requestAssemblyItems(
  requesterAssemblyID, supplierAssemblyID, typeID, quantity,
  { requestID: durableJobUUID, expiresInMs: 300_000 },
);
```

Persist one UUID per intended transfer in the calling job and reuse it on
retry. Request **source** means requester/receiver; request **target** means
supplier. The inventory move goes from target to source. A successful create
acknowledges durable queueing, not a completed transfer; inspect the terminal
request or its `fulfilled` signal for completion.

The native `smartAssemblyService.create_request` accepts the same type with
`payload: { typeID, quantity, supplierLaneID?, requesterLaneID? }`. Quantities
must be positive integers within uint32. Lanes default to 1. No other payload
keys are accepted. The authenticated session supplies the actor; callers cannot
override owners, inventory flags, access grants, or chain mode. The trusted
helper defaults to the requester owner's player/NPC identity and can take an
explicit trusted `actor`. Only its kind and ID are persisted; access resolution
reloads current memberships and grants when executing. Existing generic
logistics records without this actor metadata are rejected, not upgraded into
authorized transfers.

The first implementation supports these same-owner inventory routes:

| Endpoint | Supplies from | Receives into | Capacity rule |
| --- | --- | --- | --- |
| Smart Storage Unit | Owner partition, flag 66 | Owner partition, flag 66 | Authored storage volume |
| Smart Turret | Cargo, flag 0 | Cargo, flag 0 | Authored cargo volume |
| Field Storage | Cargo, flag 0 | Cargo, flag 0 | Authored cargo volume and add/take component permissions |
| Industry | Selected lane's output escrow | Selected lane's input escrow | Selected blueprint's per-type maximum |

Both endpoints must be completed, online, owned by the request owner, located
in the same solar system, and within 5,000 metres center-to-center. Field
Storage's authored access range can further restrict that distance. The actor
needs `inventory.withdraw` on the supplier and both `operate` and
`inventory.deposit` on the requester. Industry currently requires the actor to
be the facility owner; generic inventory grants cannot bypass its lane policy.
All checks, including lease validity and capacity, run again after asynchronous
chain refresh and immediately before the synchronous inventory commit.

Network Node virtual fuel, ships, arbitrary space objects, singleton items,
shared SSU partitions, and cross-owner custody are outside this consumer's
scope. Cross-owner delivery on the generic request bus does not authorize
cross-owner inventory movement; that still requires the separate custody flow.

### Durability and recovery

Queue transitions are flushed before acknowledgment or signal publication.
The item store selects stacks deterministically and commits all source changes,
destination changes, and the operation receipt in one item-table write and
flush. Insufficient stock or destination capacity moves nothing. Failed writes
or flushes restore the previous snapshot; failed rollback keeps the store from
acknowledging speculative state until persistence recovers.

The durable receipt lives on the receiving assembly, independently of moved
cargo. It binds the request UUID, actor, endpoint IDs, owners, flags, item type,
quantity, lanes, and synchronization context. Reusing the UUID with different
work fails. Consuming or moving received cargo does not remove this evidence.
Before checking current queue status, access, leases, or stock, the worker
looks for this receipt. If a crash occurred after items moved but before queue
completion, it reconciles the receipt and completes the existing request
without moving items again. Cancellation or expiry after the commit does not
reverse it. Terminal logistics requests are retained until this reconciliation
has run; committed receipts remain beyond queue-history retention.

Sui-backed endpoints use the existing shared assembly authority worker and
inventory mirrors. Both mirror confirmations must match the same deployment;
the request remains pending while chain synchronization is unavailable. This
is a durable game-store commit followed by chain reconciliation, not a single
atomic transaction spanning SQLite and Sui. Turret inventory remains local,
with chain lifecycle validation. Mixed local/Sui routes still validate the
Sui-backed endpoint; their queue attestation mode is classified by the server
because a local Field Storage has no Sui object reference to sign.

For all-Sui requests, actor and attestation mode are part of the signed
creation commitment. Recovery of an already committed receipt can verify an
expired creation proof; new work still requires an unexpired proof. World,
signature, and currently authorized signer checks remain in force, including
after server-key rotation. If an endpoint is removed, changes ownership, or
cannot supply the required chain confirmation after the game commit, recovery
stays pending for reconciliation. It never repeats or silently reverses the
inventory move. Local receipt recovery does not require endpoints to remain
online or access grants to remain active.

Inventory and assembly UI notices are best-effort after commit. Notification
failure cannot turn a durable move into a retry; reconnecting clients reload
the authoritative inventories.
