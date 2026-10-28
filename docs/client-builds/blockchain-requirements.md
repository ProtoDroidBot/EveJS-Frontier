# Blockchain requirements by catalogued build

Recorded 2026-10-28. This audit covers all **19 catalogued builds** and their
**21 saved archive variants**, including the three copies of 2702949. Those
copies have identical archive and native Web3-library hashes. Additional
compressed builds outside the catalog are excluded, as requested.

Findings come from archive/member hashes, Python bytecode and protobuf
descriptors, plus static PE inspection of the native EVM signing templates.
No clients, native helpers, chains, Docker deployments or runtime test suites
were run for this audit. Runtime activation, endpoint availability and complete
client acceptance remain unverified.

The [machine-readable evidence](evidence/blockchain-requirements.json) records
the source hashes, per-build requirements and inspected symbols. Wallet
protocol observations and server implementation remain separate: this audit
established the inputs for the [implemented adapters](evm-to-sui.md). All 14 EVM
profiles now have bootstrap/lifecycle adapters; runtime testing is deferred.

## Per-build matrix

| Build | Packaged blockchain path | Configuration and identity requirements | Conversion assessment |
| --- | --- | --- | --- |
| 2455427 | EVM-facing external blockchain proxy | Proxy account/session and password APIs; `tokenMgr`; older blockchain-depot/SSU calls. | Custodial proxy adapter implemented; host staging required. Original external signer remains unresolved. |
| 2615573 | Python 2 ERC2771 wallet | `cfg` is a native JSON **string**; indexed contract entries; `chainTenant` defaults to `devnet`; server recovery encryption; text-hashed object IDs. | JSON-string, bootstrap/recovery and lifecycle adapter implemented; testing deferred. |
| 2702949 | GameClientWeb3, older EVM branch | Exactly two ordered contract entries; direct `system_ids`; ABI parameter `entityId`; text-hashed object IDs. | Ordered-contract, text-hash adapter and bootstrap implemented; testing deferred. |
| 2703993 | GameClientWeb3, older EVM branch | Exactly two ordered contract entries; direct `system_ids`; `entityId`; text-hashed object IDs. | Ordered-contract, text-hash adapter and bootstrap implemented; testing deferred. |
| 2726651 | GameClientWeb3, older EVM branch | Exactly two ordered contract entries; direct `system_ids`; `entityId`; text-hashed object IDs. | Ordered-contract, text-hash adapter and bootstrap implemented; testing deferred. |
| 2730628 | GameClientWeb3, older EVM branch | Exactly two ordered contract entries; direct `system_ids`; `entityId`; text-hashed object IDs. | Ordered-contract, text-hash adapter and bootstrap implemented; testing deferred. |
| 2742057 | GameClientWeb3, older EVM branch | Exactly two ordered contract entries; direct `system_ids`; `entityId`; text-hashed object IDs. | Ordered-contract, text-hash adapter and bootstrap implemented; testing deferred. |
| 2763641 | GameClientWeb3, older EVM branch | Exactly two ordered contract entries; direct `system_ids`; `entityId`; text-hashed object IDs. | Ordered-contract, text-hash adapter and bootstrap implemented; testing deferred. |
| 2814770 | GameClientWeb3, older EVM branch | Exactly two ordered contract entries; direct `system_ids`; `entityId`; text-hashed object IDs. | Ordered-contract, text-hash adapter and bootstrap implemented; testing deferred. |
| 2884873 | GameClientWeb3, newer EVM branch | Named contract entries and `systems` ABI lookup; `smartObjectId`; native object-ID helper; distinct Web3 DLL. | Native-hash configuration and bootstrap adapter implemented; testing deferred. |
| 2898485 | GameClientWeb3, alternate older branch | Named contract entries, but direct `system_ids`; `entityId`; text-hashed object IDs. | Separate direct-ID/text-hash adapter implemented; testing deferred. |
| 2973163 | GameClientWeb3 with world API client | Named contracts, `systems`, `smartObjectId`, native object IDs; tenant/world-API/passphrase RPCs; account bootstrap. | Bootstrap, balance and lifecycle adapter implemented; testing deferred. |
| 2997426 | GameClientWeb3 with world API client | Same native Web3 DLL and lifecycle requirements as 2973163; exact branch code retained in evidence. | Bootstrap, balance and lifecycle adapter implemented; testing deferred. |
| 3122254 | GameClientWeb3 with world API client | Same lifecycle/native requirements; additional public private-key recovery/storage routes. | Bootstrap, external recovery, balance and lifecycle adapter implemented; testing deferred. |
| 3366068 | Sui wallet, provider and signer | Sui network/API-gateway configuration, signer/auth flow and prepared transactions. | Already Sui; no EVM conversion. Older internal sponsored-transaction schemas differ. |
| 3388875 | Sui wallet, provider and signer | Same Sui wallet generation as 3366068, despite its Cycle 5 folder. | Already Sui; no EVM conversion. Older internal sponsored-transaction schemas differ. |
| 3551616 | Sui wallet, provider and signer | Sui network/API-gateway configuration and prepared-transaction workflow. | Already Sui; later internal prepared-transaction fields still differ from 3640684. |
| 3572727 | Sui wallet, provider and signer | Sui network/API-gateway configuration and prepared-transaction workflow. | Already Sui; later internal prepared-transaction fields still differ from 3640684. |
| 3640684 | Sui wallet, provider and signer | Current client protocol baseline plus the server's synchronized Sui deployment. | Existing server baseline; external signer/auth and deployment prerequisites still apply. |

## EVM requirements

### Proxy generation: 2455427

Concrete ERC20 `balanceOf`/`transfer`, native-token and ABI contract read/write
calls establish the EVM-facing behavior. The client delegates account creation,
unlocking, recovery, key export and signing to an external JSON-RPC proxy.
Its packaged defaults include blockchain ID `3537357`, a local proxy at port
`39636`, and a development proxy URL. These are observed defaults, not verified
available services or immutable requirements.

This client has no matching public ERC2771 `MetaTransactionRequest` route.
The implemented proxy translates wallet session/account and `tokenMgr`
association plus SSU online/offline operations into server-authorized Sui actions.
Storage-depot mutations and currency/license operations remain separate work. The
proxy's actual signer and keystore are not established by the packaged client.

### ERC2771 signing and branch-specific configuration

The 13 ERC2771 clients share the inspected public request field numbers and
the native signing type:

```text
ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)
```

The forwarding domain uses `name`, `version`, `chainId` and
`verifyingContract`. Contract addresses, network URLs and domain values come
from configuration. The client packaging does not establish that every build
requires Ethereum mainnet, the same testnet, or the same contract deployment.

Three distinct native DLL hashes occur across the catalogued EVM wallets.
Static inspection verifies the same signing-field schema; it does not prove
equivalent wallet storage, ABI packing or RPC behavior across those binaries.

2997426 and 3122254 add `transaction_hash` as response field 2 to the earlier
`success` field 1. Their lifecycle consumers inspect success, but callers that
need a chain transaction hash cannot infer one from a queued local intent.

The GameClientWeb3 builds consume `encryptionWalletService.get_web3_config()`,
`get_chain_tenant()` and `get_wallet_passphrase(char_id)`. The three existing
relay builds additionally require `get_world_api_base_url()`. Older
GameWeb3Config defaults are gas `300000` and deadline `100` seconds; the
2973163 family defaults are gas `5000000` and deadline `1000` seconds, with a
monolith gas-limit override. These are client defaults, not Sui gas settings.

Configuration differences are mandatory:

- **2615573:** pass `raw.cfg` directly as a native JSON string. The client uses
  indexed contract configuration and monolith `chainTenant`, default `devnet`.
  Recovery consumes server `encrypt_recovery`/`decrypt_recovery` methods.
- **2702949–2814770, as listed individually above:** the Python parser unpacks
  exactly two contract entries in forwarder/world order. `system_ids` maps
  function names directly. The ABI lifecycle argument is named `entityId`.
- **2898485:** contract lookup is by name, but function IDs still come directly
  from `system_ids`, and lifecycle packing still uses `entityId`.
- **2884873 and the three existing relay builds:** function IDs are derived
  from `systems[].abi` signatures and lifecycle packing uses `smartObjectId`.
  2884873 retains its own native helper and initialization behavior.

Object IDs also differ. Build 2615573 and the `entityId` branches hash the
text `item:<tenant>-<game_item_id>`. Build 2615573 additionally hardcodes
`devnet` in its inventory item/type-ID helper. Newer branches call native
`GenerateObjectId`; the current generator uses the inspected 2973163-family
formula `keccak256(abi.encode(keccak256(tenant), uint256(game_item_id)))`.
These mappings cannot be interchanged merely because calldata has one uint256.
Static inspection confirms 2884873's native helper uses the same ABI-based
object-ID formula, despite its different binary hash.

### Wallet startup and other actions

All ERC2771 clients require a character-bound Ethereum wallet and passphrase.
They query `eve_public.blockchain.account.smartcharacter.SmartCharacterExistsRequest`
before treating the chain character as available. If absent, the client signs
character creation and calls `encryptionWalletService.create_smart_character`.
Balance requests use `eve_public.blockchain.account.balance.TokenBalanceRequest`
and its matching notice. These are separate from the newer Sui wallet API.

The implemented bootstrap adapter now supplies those routes and verifies the
live Sui Character/PlayerProfile before reporting existence or successful
creation. Initial enrollment requires a matching signed character-creation
request, not configuration or a reported address alone. 3122254 additionally
consumes the implemented encrypted private-key recovery/storage routes.

Storage, fuel, anchoring, gate actions, currency and dapp requests must retain
their own payload, ownership and confirmation rules when translated. The
2615573 browser provider has a general `eth_*` forwarding path; later inspected
providers expose selected methods and use `eth_getTransactionCount` and
`eth_sendRawTransaction` during transaction submission. Unknown methods in
those later providers are unsupported. An online/offline relay does not
provide an EVM JSON-RPC server or migrate its state.

## Sui requirements

All five Sui profiles contain consuming wallet-service/provider code. Retained
generated EVM descriptors are dormant evidence and do not select the EVM path.
The 109 selected public blockchain/auth/wallet/assembly/sponsored/token message
shapes match the 3640684 baseline across these five builds.

Internal schemas still differ: 3366068/3388875 lack 23 later selected internal
messages and change eight; 3551616/3572727 change three prepared-transaction
internal messages, including later execute-token fields. Public schema equality
does not establish internal service or full gameplay compatibility.

The inspected client globals are `sui_network` (default `testnet`),
`web3_api_gateway_url` (default `https://api.{tier}.pub.evefrontier.com`), and
`smart_assembly_base_dapp_url`. The current server overrides the Frontier
network to `localnet`. The wallet calls the native `zk_signer` process and its
CEF provider; network selection alone does not replace the signer/API gateway.
There is no `sui_chain_id` getter/literal in the inspected Python consumers.

In the development tier, the client reuses `sui_signer_key_pair_v1` from user
settings or derives a key from `SHA512(lower(client_tenant) + ":" + account_id)`.
It passes a development token and `apiGatewayUrl` to `genKeyPair`/`useKeyPair`,
then checks the connected address. A stored key or tenant different from the
server's `dev:<accountId>` derivation will not match the expected owner.
This path does not establish that the native signer can operate offline.

The non-development path requests a nonce-bound JWT, Enoki salt/address and
proof through `JWTTokenRequest`, `CallEnokiZKLoginRequest` and
`CallEnokiZKProofRequest`, verifies the resulting address, and connects/reports
the wallet. The inspected Python exposes those gateway message names and the
API-gateway URL, but not a specific issuer URL or direct Enoki HTTP endpoint.
The current server requires a real `frontierOfficialAuthProvider` for that
authority and only enables its economy/auth handler for 3640684. Local
development key generation does not manufacture official JWTs or proofs.

Existing native lifecycle/storage/fuel compatibility paths include
signature-shape checks. Specific wallet HTTP endpoints and economy token
execution verify signatures cryptographically. Signing support must not be
read as a claim that every native compatibility route has the latter binding.

## Server and Docker prerequisites

These apply whenever the current server executes the translated action on Sui:

- Select one exact Frontier build and compatible static data for the process.
  Bootstrap and the assembly worker now pass the resolved build into world
  validation. Export matching `EVEJS_CLIENT_BUILD` for external launch and world
  synchronization tooling; the Frontier launch scripts normally do this.
- Supply a ready synchronized world configuration through
  `EVEJS_SUI_WORLD_CONFIG_PATH` or the build-specific default
  `_local/frontier-world/<build>/world.private.json`. Its Localnet chain ID,
  package, registry, admin authority and deployment-artifact hashes must agree
  with the live deployment and source workspace. Assemblies need the additional
  deployed world registries/configuration consumed by `suiAssemblySync`.
- The current Sui transport is **Localnet gRPC at localhost/127.0.0.1:9000**.
  A node in a separate Docker container is not automatically reachable at the
  server container's localhost. Network placement must satisfy those addresses;
  the stock Compose file does not define the Sui node or world-artifact mounts.
- The EVM public-gateway relay uses an authenticated matching game session and
  the existing single-account loopback identity resolver. A remote or Docker
  bridge peer is not accepted merely because its request claims a character.
  Ordinary port forwarding does not establish that identity boundary.
- Keep the assembly state worker enabled and its synchronized artifacts
  accessible. A successful relay response acknowledges a recorded intent;
  confirmed Sui execution still comes from worker reconciliation.

The audit establishes what the packaged clients and current server require.
Live client, signer/auth, efctl and Docker acceptance remains the next step.
