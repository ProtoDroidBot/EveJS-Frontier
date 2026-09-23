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
