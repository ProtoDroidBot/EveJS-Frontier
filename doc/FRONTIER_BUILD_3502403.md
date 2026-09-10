# Frontier build 3502403 port candidate

This is an exact-build Windows-client port for Frontier `3502403`, not a
claim of live gameplay acceptance. The supplied `stillness/start.ini`
identifies `appname=FRONTIER`, version `20.04`, build and sync `3502403`,
branch `//frontier/cycle-6`, codename `cycle-6`, and region `ccp`. Its SHA-256
is `8dfe3a1f5779118368c7196305499db2432d4e97c310bf28738f1d954cbe7251`.

Read-only bytecode inspection found MachoNet `489` in
`eve/common/script/net/eveMachoNetVersion.pyc` (member SHA-256
`882931ca6ef09f4ab3bbd33d5297940ae403bda7770cf9677469f1d096af47b0`)
and birthday `170472` in `carbon/common/script/net/GPS.pyc` (member SHA-256
`4457916e3c31202e83646eafe413592b945b3ab3c6432f12a507ac1e8a2f006f`).
The Frontier launcher therefore retains `V20.04@ccp`, MachoNet `489`, and
birthday `170472`.

The untouched `code.ccp` is 118,947,728 bytes with SHA-256
`11b6175ba2e9d6294fbe26debe4a7ab8e83833fa0ddd01190a57b254aebcc619`;
`manifest.dat` has SHA-256
`b9393bc55657e98c4f4ded5917cba1574bc1c163b201e54643f9e9044ca71995`.
Its 11,432 unique bytecode members match the `3488090` module set. Of those,
11,431 differ only in their 16-byte `.pyc` headers; the sole code-body change
is a client-only Industry Facility page layout with no RPC, protobuf,
handshake, or transport-surface change.

## Runtime and launcher selection

`StartFrontierServer.ps1`, `PlayFrontier.ps1`, `StopFrontier.ps1`, and the
Frontier server-test runner now default to `3502403`. Setup and staging still
discover the installed build independently. The conventional EVE Online
configuration remains on `3396210`; Frontier handshake values are scoped
launcher environment overrides.

The macOS shell workflow remains on its last accepted build, `3467658`, and
its `blue.so` path. It is not a Linux or Wine gameplay launcher. Build outputs
and mutable runtime data remain isolated beneath build-numbered roots:

```text
_local/frontier-sde/3502403
_local/frontier-contracts/3502403
_local/frontier-gameStore/3502403/data
_local/frontier-runtime/3502403/gameStore
```

No patch command was run against the supplied client. Native blue and
`code.ccp` were inspected only with the read-only status/`--check` paths, and
all three checks reported the exact unmodified `source` state. Extraction
wrote repository-local `_local` artifacts only.

## Exact client patch profiles

The native profile is
`tools/frontier-client/blue-pyd.3502403.patch.json`. It fails closed on any
source, context, PE layout, certificate overlay, or derived-target mismatch.

- Source `bin64/blue.pyd`: 6,094,472 bytes, SHA-256
  `4ad88b947517e2f4f5d29c098fa78ed0f9d4d458db22096260a3e70e165a9cc0`.
- Indexed cache source: `ResFiles/5b/5baa6098ac19f0c6_82cd35d6e53a59df73e4f82c847013c2`,
  MD5 `82cd35d6e53a59df73e4f82c847013c2`.
- Derived target: 6,084,096 bytes, SHA-256
  `2dcfd00d4b84534abecf7f4cb3be09209fb2bac85377066cb8e18fe32131de82`.
- Verifier edit: file offset `0x00196846` (1,665,094), RVA `0x00197446`,
  replacing `0f95c0` with `b00190`; the certificate overlay is then stripped
  and the PE checksum recalculated.

The exact Python 3.12 bytecode profiles are:

| Module | Source member / code SHA-256 | Patched member / code SHA-256 |
|---|---|---|
| `menucheckers/celestialCheckers.pyc` | `d59078c9f211bc4550d8646161143579d1246c19c1679a56d5a54a6a44fe6106` / `e245683a5b71af8aca437f0937fe5859cf75fb8b09229298d0822024d8ece149` | `00c2453b7fb4e5bd1a1547aa1d3d5d4de7caf353f8ab6e76e334fba0ef16bfeb` / `3c796da8d97279f550f96c045427f1e9c834181a482c92407e4322cf57b7c742` |
| `frontier/beta.pyc` | `15843490ea0d78341a5497edef6b69c7450f5a15c384e18671eb1939d2332cce` / `5280137bf5d4a200b8da21524069605ae9faf8e6ebbcbd3c0ace46edd8e580ca` | `a5f0e3078167548bcc37150d640e6d9b64e028d82b0b6f9cbad490719c485272` / `5d53d39d3d1ca156d124540d99c7c771b7ab331a215558bb36f612a48d078495` |
| `frontier/shell/common/const.pyc` | `e1808d6561d11adea4796ca319422e723df7d847008be17356e4877f88ea81b3` / `e7a195fbc655411a1ee49abc37a44e0a8a30287cf621165d064de28622c6aa61` | `e84944957f88aae34938814f5a5ed563fc5412e7688371b0893ea87a06f70672` / `d81eed85f3c888fe31025c1420a7f6fbf7bf7d23cee34d409a245a04f2eb0437` |

The docking profile changes only `DOCKING_DISABLED`. The feature profile
changes the six selected `frontier.beta` gates and only
`HIDE_SHELL_IMPLANT_SYSTEM` in the shell constants; it does not blanket-enable
unimplemented client surfaces.

## Static data, contracts, and database

The validated static snapshot contains 1,148,579 records across 35 JSONL
outputs: 24,026 systems, 113,253 landscape sites, 32,626 raw types, and 7,072
stargates. Its sorted output-map identity is
`95da338a6ff66846d66a02cda12dd4f13fc4e1e0264389b521badbe2c7ce1129`
(SHA-256 of the compact, lexically sorted mapping from output name to
`{records, sha256}`).

Compared with `3488090`, only `_sde.jsonl` build metadata and `mapJumps.jsonl`
changed. Exactly 337 `jumpID` values and their output keys were reassigned; the
3,536 jump records retain identical endpoint, coordinate, stargate, and jump
type topology.

The public contract export contains 166 descriptor files, 166 protobuf
members, zero failed descriptors, and 238 selected client modules. The
protobuf descriptor set and JSON are bit-identical to `3488090`:

- `frontier-public-protos.pb`:
  `c0f6e31a7a818775315b777dbea0ec941e2dd1487779ddbbccb9ebc6bfd2128d`
- `frontier-public-protos.json`:
  `d827ae732a95a1ac6d6136e08948919f9388abfe08a0c279da0ad030cc877f8e`

The generated Frontier database passed its build/profile, table-count,
bootstrap, Rift, Tallyport, and Relay authority validation. The implemented
gateway roots also matched the actual export: core 18 messages/24 fields,
assembly gate 17/28, network node 24/38, and storage unit 24/42, with no
optional client-only fields on those messages.

## Offline verification (2026-09-09)

Verification used Node `24.13.0` and Python `3.12.3`:

- both TypeScript configurations built and typechecked;
- Frontier static tests: 32 passed;
- build-selection runner tests: 3 passed;
- non-Windows launcher/runtime checks: 4 passed, with 3 Windows-only checks
  skipped on Linux;
- isolated game-store checks: 2 passed;
- emitted TypeScript runtime checks: 3 passed;
- exact client-profile tests: 30 passed against the actual `3502403` archive,
  with all mutations confined to temporary copies;
- exact copies of the native module and indexed cache entry completed the
  patch, target check, idempotent second pass, and backup-bound restore cycle;
- a full temporary copy of `code.ccp` patched and rechecked successfully;
  all 11,437 ZIP entries (11,432 unique names and five duplicates) remained
  readable, and a second patch pass was byte-for-byte idempotent;
- actual exported gateway contracts: 4 passed;
- Frontier server regressions: 220 passed, zero failures or skips, against a
  disposable copy of the generated `3502403` database.

The Windows-client static extraction used the installed native FSD loaders
through Windows Python 3.12.14 in a disposable Wine/GE-Proton environment.
This was read-only with respect to the client: no game executable or existing
game prefix was launched, and it is not evidence of Linux/Wine gameplay.

## Remaining acceptance

No live client/server session was started for `3502403`. The latest recorded
Windows smoke acceptance remains `3474408`; the last accepted macOS build
remains `3467658`. A native Windows pass must still cover the exact staged
trust check, handshake, login and character selection, rendered space,
flight/warp/docking, Creation fitting and reload/unload, XMPP/TLS gateway,
Smart Storage, Heavy Gate, and HUD/map interactions before `3502403` can be
described as gameplay-validated.
