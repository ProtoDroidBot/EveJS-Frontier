# Server build profiles

The server has an exact-build profile catalog with 19 audited Frontier builds
and 22 observed client features. The catalog is a scaffold for adding version
support. Historical profiles still need their own protocol, runtime and static
data validation before they can be considered compatible.

One profile applies to a server process. The server advertises its version
before receiving the client's version, and its services, descriptors and world
state are shared. This does not add simultaneous mixed-build sessions.

## Selecting a profile

`clientBuildProfile` defaults to `auto`. This preserves the existing boot
settings and launch scripts. In Frontier mode, an exact catalogued
`clientBuild` is identified for inspection; unknown builds retain manual
configuration. Resolution never chooses a nearby build or inherits features
from a numeric range.

To select an audited identity explicitly, set the environment variable before
starting the server, or add the corresponding key to the server's JSON config:

```sh
export EVEJS_CLIENT_BUILD_PROFILE=frontier-3640684
```

```json
{
  "clientBuildProfile": "frontier-3640684"
}
```

An explicit profile owns `clientCompatibilityProfile`, `clientBuild`,
`clientVersion`, `machoVersion`, `projectCodename` and `projectVersion`, even
when those individual fields have environment overrides. The version string
uses the selected version and configured region. The selector follows the
usual environment > local JSON > shared JSON > default precedence. Setting
`EVEJS_CLIENT_BUILD_PROFILE=auto` restores the underlying manual settings.
Unknown selectors fail configuration loading and validation.

Restart after changing profiles. Birthday and region, static/runtime data
paths, chain deployment and operational feature switches remain separately
configured. A profile does not select or convert data, generate a new world,
or turn on every observed client feature. Use the existing build-specific
setup process to prepare compatible data before launching.

The configuration snapshot exposes `buildProfile` and marks profile-owned
fields with source `profile`. Startup logs the resolved profile, and secondary
services receive it as `runtimeContext.clientBuildProfile`.

## Client evidence and server implementation

The runtime catalog at `server/src/config/clientBuildCatalog.json` copies
verified identities and feature states from the [build reports](README.md)
and [feature matrix](evidence/feature-matrix.json). The runtime does not load
reports or local client archives. Feature meanings are scoped in the catalog:

| State | Meaning |
| --- | --- |
| `C` | A consuming client implementation is packaged. |
| `D` | Matching definitions, common modules or stubs only. |
| `A` | Matching criteria are absent in the audited scope. |
| `U` | Unresolved evidence; absence is not established. |

These states do not establish runtime activation or server support. Branch
differences are retained: heat/occupancy is packaged in 2884873 and absent in
2898485; race-track tooling is packaged in 3572727 and absent in 3640684.

`server/src/config/clientBuildProfiles.ts` provides immutable profile lookup,
selection, client-feature queries and a separate server-capability registry:

```js
const profiles = require("./server/src/config/clientBuildProfiles");

profiles.listClientBuildProfiles();
profiles.getClientBuildProfile("frontier-3551616");
profiles.getClientBuildProfileForBuild(3502403); // null: manual/uncatalogued
profiles.getClientFeatureState(3572727, "race_track"); // "C"
profiles.getClientFeatureState(3640684, "race_track"); // "A"
profiles.getServerBuildFeatures(3640684);
profiles.hasServerBuildFeature(3551616, "voxelMining"); // false
```

The initial implemented capabilities are `publicGatewayContracts`, `economy`,
`voxelMining` and `progression`, each enabled only for exact build 3640684.
Their existing gates now use the shared API. This list describes those four
implementation boundaries; it is not an inventory of all working server
features. Existing mining switches and other operational guards still apply.
Other build checks remain in place for future incremental migration.

## Extending the scaffold

Add an exact identity and all feature states to the catalog with evidence
references. Use `U` for unresolved observations; do not infer support from
build ordering. Add a server capability only when its concrete runtime,
descriptors and data have been checked for that build. Replace related feature
gates incrementally and retain exact target-build checks that validate a
particular data format or descriptor export.

Build and run the focused tests:

```sh
npm run build:server
npm run build:tests
node --test server/tests/frontierBuildProfiles.test.js
```

The tests cover historical feature evidence, unknown-build behavior,
selection and configuration precedence, immutable catalog data, and the
separation between client observations and server capabilities.

## Blockchain requirements

The [blockchain requirements audit](blockchain-requirements.md) covers every
catalogued build, including configuration, wallet bootstrap, signing, object
IDs, request formats and Sui deployment requirements. Each profile's
`blockchain.requirementsEvidence` and `requirementsProfileId` point to its
record in the machine-readable evidence. Protocol classification and static
verification do not enable a server adapter or expand a capability allowlist.
