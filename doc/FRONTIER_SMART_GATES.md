# Smart Gate links

The assembly control dApp exposes a **Gate** tab at `/client/gate/`. Connect the owner's wallet, load the gate links, then select a destination. Both gates must be completed, owned by the active character, offline, the same type, in different solar systems, and within the source type's client-configured range. The character must be in the source gate's system when changing a link. Slingshot gates do not support paired links.

The server reads range values from `spaceComponentsByType`. Build 3502403 specifies Small Gate (88086) at 65 light-years and Heavy Gate (84955) at 365 light-years. Distances use solar system coordinates. Missing system data rejects a link; the exact configured boundary is allowed.

The authoritative World Contracts checkout is `../3502403/world-contracts`, selected by `FrontierWorld.ps1`. Its deployment range configuration must use the same type IDs and meter values; see that checkout's `env.example`. The server also applies the client-authored range before creating a new chain link, so existing deployments can converge without redeployment. A read alone does not overwrite a differing range.

Link and unlink update both in-game endpoints and invalidate their outstanding transition requests. The existing Sui assembly worker mirrors the reciprocal link with its shared transaction journal, owner capabilities, and signed distance proof. It rechecks snapshots before submitting transactions. New dApp links require both gates to be synchronized first.

The UI shows client range and observed blockchain range separately. An in-game operation can complete while the chain is pending or unavailable; the response explicitly reports this state. **Sync chain** retries reconciliation without repeating the link/unlink mutation. The worker confirms both chain endpoints before reporting a linked pair as synced.

The HTTP API uses a separate signed wallet-session scope:

- `POST /evejs/gates/auth/challenge` and `/auth/session`
- `POST /evejs/gates/:gateID/status` and `/sync`
- `POST /evejs/gates/:gateID/link` with `{ "destinationGateID": 123 }`
- `POST /evejs/gates/:gateID/unlink` with the currently linked `destinationGateID`

Requests require the issued bearer token. Runtime ownership and session checks are repeated after queued work, and stale link selections are rejected. `EVEJS_GATE_DAPP_ORIGINS` can configure the allowed origins; otherwise the existing admin/storage origin settings apply.

Build the server with `npm run build`. Gate runtime regressions run through `node scripts/Tests/run-isolated-tests.js server/tests/frontierSmartGateRuntime.test.js`. HTTP and chain bridge tests run with `node --test server/tests/frontierSmartGateApi.test.js server/tests/frontierSuiGateSync.test.js server/tests/frontierSuiAssemblyGate.test.js server/tests/frontierSuiAssemblyContents.test.js`.
