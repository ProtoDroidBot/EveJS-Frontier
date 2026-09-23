# Smart Gate links

The assembly control dApp exposes a **Gate** tab at `/client/gate/`. Connect the owner's wallet, load the gate links, then select a destination. Both gates must be completed, owned by the active character, offline, the same type, in different solar systems, and within the source type's client-configured range. The character must be in the source gate's system when changing a link. Slingshot assemblies are handled as one-way Smart Catapults instead of paired gates.

The server reads range values from `spaceComponentsByType`. Build 3502403 specifies Small Gate (88086) and Smart Catapult (95627) at 65 light-years, and Heavy Gate (84955) and Heavy Smart Catapult (95677) at 365 light-years. Distances use solar system coordinates. Missing system data rejects a link; the exact configured boundary is allowed.

## Smart Catapults

A Smart Catapult selects a destination solar system directly; it never needs a
second assembly at the destination. The client-facing assembly RPCs are
`get_available_systems`, `set_destination_system`, `clear_destination`, and
`system_jump`. Only the owner may change the route, the source must be offline,
and the destination must be an existing, distinct, in-range solar system. Any
pilot with an active ship in the source system may use an online configured
catapult. The jump transfers that ship and applies the normal stargate jump
cloak.

World sync anchors the Slingshot through the normal `Gate` contract, then
creates a deterministic `<catapultPackageId>::catapult::Catapult` sidecar from the source Gate
ID. The sidecar stores the source/destination system IDs, exact distance,
revision, and update timestamp. Route mutations are sponsored through
`AdminACL`, require the source Gate offline and unpaired, use optimistic
revision checks, and enforce the shared `GateConfig` range. A zero destination
clears the route. Online use can emit `CatapultJumpEvent` without referencing a
far-side gate.

The catapult is a split feature package. The `catapult` record in `world-features.v1.json` supplies its
current call package, stable type origin, and shared `CatapultRegistry`; the
base-world package continues to own the parent Gate and `GateConfig`. A fresh
deployment publishes `contracts/world_catapult` separately. A compatible
upgrade changes only the catapult call package and preserves its type origin,
registry, and base-world identity. The current Localnet package/registry pair
was verified through public RPC inspection.

The authoritative World Contracts checkout is the pinned `world-contracts` submodule selected by `FrontierWorld.ps1`. Its deployment range configuration must use the same type IDs and meter values; see that checkout's `env.example`. The server also applies the client-authored range before creating a new chain link, so existing deployments can converge without redeployment. A read alone does not overwrite a differing range.

Link and unlink update both in-game endpoints and invalidate their outstanding transition requests. The existing Sui assembly worker mirrors the reciprocal link with its shared transaction journal, owner capabilities, and signed distance proof. It rechecks snapshots before submitting transactions. New dApp links require both gates to be synchronized first.

The World contract accepts a link only when both objects are distinct, offline `Gate` objects of the same tenant and type, both owner capabilities authorize the exact objects, and neither endpoint is already linked. The authorized server's signed proof is bound to the ordered source/destination object IDs, both committed location hashes, the requesting wallet, the configured maximum distance, and a live deadline. A proof issued for another gate pair or an earlier location cannot be replayed to create a link.

The UI shows client range and observed blockchain range separately. An in-game operation can complete while the chain is pending or unavailable; the response explicitly reports this state. **Sync chain** retries reconciliation without repeating the link/unlink mutation. The worker confirms both chain endpoints before reporting a linked pair as synced.

The HTTP API uses a separate signed wallet-session scope:

- `POST /evejs/gates/auth/challenge` and `/auth/session`
- `POST /evejs/gates/:gateID/status` and `/sync`
- `POST /evejs/gates/:gateID/link` with `{ "destinationGateID": 123 }`
- `POST /evejs/gates/:gateID/unlink` with the currently linked `destinationGateID`

Requests require the issued bearer token. Runtime ownership and session checks are repeated after queued work, and stale link selections are rejected. `EVEJS_GATE_DAPP_ORIGINS` can configure the allowed origins; otherwise the existing admin/storage origin settings apply.

Build the server with `npm run build`. Gate runtime regressions run through `node scripts/Tests/run-isolated-tests.js server/tests/frontierSmartGateRuntime.test.js`. HTTP and chain bridge tests run with `node --test server/tests/frontierSmartGateApi.test.js server/tests/frontierSuiGateSync.test.js server/tests/frontierSuiAssemblyGate.test.js server/tests/frontierSuiAssemblyContents.test.js`.
