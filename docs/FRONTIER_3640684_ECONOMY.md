# Build 3640684 economy and Digital Chemistry

The server now implements the target wallet, token exchange, relay lens purchase,
feral-data sale and Digital Chemistry RPCs. These are local emulator workflows;
no external chain transactions are submitted. Official JWT/Enoki endpoints return
`OFFICIAL_AUTH_PROVIDER_UNAVAILABLE` unless a real provider is explicitly supplied.

## Contracts and authority

`economy3640684.proto.json` is the transitive descriptor subset extracted from the
provided client archive. It includes wallet addresses, all three exchange mutation
requests, relay prepare/execute, wallet-reported events and the three zklogin
requests. The gateway uses authenticated transport identity, then checks the
character's account and server-established Sui wallet binding. Reporting a wallet
never changes that binding. A requested different wallet is rejected.

LUX remains the character balance. EVE tokens use a separate persistent ledger,
in atomic units (1 EVE = 1,000,000,000 units). Conversion is exact to the server's
cent precision; smaller or nonrepresentable amounts fail explicitly. Default
**local emulator policy**, configurable through `frontierEconomyPolicy`, is:

- 1 EVE exchanges for 1 LUX (`luxCentsPerToken: 100`).
- Each lens costs 1 EVE (`lensPriceAtoms: "1000000000"`).
- Each feral-data unit sells for 1 LUX (`feralDataLuxCents: 100`).
- Prepared operations expire after five minutes (`prepareExpiryMs: 300000`).

These prices are server policy, not values invented as client catalog evidence.
The target derives feral prices from `feral_data_price` and lens prices from
`GetPriceResponse`. Operators should expose the same feral value in client
configuration. Target type IDs are 72244 (feral data), 77518 (3x lens), and 90184
(relay); relay authorization verifies real assembly status, access policy, current
system, visibility and a 5 km local interaction radius.

Prepared operations serialize valid Sui `TransactionData` BCS. Its only pure
input identifies the `evejs-local-economy-intent-v1` action, owner, amount and
expiry; there are no commands or gas payment, and the budget is zero. This lets
transaction-signing interfaces parse and sign the challenge without granting a
chain transfer. The server verifies the real Sui signature over those exact bytes
against the bound wallet and rechecks the receipt after the asynchronous verify.
Returned transaction identifiers start with `local:` and are local receipts.
SDK parsing and cryptographic verification are tested; native signer process/UI
acceptance still requires a live client run.

Ledger mutations, character balance changes and inventory receipts commit in one
SQLite transaction through opaque, owner-prepared row proposals. Exchange
correlation IDs prevent repeated immediate conversion; prepared operation IDs
prevent repeated execution. Failure or expiry cannot debit funds or create items.

## Digital Chemistry

The read-only exporter `tools/frontier-static/export-economy-catalog.py` verifies
resource hashes and parses the target loaders' layouts. The shipped catalog
contains exactly one recipe: **2, Basic Sand**. It consumes one Silica (96713) and
two Water (96717), producing one Sand (96030), with ten seconds per multiplier.
The output's property 2 is the authored linear combination of the inputs'
property 13, and must remain in the output type's declared range.

`digitalChemistry.list_recipes`, `preview`, `start`, `get_jobs` and `discontinue`
use the target dictionary keys and numeric slot indices. Inputs must be distinct,
owned, reachable stackable items of the authored types. Start atomically consumes
inputs into durable job escrow and freezes the plan. Completion atomically grants
new variant stacks and stops the job. Completed-job retries cannot create another
output. A blocked delivery remains pending; it retries when inventory becomes
available. Early discontinuation refunds inputs once and produces no recipe
output. The server checks due jobs for live sessions each second and when queried;
offline/restarted jobs catch up on the next live session/query.

The existing inventory uses whole units. Fractional multipliers are rejected
explicitly; there is no global fractional-stock migration. Legacy inputs lacking
variant records receive reproducible local properties derived from stack identity
within the client-authored ranges. Their source properties and output variants
persist with the job. This deterministic migration policy does not claim to
reproduce the official server's property RNG. Zero static volume of these target
neotypes is preserved; a general dynamic mass/volume inventory migration remains
outside this compatibility layer.

## Verification

`server/tests/frontierEconomy3640684.test.ts` exercises exact schema field widths,
real signatures and BCS decoding, wallet isolation, amount/idempotency/expiry
checks, restart recovery, injected SQLite rollback, inventory deletion, lens and
feral transactions, authored chemistry timing/refunds/variant output, native
error class and stale character-balance proposals. Run it through the repository's
disposable-store runner with `--test-isolation=none`. These are server/contract
tests; they do not establish native client launch or UI acceptance.

The target's existing wallet service initializes on character selection. With no
official user token, `monolithconfig.get_client_tier()` selects `dev` and the
native signer uses its local `gen_key_pair` / `use_key_pair` path. Its
SHA-512 seed input is the lower-case tenant plus `:` plus account ID, matching
the server's existing local wallet derivation with the launcher's `/tenant=dev`.
The server validates that established wallet binding when the native
`wallet.api.Reported` event arrives. This contract evidence does not establish
that the native signer process has run successfully on this host.

## Exact client staging

`blue-pyd.3640684.patch.json` now pins the supplied Windows PE source and its
independently derived patched target. The verifier's unwind bounds, result
normalization branch, and `UnpackManifest` call/result test were decoded from this
build, rather than reusing old offsets. The existing stage utility applies this
profile only to exact source bytes and retains its rollback/checksum/cache
safeguards. Exact docking and feature module hashes also cover this build; only
station docking and the previously supported narrow flags are changed. Legacy
3502403 custom code adapters are not injected into the new native modules.

`StartFrontierServer.ps1 -Build 3640684` and the shell launcher's equivalent select
`cycle-7`, matching Macho 489/version20.04. Defaults remain on their previously
supported builds until native acceptance. The supplied client is a Windows build;
no macOS3640684 binary profile is asserted.

The supplied installation passed `verify_3640684_stage.py` using disposable copies:
exact native target, repeat-patch idempotency, tamper rejection, three changed
archive modules and 11,676 unchanged modules. Original archive/blue/start.ini
hashes stayed unchanged. The report is
`_local/feature-audit-3640684/stage-copy-verification.json`. A native Windows/Bottles
launch, signer process and UI acceptance pass remain unverified.
